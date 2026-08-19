import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SQLiteDatabase } from 'expo-sqlite';
import { openTestDb } from './helpers/db.mts';
import { buildBackup, readBackup, restoreBackup, summarize } from '../src/sync/backup';
import { applyMerge, readAll } from '../src/sync/store';
import type { Attendance, Student } from '../src/types';
import type { MergeResult } from '../src/sync/merge';

const empty: MergeResult = { students: [], attendance: [], makeups: [], exceptions: [] };

const student = (id: string, name: string, updatedAt: string, deletedAt: string | null = null): Student => ({
  id, name, grade: '중2', scheduledDays: ['Tue'],
  scheduledStartTime: '16:00', scheduledEndTime: '18:00', updatedAt, deletedAt,
});

const at = (id: string, studentId: string, date: string, updatedAt: string): Attendance => ({
  id, studentId, date, time: '16:00', status: 'scheduled', type: 'checkIn', updatedAt, deletedAt: null,
});

const seed = (db: SQLiteDatabase, rows: Partial<MergeResult>) =>
  applyMerge(db, empty, { ...empty, ...rows });

test('백업을 다른 기기에 그대로 되돌릴 수 있다', async () => {
  // 아이패드를 잃어버리고 새 기기에 앱을 깐 상황.
  const old = await openTestDb();
  await seed(old, {
    students: [student('s1', '김민준', '2026-08-01T10:00:00.000Z')],
    attendance: [at('a1', 's1', '2026-08-04', '2026-08-04T16:00:00.000Z')],
  });
  const file = await buildBackup(old);

  const fresh = await openTestDb();
  const snapshot = readBackup(file);
  assert.ok(snapshot);
  const applied = await restoreBackup(fresh, snapshot);

  assert.equal(applied, 2);
  const after = await readAll(fresh);
  assert.equal(after.students[0].name, '김민준');
  assert.equal(after.attendance[0].date, '2026-08-04');
});

test('같은 백업을 두 번 복원해도 두 배가 되지 않는다', async () => {
  const db = await openTestDb();
  await seed(db, {
    students: [student('s1', '김민준', '2026-08-01T10:00:00.000Z')],
    attendance: [at('a1', 's1', '2026-08-04', '2026-08-04T16:00:00.000Z')],
  });
  const file = await buildBackup(db);

  const fresh = await openTestDb();
  await restoreBackup(fresh, readBackup(file)!);
  const second = await restoreBackup(fresh, readBackup(file)!);

  assert.equal(second, 0, '두 번째 복원은 아무것도 바꾸지 않아야 한다');
  assert.equal((await readAll(fresh)).attendance.length, 1);
});

test('백업 이후에 찍은 기록은 복원해도 살아남는다', async () => {
  // 복원이 덮어쓰기라면 오늘 찍은 출결이 지난주 백업에 지워진다.
  const db = await openTestDb();
  await seed(db, { students: [student('s1', '김민준', '2026-08-01T10:00:00.000Z')] });
  const file = await buildBackup(db);

  await applyMerge(db, await readAll(db), {
    ...(await readAll(db)),
    attendance: [at('a-new', 's1', '2026-08-18', '2026-08-18T16:00:00.000Z')],
  });

  await restoreBackup(db, readBackup(file)!);
  const after = await readAll(db);
  assert.equal(after.attendance.length, 1);
  assert.equal(after.attendance[0].date, '2026-08-18');
});

test('삭제한 원생이 옛 백업으로 되살아나지 않는다', async () => {
  const db = await openTestDb();
  await seed(db, { students: [student('s1', '김민준', '2026-08-01T10:00:00.000Z')] });
  const file = await buildBackup(db);

  // 백업 뒤에 퇴원 처리
  await applyMerge(db, await readAll(db), {
    ...empty,
    students: [student('s1', '김민준', '2026-08-10T10:00:00.000Z', '2026-08-10T10:00:00.000Z')],
  });

  await restoreBackup(db, readBackup(file)!);
  const alive = await db.getAllAsync('SELECT * FROM students WHERE deletedAt IS NULL;');
  assert.equal(alive.length, 0);
});

test('엉뚱한 파일은 거절한다', () => {
  assert.equal(readBackup('그냥 글'), null);
  assert.equal(readBackup('{}'), null);
  assert.equal(readBackup('[1,2,3]'), null);
  assert.equal(readBackup('name,grade\n김민준,중2'), null, 'CSV를 골랐을 때');
  assert.equal(readBackup(JSON.stringify({ version: 99, students: [], attendance: [], makeups: [], exceptions: [] })), null);
  assert.equal(readBackup(JSON.stringify({ version: 1, students: 'x', attendance: [], makeups: [], exceptions: [] })), null);
});

test('요약은 지워진 기록을 세지 않는다', async () => {
  const db = await openTestDb();
  await seed(db, {
    students: [
      student('s1', '김민준', '2026-08-01T10:00:00.000Z'),
      student('s2', '이서연', '2026-08-01T10:00:00.000Z', '2026-08-02T10:00:00.000Z'),
    ],
  });

  const summary = summarize(readBackup(await buildBackup(db))!);
  assert.equal(summary.students, 1, '사용자가 세는 숫자와 맞아야 한다');
});

test('묘비는 파일에 담긴다', async () => {
  // 담기지 않으면 다른 기기에 복원할 때 삭제가 되살아난다.
  const db = await openTestDb();
  await seed(db, {
    students: [student('s1', '김민준', '2026-08-01T10:00:00.000Z', '2026-08-02T10:00:00.000Z')],
  });
  assert.equal(readBackup(await buildBackup(db))!.students.length, 1);
});

test('퇴원·구분·하원 시각도 백업을 타고 넘어간다', async () => {
  // 컬럼이 하나 늘 때마다 여기서 빠질 수 있다. 빠지면 백업 파일에는 있는데
  // 복원한 기기에만 없는, 확인하기 전까지 모르는 손실이 된다.
  const old = await openTestDb();
  await seed(old, {
    students: [
      {
        ...student('s1', '김민준', '2026-08-01T10:00:00.000Z'),
        withdrawnAt: '2026-08-20',
        note: '월수반',
      },
    ],
    attendance: [
      { ...at('a1', 's1', '2026-08-04', '2026-08-04T16:00:00.000Z'), leaveTime: '17:30' },
    ],
  });

  const fresh = await openTestDb();
  const snapshot = readBackup(await buildBackup(old));
  assert.ok(snapshot);
  await restoreBackup(fresh, snapshot);

  const after = await readAll(fresh);
  assert.equal(after.students[0].withdrawnAt, '2026-08-20');
  assert.equal(after.students[0].note, '월수반');
  assert.equal(after.attendance[0].leaveTime, '17:30');
});
