import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SQLiteDatabase } from 'expo-sqlite';
import { openTestDb } from './helpers/db.mts';
import { insertStudent } from '../src/data/students';
import { insertAbsence, insertCheckIn, listForDate } from '../src/data/attendance';
import { completeMakeupRow, listAllMakeupRows, listPending } from '../src/data/makeup';
import { applyMerge, readAll } from '../src/sync/store';
import { mergeSnapshots, SNAPSHOT_VERSION, type SyncSnapshot } from '../src/sync/merge';
import type { Student } from '../src/types';

const DAY = '2026-09-28';

const student: Student = {
  id: 's1',
  name: '김민준',
  grade: '중2',
  scheduledDays: ['Mon'],
  scheduledStartTime: '16:00',
  scheduledEndTime: '18:00',
};

const open = async (): Promise<SQLiteDatabase> => {
  const db = await openTestDb();
  await insertStudent(db, student);
  return db;
};

test('연타로 겹친 등원은 한 줄만 남는다', async () => {
  // 조회하고 따로 넣으면 두 요청이 둘 다 '없음'을 보고 둘 다 넣는다.
  // 그러면 이력에 출석 2, CSV에도 두 줄이 남고, 동기화 없는 빌드에서는 영영 안 지워진다.
  const db = await open();

  await Promise.all([
    insertCheckIn(db, 's1', DAY, 'scheduled'),
    insertCheckIn(db, 's1', DAY, 'scheduled'),
    insertCheckIn(db, 's1', DAY, 'scheduled'),
  ]);

  assert.equal((await listForDate(db, DAY)).length, 1);
});

test('등원한 학생을 결석 처리하면 아무것도 남지 않는다 — 보충 건도', async () => {
  // 결석 기록 없이 보충만 생기면 빠진 적 없는 수업을 메우라는 건이 된다.
  const db = await open();
  await insertCheckIn(db, 's1', DAY, 'scheduled');

  await insertAbsence(db, 's1', DAY);

  const records = await listForDate(db, DAY);
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'scheduled');
  assert.equal((await listAllMakeupRows(db)).length, 0, '보충 건이 생기면 안 된다');
});

test('결석을 두 번 눌러도 결석 한 줄, 보충 한 건', async () => {
  const db = await open();

  await insertAbsence(db, 's1', DAY);
  await insertAbsence(db, 's1', DAY);

  assert.equal((await listForDate(db, DAY)).length, 1);
  assert.equal((await listPending(db)).length, 1);
});

test('다른 날짜는 따로 센다', async () => {
  const db = await open();
  await insertCheckIn(db, 's1', DAY, 'scheduled');
  await insertCheckIn(db, 's1', '2026-09-29', 'scheduled');

  assert.equal((await listForDate(db, DAY)).length, 1);
  assert.equal((await listForDate(db, '2026-09-29')).length, 1);
});

/**
 * 다른 기기가 먼저 보충을 완료했는데, 이 기기가 그 사이 보충일을 바꿨다.
 * 병합 뒤 보충 건은 이 기기의 '대기'가 이기고, 출결 행(id = 보충 id)만 넘어온다.
 */
const conflictingMakeup = async () => {
  const db = await open();
  const empty = { students: [], attendance: [], makeups: [], exceptions: [] };

  await applyMerge(db, await readAll(db), {
    ...(await readAll(db)),
    makeups: [
      {
        id: 'M',
        studentId: 's1',
        originalDate: '2026-09-01',
        makeUpDate: '2026-09-10',
        completed: false,
        updatedAt: '2026-09-05T00:00:02.000Z',
        deletedAt: null,
      },
    ],
  });

  const other: SyncSnapshot = {
    version: SNAPSHOT_VERSION,
    deviceId: 'A',
    exportedAt: '2026-09-05T00:00:01.000Z',
    ...empty,
    makeups: [
      {
        id: 'M',
        studentId: 's1',
        originalDate: '2026-09-01',
        makeUpDate: '2026-09-05',
        completed: true,
        updatedAt: '2026-09-05T00:00:01.000Z',
        deletedAt: null,
      },
    ],
    attendance: [
      {
        id: 'M',
        studentId: 's1',
        date: '2026-09-05',
        time: '15:00',
        status: 'scheduled',
        type: 'makeUp',
        updatedAt: '2026-09-05T00:00:01.000Z',
        deletedAt: null,
      },
    ],
  };

  const local = await readAll(db);
  await applyMerge(db, local, mergeSnapshots(local, [other]));
  return db;
};

test('출결이 먼저 넘어온 보충도 완료할 수 있다', async () => {
  // 예전에는 기본키 충돌로 매번 되돌려져, 어느 기기에서도 이 보충을 끝낼 수 없었다.
  const db = await conflictingMakeup();
  assert.equal((await listPending(db)).length, 1, '전제: 보충 건은 아직 대기다');

  assert.equal(await completeMakeupRow(db, 'M', DAY), true);

  assert.equal((await listPending(db)).length, 0);
  const makeupAttendance = (await readAll(db)).attendance.filter((row) => row.id === 'M');
  assert.equal(makeupAttendance.length, 1, '보충 출결은 한 줄이다');
  assert.equal(makeupAttendance[0].date, DAY);
});

test('보통의 보충 완료는 출결 한 줄을 남긴다', async () => {
  const db = await open();
  await insertAbsence(db, 's1', '2026-09-21');
  const [pending] = await listPending(db);

  assert.equal(await completeMakeupRow(db, pending.id, DAY), true);
  assert.equal(await completeMakeupRow(db, pending.id, DAY), false, '두 번 완료되지 않는다');

  const rows = (await readAll(db)).attendance.filter((row) => row.type === 'makeUp');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, pending.id);
});
