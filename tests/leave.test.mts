import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SQLiteDatabase } from 'expo-sqlite';
import { openTestDb } from './helpers/db.mts';
import { listAllAttendance, setLeaveTime } from '../src/data/attendance';
import { insertStudent } from '../src/data/students';
import { applyMerge, readAll } from '../src/sync/store';
import { mergeSnapshots, SNAPSHOT_VERSION, type SyncSnapshot } from '../src/sync/merge';
import { departureOffsetLabel } from '../src/utils/date';
import type { Attendance, Student } from '../src/types';

const student: Student = {
  id: 's1',
  name: '김민준',
  grade: '중2',
  scheduledDays: ['Mon'],
  scheduledStartTime: '16:00',
  scheduledEndTime: '18:00',
};

const seedAttendance = (
  db: SQLiteDatabase,
  id: string,
  status: Attendance['status'],
  date = '2026-08-17'
) =>
  db.runAsync(
    "INSERT INTO attendance (id, studentId, date, time, status, type, updatedAt) VALUES (?, 's1', ?, '16:05', ?, 'checkIn', '2026-08-17T07:05:00.000Z');",
    id,
    date,
    status
  );

const open = async () => {
  const db = await openTestDb();
  await insertStudent(db, student);
  return db;
};

test('하원 시각을 남기고 지울 수 있다', async () => {
  const db = await open();
  await seedAttendance(db, 'a1', 'scheduled');

  await setLeaveTime(db, 'a1', '18:02');
  assert.equal((await listAllAttendance(db))[0].leaveTime, '18:02');

  // 잘못 찍었을 때 되돌릴 길이 없으면, 고칠 수 있는 값이 아니라 사고가 된다.
  await setLeaveTime(db, 'a1', null);
  assert.equal((await listAllAttendance(db))[0].leaveTime, null);
});

test('결석에는 하원 시각이 붙지 않는다', async () => {
  // 오지 않은 학생이 몇 시에 갔는지는 없는 값이다. 남으면 이력에서 조퇴처럼 읽힌다.
  const db = await open();
  await seedAttendance(db, 'a1', 'absent');

  await setLeaveTime(db, 'a1', '17:00');

  assert.equal((await listAllAttendance(db))[0].leaveTime, null);
});

test('하원을 찍으면 updatedAt이 올라간다', async () => {
  // 안 올라가면 다른 기기의 옛 사본이 병합에서 이겨 하원 시각이 사라진다.
  const db = await open();
  await seedAttendance(db, 'a1', 'scheduled');
  const before = (await listAllAttendance(db))[0].updatedAt ?? '';

  await setLeaveTime(db, 'a1', '18:02');

  const after = (await listAllAttendance(db))[0].updatedAt ?? '';
  assert.ok(after > before, `updatedAt이 그대로다 (${before} → ${after})`);
});

test('하원 시각이 다른 기기로 넘어간다', async () => {
  const db = await open();
  await seedAttendance(db, 'a1', 'scheduled');

  const remote: SyncSnapshot = {
    version: SNAPSHOT_VERSION,
    deviceId: 'other',
    exportedAt: '2026-08-17T12:00:00.000Z',
    students: [],
    attendance: [
      {
        id: 'a1',
        studentId: 's1',
        date: '2026-08-17',
        time: '16:05',
        leaveTime: '17:10',
        status: 'scheduled',
        type: 'checkIn',
        updatedAt: '2026-08-17T08:10:00.000Z',
      },
    ],
    makeups: [],
    exceptions: [],
  };

  const local = await readAll(db);
  await applyMerge(db, local, mergeSnapshots(local, [remote]));

  assert.equal(
    (await listAllAttendance(db))[0].leaveTime,
    '17:10',
    '컬럼을 동기화 SQL에 넣지 않으면 하원 시각만 조용히 사라진다'
  );
});

test('퇴원과 구분도 다른 기기로 넘어간다', async () => {
  const db = await open();

  const remote: SyncSnapshot = {
    version: SNAPSHOT_VERSION,
    deviceId: 'other',
    exportedAt: '2026-08-17T12:00:00.000Z',
    students: [
      { ...student, withdrawnAt: '2026-08-17', note: '월수반', updatedAt: '2026-09-01T00:00:00.000Z' },
    ],
    attendance: [],
    makeups: [],
    exceptions: [],
  };

  const local = await readAll(db);
  await applyMerge(db, local, mergeSnapshots(local, [remote]));

  const [row] = (await readAll(db)).students;
  assert.equal(row.withdrawnAt, '2026-08-17');
  assert.equal(row.note, '월수반');
});

test('조퇴는 일찍 간 쪽에만 붙는다', () => {
  assert.equal(departureOffsetLabel('17:00', '18:00'), '조퇴 · 1시간 일찍');
  assert.equal(departureOffsetLabel('18:30', '18:00'), '30분 더 있음');
  assert.equal(departureOffsetLabel('18:05', '18:00'), null, '10분 미만은 표시하지 않는다');
  // 자정을 넘는 수업: 단순 뺄셈이면 '23시간 30분 더 있음'이 된다
  assert.equal(departureOffsetLabel('23:30', '00:00'), '조퇴 · 30분 일찍');
});
