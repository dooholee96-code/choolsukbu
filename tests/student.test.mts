import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SQLiteDatabase } from 'expo-sqlite';
import { openTestDb } from './helpers/db.mts';
import {
  importStudentRows,
  listStudents,
  setWithdrawn,
  insertStudent,
  updateStudentRow,
  softDeleteStudent,
} from '../src/data/students';
import { listAllAttendance } from '../src/data/attendance';
import { buildRoster } from '../src/utils/roster';
import { duplicateNames, isWithdrawnOn, studentSubtitle } from '../src/utils/student';
import type { Student } from '../src/types';

const student = (over: Partial<Student> & { id: string; name: string }): Student => ({
  grade: '중2',
  scheduledDays: ['Mon', 'Wed'],
  scheduledStartTime: '16:00',
  scheduledEndTime: '18:00',
  ...over,
});

/** 2026-08-17 (월) */
const MON = new Date('2026-08-17T12:00:00');

/**
 * 등원 한 줄. insertCheckIn을 쓰지 않는 이유는 그쪽이 expo-crypto로 id를
 * 만들기 때문이다 — React Native 밖에서는 부를 수 없다.
 */
const checkIn = (db: SQLiteDatabase, id: string, studentId: string, date: string) =>
  db.runAsync(
    "INSERT INTO attendance (id, studentId, date, time, status, type, updatedAt) VALUES (?, ?, ?, '16:05', 'scheduled', 'checkIn', ?);",
    id,
    studentId,
    date,
    '2026-08-17T00:00:00.000Z'
  );

test('퇴원해도 출결 기록은 남는다', async () => {
  // 삭제 대신 퇴원을 두는 이유 전부가 이것이다. 기록이 사라지면 나중에
  // 정산도, 다녔다는 확인도 할 수 없다.
  const db = await openTestDb();
  await insertStudent(db, student({ id: 's1', name: '김민준' }));
  await checkIn(db, 'a1', 's1', '2026-08-10');
  await checkIn(db, 'a2', 's1', '2026-08-12');

  await setWithdrawn(db, 's1', '2026-08-17');

  assert.equal((await listAllAttendance(db)).length, 2, '출결 두 건이 그대로 있어야 한다');
  assert.equal((await listStudents(db)).length, 1, '이력에서 이름을 찾으려면 명단에 남아야 한다');
});

test('삭제는 출결까지 지운다 — 그래서 퇴원과 다르다', async () => {
  const db = await openTestDb();
  await insertStudent(db, student({ id: 's1', name: '김민준' }));
  await checkIn(db, 'a1', 's1', '2026-08-10');

  await softDeleteStudent(db, 's1');

  assert.equal((await listAllAttendance(db)).length, 0);
  assert.equal((await listStudents(db)).length, 0);
});

test('퇴원일부터 명단에서 빠지고, 그 전 날짜에는 남는다', async () => {
  const leaver = student({ id: 's1', name: '김민준', withdrawnAt: '2026-08-17' });
  const staying = student({ id: 's2', name: '이서연' });

  const before = new Date('2026-08-10T12:00:00'); // 그 전 월요일
  assert.deepEqual(
    buildRoster([leaver, staying], [], before).map((e) => e.student.id),
    ['s1', 's2'],
    '퇴원 전 날짜의 명단에서까지 사라지면 다니던 동안의 기록을 볼 수 없다'
  );
  assert.deepEqual(
    buildRoster([leaver, staying], [], MON).map((e) => e.student.id),
    ['s2']
  );
});

test('복학하면 다시 명단에 나온다', async () => {
  const db = await openTestDb();
  await insertStudent(db, student({ id: 's1', name: '김민준' }));
  await setWithdrawn(db, 's1', '2026-08-17');
  await setWithdrawn(db, 's1', null);

  const [row] = await listStudents(db);
  assert.equal(row.withdrawnAt, null);
  assert.equal(buildRoster([row], [], MON).length, 1);
});

test('퇴원생의 정보를 고쳐도 복학되지 않는다', async () => {
  // 폼이 들고 있는 값으로 withdrawnAt까지 같이 쓰면, 수업 시간만 손봐도
  // 조용히 복학 처리가 된다.
  const db = await openTestDb();
  await insertStudent(db, student({ id: 's1', name: '김민준' }));
  await setWithdrawn(db, 's1', '2026-08-17');

  await updateStudentRow(db, student({ id: 's1', name: '김민준', scheduledStartTime: '17:00' }));

  const [row] = await listStudents(db);
  assert.equal(row.withdrawnAt, '2026-08-17');
  assert.equal(row.scheduledStartTime, '17:00');
});

test('미래 날짜로 퇴원을 잡아둘 수 있다', async () => {
  const leaving = student({ id: 's1', name: '김민준', withdrawnAt: '2026-08-31' });
  assert.equal(isWithdrawnOn(leaving, '2026-08-17'), false);
  assert.equal(isWithdrawnOn(leaving, '2026-08-31'), true, '퇴원일 당일부터 빠진다');
});

test('동명이인은 학년이 다르면 둘 다 들어온다', async () => {
  // 이름만으로 거르면 두 번째 김민준이 영영 들어오지 않는다. 조용히 건너뛰므로
  // 빠졌다는 사실조차 모른다.
  const db = await openTestDb();
  const { added, skipped } = await importStudentRows(db, [
    student({ id: 'a', name: '김민준', grade: '중2' }),
    student({ id: 'b', name: '김민준', grade: '중3' }),
  ]);

  assert.equal(added, 2);
  assert.equal(skipped, 0);
});

test('학년까지 같으면 구분으로 가른다', async () => {
  const db = await openTestDb();
  const { added } = await importStudentRows(db, [
    student({ id: 'a', name: '김민준', grade: '중2', note: '월수반' }),
    student({ id: 'b', name: '김민준', grade: '중2', note: '화목반' }),
  ]);

  assert.equal(added, 2);
});

test('같은 파일을 두 번 가져와도 명단이 복제되지 않는다', async () => {
  const db = await openTestDb();
  const rows = [
    student({ id: 'a', name: '김민준', grade: '중2' }),
    student({ id: 'b', name: '이서연', grade: '중1' }),
  ];

  await importStudentRows(db, rows);
  const second = await importStudentRows(db, rows.map((r) => ({ ...r, id: `${r.id}2` })));

  assert.equal(second.added, 0);
  assert.equal(second.skipped, 2);
  assert.equal((await listStudents(db)).length, 2);
});

test('한 파일 안에 같은 사람이 두 번 있어도 한 번만 들어간다', async () => {
  const db = await openTestDb();
  const { added, skipped } = await importStudentRows(db, [
    student({ id: 'a', name: '김민준', grade: '중2' }),
    student({ id: 'b', name: '김민준', grade: '중2' }),
  ]);

  assert.equal(added, 1);
  assert.equal(skipped, 1);
});

test('이름이 겹치는 원생만 골라낸다', () => {
  const rows = [
    student({ id: 'a', name: '김민준' }),
    student({ id: 'b', name: '김민준', note: '화목반' }),
    student({ id: 'c', name: '이서연' }),
  ];

  assert.deepEqual([...duplicateNames(rows)], ['김민준']);
});

test('퇴원생은 이름 겹침으로 세지 않는다', () => {
  // 나간 사람과 헷갈릴 일은 없다. 한 명뿐인 이름에 꼬리표를 달면 화면만 시끄럽다.
  const rows = [
    student({ id: 'a', name: '김민준' }),
    student({ id: 'b', name: '김민준', withdrawnAt: '2026-08-01' }),
  ];

  assert.equal(duplicateNames(rows).size, 0);
});

test('구분은 학년 옆에 붙고, 없으면 학년만 남는다', () => {
  assert.equal(studentSubtitle(student({ id: 'a', name: '김민준', note: '월수반' })), '중2 · 월수반');
  assert.equal(studentSubtitle(student({ id: 'a', name: '김민준' })), '중2');
  assert.equal(studentSubtitle(student({ id: 'a', name: '김민준', note: '  ' })), '중2');
});
