import type { SQLiteDatabase } from 'expo-sqlite';
import { logger } from '../utils/logger';
import { mergeSnapshots, SNAPSHOT_VERSION, SyncSnapshot } from './merge';
import { getDeviceId, getLastSyncAt, hasChangesSince, setLastSyncAt } from './device';
import { applyMerge, readAll } from './store';
import { checkAvailability, downloadOthers, upload } from './transport';

export type { SyncSnapshot } from './merge';
export type { Availability } from './transport';

export type SyncOutcome =
  | { status: 'synced'; at: string; applied: number }
  | { status: 'unavailable'; reason: string }
  | { status: 'failed'; message: string };

/** 화면에 그대로 띄우는 문구. 왜 안 되는지 사용자가 알 수 있어야 한다. */
const UNAVAILABLE_REASON: Record<string, string> = {
  platform: 'iCloud 동기화는 iPhone·iPad에서만 됩니다.',
  module: '이 빌드에는 iCloud 동기화가 들어 있지 않습니다.',
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
/**
 * 지금 돌고 있는 동기화. 겹쳐 돌면 두 트랜잭션이 같은 연결 위에서 서로 끼어든다.
 * iOS는 앱을 내릴 때 'inactive'와 'background'를 잇달아 보내고, 쓰기 뒤 타이머와
 * 겹치는 일도 있어서 실제로 겹친다.
 */
let inFlight: Promise<SyncOutcome> | null = null;

export const runSync = (db: SQLiteDatabase): Promise<SyncOutcome> => {
  if (inFlight) return inFlight;

  inFlight = runSyncOnce(db).finally(() => {
    inFlight = null;
  });
  return inFlight;
};

const runSyncOnce = async (db: SQLiteDatabase): Promise<SyncOutcome> => {
  const availability = await checkAvailability();
  if (!availability.ok) {
    return {
      status: 'unavailable',
      reason: UNAVAILABLE_REASON[availability.reason] ?? '동기화를 쓸 수 없습니다.',
    };
  }

  try {
    const deviceId = await getDeviceId(db);

    const snapshotOf = async (): Promise<SyncSnapshot> => {
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

    // 지난번 이후 이 기기에서 바뀐 것이 없으면 같은 파일을 다시 쓸 이유가 없다.
    const since = await getLastSyncAt(db);
    if (await hasChangesSince(db, since)) await upload(await snapshotOf());

    const others = await downloadOthers(deviceId);
    const local = await readAll(db);
    const applied = await applyMerge(db, local, mergeSnapshots(local, others));

    if (applied > 0) await upload(await snapshotOf());

    const at = new Date().toISOString();
    await setLastSyncAt(db, at);
    return { status: 'synced', at, applied };
  } catch (error) {
    logger.error('Sync failed', error);
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : '동기화하지 못했습니다.',
    };
  }
};

export { checkAvailability, getLastSyncAt };
