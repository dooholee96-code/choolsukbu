import type { SQLiteDatabase } from 'expo-sqlite';
import { logger } from '../utils/logger';
import { stamp } from '../data/stamp';
import { exclusive } from '../db/queue';
import { mergeSnapshots, SNAPSHOT_VERSION, SyncSnapshot } from './merge';
import { getDeviceId, getLastSyncAt, hasChangesSince, setLastSyncAt } from './device';
import { applyMerge, readAll } from './store';

export type SyncOutcome =
  | { status: 'synced'; at: string; applied: number }
  | { status: 'unavailable'; reason: string }
  | { status: 'failed'; message: string };

export type Availability =
  | { ok: true }
  | { ok: false; reason: 'platform' | 'module' | 'signedOut' | 'error' };

/**
 * 파일을 주고받는 쪽. 실제로는 iCloud Drive(transport.ts)이고, 테스트는 가짜를 넣는다.
 *
 * 따로 받는 이유: transport는 React Native에 묶여 있어 노드에서 불러올 수 없다. 그러면
 * '동기화 도중에 찍은 등원이 다음 번에 실리는가' 같은, 데이터를 잃느냐가 걸린 순서를
 * 실제 SQLite에 돌려 볼 길이 없다.
 */
export interface Transport {
  checkAvailability: () => Promise<Availability>;
  upload: (snapshot: SyncSnapshot) => Promise<void>;
  downloadOthers: (ownDeviceId: string) => Promise<SyncSnapshot[]>;
}

/** 화면에 그대로 띄우는 문구. 왜 안 되는지 사용자가 알 수 있어야 한다. */
const UNAVAILABLE_REASON: Record<string, string> = {
  platform: 'iCloud 동기화는 iPhone·iPad에서만 됩니다.',
  module: '이 빌드에는 iCloud 동기화가 들어 있지 않습니다. 유료 Apple 개발자 계정으로 빌드해야 켤 수 있고, 나머지 기능은 그대로 씁니다.',
  signedOut: '설정에서 iCloud에 로그인하면 동기화됩니다.',
  error: 'iCloud 상태를 확인하지 못했습니다.',
};

/**
 * 한 번 맞추기: 내 것 올리고, 남의 것 내려받아 합치고, 합친 결과를 다시 올린다.
 *
 * 마지막에 한 번 더 올리는 이유는, 병합으로 내 기록이 바뀌었을 수 있기 때문이다.
 * 그대로 두면 상대 기기가 다음에 내 파일을 읽었을 때 낡은 상태를 본다.
 *
 * 어느 단계에서 실패하든 로컬 데이터는 이미 안전하다. 기록은 항상 먼저
 * 기기에 저장되고 전송은 그다음이다.
 */
export const runSyncOnce = async (
  db: SQLiteDatabase,
  { checkAvailability, upload, downloadOthers }: Transport
): Promise<SyncOutcome> => {
  const availability = await checkAvailability();
  if (!availability.ok) {
    return {
      status: 'unavailable',
      reason: UNAVAILABLE_REASON[availability.reason] ?? '동기화를 쓸 수 없습니다.',
    };
  }

  try {
    const snapshotOf = async (deviceId: string): Promise<SyncSnapshot> => {
      const rows = await readAll(db);
      return {
        version: SNAPSHOT_VERSION,
        deviceId,
        exportedAt: new Date().toISOString(),
        students: rows.students,
        attendance: rows.attendance,
        makeups: rows.makeups,
        exceptions: rows.exceptions,
      };
    };

    // DB에 닿는 단계는 화면의 쓰기와 같은 줄을 선다 (db/queue). iCloud를 기다리는
    // 동안은 줄 밖이다 — 몇 초씩 막으면 그동안 누른 등원이 전부 밀린다.
    const prepared = await exclusive(async () => {
      // 이번 동기화가 어디까지를 덮는지. 올리기 **전에**, 그리고 줄 안에서 찍는다.
      // 끝난 뒤에 찍으면 내려받는 몇 초 사이에 찍은 등원이 '이미 올린 것'으로 잡혀
      // 다음 쓰기가 생길 때까지 상대 기기로 가지 않는다. 줄 안이라 이보다 이른 시각을
      // 단 쓰기는 전부 끝나 있고, stamp()라서 이 뒤의 쓰기는 반드시 이보다 늦다.
      const at = stamp();
      const deviceId = await getDeviceId(db);
      // 지난번 이후 이 기기에서 바뀐 것이 없으면 같은 파일을 다시 쓸 이유가 없다.
      const since = await getLastSyncAt(db);
      const outgoing = (await hasChangesSince(db, since)) ? await snapshotOf(deviceId) : null;
      return { at, deviceId, outgoing };
    });
    const { at, deviceId } = prepared;

    if (prepared.outgoing) await upload(prepared.outgoing);

    const others = await downloadOthers(deviceId);

    const merged = await exclusive(async () => {
      const local = await readAll(db);
      const applied = await applyMerge(db, local, mergeSnapshots(local, others));
      // 병합으로 내 기록이 바뀌었으면 합친 결과를 다시 올려야 상대가 낡은 상태를 안 본다.
      return { applied, outgoing: applied > 0 ? await snapshotOf(deviceId) : null };
    });

    if (merged.outgoing) await upload(merged.outgoing);

    await exclusive(() => setLastSyncAt(db, at));
    return { status: 'synced', at, applied: merged.applied };
  } catch (error) {
    logger.error('Sync failed', error);
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : '동기화하지 못했습니다.',
    };
  }
};
