import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from './helpers/db.mts';
import { applyMerge, readAll } from '../src/sync/store';
import { mergeSnapshots, SNAPSHOT_VERSION, type SyncSnapshot } from '../src/sync/merge';
import type { Attendance, Student } from '../src/types';
import type { MergeResult as Result } from '../src/sync/merge';

const empty: Result = { students: [], attendance: [], makeups: [], exceptions: [] };

const student = (id: string, name: string, updatedAt: string, deletedAt: string | null = null): Student => ({
  id, name, grade: '중2', scheduledDays: ['Tue'],
  scheduledStartTime: '16:00', scheduledEndTime: '18:00', updatedAt, deletedAt,
});

const at = (id: string, studentId: string, time: string, updatedAt: string): Attendance => ({
  id, studentId, date: '2026-08-18', time, status: 'scheduled', type: 'checkIn', updatedAt, deletedAt: null,
});

const snapshot = (over: Partial<SyncSnapshot>): SyncSnapshot => ({
  version: SNAPSHOT_VERSION, deviceId: 'iphone', exportedAt: '2026-08-18T20:00:00.000Z',
  students: [], attendance: [], makeups: [], exceptions: [], ...over,
});

const seed = async (db: ReturnType<typeof openTestDb>, rows: Partial<Result>) =>
  applyMerge(db, empty, { ...empty, ...rows });

test('상대 기기가 보낸 원생과 등원이 들어간다', async () => {
  const db = openTestDb();
  await seed(db, { students: [student('s1', '김민준', '2026-08-18T10:00:00.000Z')], attendance: [at('a1', 's1', '16:00', '2026-08-18T16:00:00.000Z')] });

  const local = await readAll(db);
  const applied = await applyMerge(db, local, mergeSnapshots(local, [
    snapshot({ students: [student('s2', '이서연', '2026-08-18T11:00:00.000Z')], attendance: [at('a2', 's2', '16:05', '2026-08-18T16:05:00.000Z')] }),
  ]));

  assert.equal(applied, 2);
  const after = await readAll(db);
  assert.deepEqual(after.students.map((r) => r.name).sort(), ['김민준', '이서연']);
  assert.deepEqual(after.attendance.map((r) => r.studentId).sort(), ['s1', 's2']);
});

test('새 원생과 그 학생의 등원이 함께 와도 외래키가 걸리지 않는다', async () => {
  const db = openTestDb();
  const local = await readAll(db);
  await applyMerge(db, local, mergeSnapshots(local, [
    snapshot({ students: [student('s3', '박서준', '2026-08-18T10:00:00.000Z')], attendance: [at('a3', 's3', '16:00', '2026-08-18T16:00:00.000Z')] }),
  ]));

  const after = await readAll(db);
  assert.equal(after.students.length, 1);
  assert.equal(after.attendance.length, 1);
});

test('중복 등원은 하나만 남고 진 행은 사라진다', async () => {
  const db = openTestDb();
  await seed(db, { students: [student('s1', '김민준', '2026-08-18T10:00:00.000Z')], attendance: [at('a1', 's1', '16:00', '2026-08-18T16:00:00.000Z')] });

  const local = await readAll(db);
  await applyMerge(db, local, mergeSnapshots(local, [
    snapshot({ attendance: [at('a9', 's1', '16:30', '2026-08-18T16:30:00.000Z')] }),
  ]));

  const rows = (await readAll(db)).attendance;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].time, '16:30');
});

test('중복만 정리해도 반영 건수가 0이 아니다', async () => {
  // 0을 돌려주면 부르는 쪽이 화면을 새로 읽지도, 바뀐 것을 올리지도 않는다.
  const db = openTestDb();
  await seed(db, { students: [student('s1', '김민준', '2026-08-18T10:00:00.000Z')], attendance: [at('a1', 's1', '16:00', '2026-08-18T16:00:00.000Z')] });

  const local = await readAll(db);
  const applied = await applyMerge(db, local, mergeSnapshots(local, [
    snapshot({ attendance: [at('a9', 's1', '16:30', '2026-08-18T16:30:00.000Z')] }),
  ]));
  assert.ok(applied > 0);
});

test('상대가 지운 원생은 화면에서 사라지고 묘비는 남는다', async () => {
  const db = openTestDb();
  await seed(db, { students: [student('s1', '김민준', '2026-08-18T10:00:00.000Z')] });

  const local = await readAll(db);
  await applyMerge(db, local, mergeSnapshots(local, [
    snapshot({ students: [student('s1', '김민준', '2026-08-19T10:00:00.000Z', '2026-08-19T10:00:00.000Z')] }),
  ]));

  const alive = await db.getAllAsync('SELECT * FROM students WHERE deletedAt IS NULL;');
  assert.equal(alive.length, 0);
  assert.equal((await readAll(db)).students.length, 1);
});

test('바뀐 것이 없으면 아무것도 쓰지 않는다', async () => {
  const db = openTestDb();
  await seed(db, { students: [student('s1', '김민준', '2026-08-18T10:00:00.000Z')] });
  const local = await readAll(db);
  assert.equal(await applyMerge(db, local, mergeSnapshots(local, [])), 0);
});
