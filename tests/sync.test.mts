import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SQLiteDatabase } from 'expo-sqlite';
import { openTestDb } from './helpers/db.mts';
import { runSyncOnce, type Transport } from '../src/sync/run';
import { getLastSyncAt, hasChangesSince } from '../src/sync/device';
import { exclusive } from '../src/db/queue';
import { insertStudent } from '../src/data/students';
import { insertCheckIn, listForDate } from '../src/data/attendance';
import { SNAPSHOT_VERSION, type SyncSnapshot } from '../src/sync/merge';
import type { Student } from '../src/types';

const DAY = '2026-09-28';
const student = (id: string, name: string): Student => ({
  id,
  name,
  grade: '중2',
  scheduledDays: ['Mon'],
  scheduledStartTime: '16:00',
  scheduledEndTime: '18:00',
});

/** iCloud 대신. 올린 파일을 모아 두고, 내려받을 때 할 일을 끼워 넣을 수 있다. */
const fakeCloud = (
  options: { others?: SyncSnapshot[]; duringDownload?: () => Promise<void> } = {}
) => {
  const uploads: SyncSnapshot[] = [];
  const transport: Transport = {
    checkAvailability: async () => ({ ok: true }),
    upload: async (snapshot) => {
      uploads.push(snapshot);
    },
    downloadOthers: async () => {
      await options.duringDownload?.();
      return options.others ?? [];
    },
  };
  return { transport, uploads };
};

const open = async (): Promise<SQLiteDatabase> => {
  const db = await openTestDb();
  await insertStudent(db, student('s1', '김민준'));
  await insertStudent(db, student('s2', '이서연'));
  return db;
};

test('동기화 도중에 찍은 등원은 다음 동기화에 실린다', async () => {
  // iCloud에서 내려받는 몇 초 사이에 등원을 찍었다. 동기화가 끝난 시각을 '여기까지 올렸다'로
  // 적으면, 그 등원은 이미 올린 것으로 잡혀 다음 쓰기가 생길 때까지 상대 기기로 가지 않는다.
  const db = await open();
  const cloud = fakeCloud({
    duringDownload: async () => {
      await exclusive(() => insertCheckIn(db, 's2', DAY, 'scheduled'));
    },
  });

  const outcome = await runSyncOnce(db, cloud.transport);
  assert.equal(outcome.status, 'synced');

  // 올린 파일에는 아직 없다 — 올린 뒤에 찍었다.
  assert.equal(cloud.uploads.at(-1)?.attendance.length ?? 0, 0);
  // 그러니 다음 동기화는 '바뀐 것이 있다'고 봐야 한다.
  assert.equal(await hasChangesSince(db, await getLastSyncAt(db)), true);

  const next = fakeCloud();
  await runSyncOnce(db, next.transport);
  assert.equal(next.uploads.length, 1, '다음 동기화가 올린다');
  assert.equal(next.uploads[0].attendance.length, 1, '그 등원이 실려 있다');
});

test('바뀐 것이 없으면 다시 올리지 않는다', async () => {
  const db = await open();
  await runSyncOnce(db, fakeCloud().transport);

  const second = fakeCloud();
  await runSyncOnce(db, second.transport);
  assert.equal(second.uploads.length, 0);
});

test('상대 기기의 기록을 합치면 합친 결과를 다시 올린다', async () => {
  const db = await open();
  await runSyncOnce(db, fakeCloud().transport);

  const other: SyncSnapshot = {
    version: SNAPSHOT_VERSION,
    deviceId: 'ipad',
    exportedAt: '2099-01-01T00:00:00.000Z',
    students: [],
    attendance: [
      {
        id: 'from-ipad',
        studentId: 's1',
        date: DAY,
        time: '16:02',
        status: 'scheduled',
        type: 'checkIn',
        updatedAt: '2099-01-01T00:00:00.000Z',
        deletedAt: null,
      },
    ],
    makeups: [],
    exceptions: [],
  };

  const cloud = fakeCloud({ others: [other] });
  const outcome = await runSyncOnce(db, cloud.transport);

  assert.deepEqual(outcome.status === 'synced' && outcome.applied, 1);
  assert.equal((await listForDate(db, DAY)).length, 1);
  assert.equal(cloud.uploads.at(-1)?.attendance.length, 1, '합친 뒤의 상태를 올린다');
});

test('쓸 수 없으면 아무것도 건드리지 않고 이유를 돌려준다', async () => {
  const db = await open();
  const transport: Transport = {
    checkAvailability: async () => ({ ok: false, reason: 'module' }),
    upload: async () => assert.fail('올리면 안 된다'),
    downloadOthers: async () => assert.fail('내려받으면 안 된다'),
  };

  const outcome = await runSyncOnce(db, transport);
  assert.equal(outcome.status, 'unavailable');
  assert.match(outcome.status === 'unavailable' ? outcome.reason : '', /유료/);
  assert.equal(await getLastSyncAt(db), null);
});

test('올리다 실패하면 맞춘 시각을 남기지 않는다', async () => {
  // 남기면 다음 번에 '바뀐 것 없음'으로 보고 다시 올리지 않는다.
  const db = await open();
  const transport: Transport = {
    checkAvailability: async () => ({ ok: true }),
    upload: async () => {
      throw new Error('network');
    },
    downloadOthers: async () => [],
  };

  const outcome = await runSyncOnce(db, transport);
  assert.equal(outcome.status, 'failed');
  assert.equal(await getLastSyncAt(db), null);
});
