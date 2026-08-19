import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { createSchema, runMigrations } from '../src/db';

/**
 * 마이그레이션은 실수하면 사용자의 기록이 사라지는 유일한 자리다.
 * 옛 버전 데이터베이스를 실제 데이터와 함께 만들어 올려본다.
 */
const wrap = (raw: DatabaseSync): SQLiteDatabase =>
  ({
    getAllAsync: async (sql: string, ...p: unknown[]) => raw.prepare(sql).all(...(p as never[])),
    getFirstAsync: async (sql: string, ...p: unknown[]) =>
      raw.prepare(sql).get(...(p as never[])) ?? null,
    runAsync: async (sql: string, ...p: unknown[]) => raw.prepare(sql).run(...(p as never[])),
    execAsync: async (sql: string) => raw.exec(sql),
  }) as unknown as SQLiteDatabase;

/** v1 시절의 스키마. 일정 예외도, 요일별 시간도, 동기화 메타도 없었다. */
const openV1 = () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`
    CREATE TABLE students (id TEXT PRIMARY KEY, name TEXT NOT NULL, grade TEXT, scheduledDays TEXT,
      scheduledStartTime TEXT, scheduledEndTime TEXT, fee INTEGER);
    CREATE TABLE attendance (id TEXT PRIMARY KEY, studentId TEXT, date TEXT NOT NULL, time TEXT NOT NULL,
      status TEXT NOT NULL, type TEXT NOT NULL, FOREIGN KEY (studentId) REFERENCES students (id));
    CREATE TABLE makeup (id TEXT PRIMARY KEY, studentId TEXT, originalDate TEXT NOT NULL, makeUpDate TEXT,
      completed INTEGER DEFAULT 0, FOREIGN KEY (studentId) REFERENCES students (id));
    PRAGMA user_version = 1;
  `);

  // 원생 3명 · 한 학기치 출결 · 보충 몇 건
  raw.exec(`
    INSERT INTO students VALUES
      ('s1','김민준','중2','["Mon","Wed"]','16:00','18:00',250000),
      ('s2','이서연','중1','["Tue","Thu"]','14:00','16:00',NULL),
      ('s3','박서준','중3','["Fri"]','19:00','21:00',300000);
  `);
  const insert = raw.prepare('INSERT INTO attendance VALUES (?,?,?,?,?,?)');
  for (let i = 0; i < 120; i++) {
    insert.run(`a${i}`, ['s1', 's2', 's3'][i % 3], `2026-0${(i % 6) + 1}-15`, '16:0' + (i % 10), i % 7 === 0 ? 'absent' : 'scheduled', 'checkIn');
  }
  raw.exec(`INSERT INTO makeup VALUES ('m1','s1','2026-03-15','2026-03-22',1), ('m2','s2','2026-04-15',NULL,0);`);
  return raw;
};

test('v1 데이터베이스가 v4로 올라가도 기록이 그대로 있다', async () => {
  const raw = openV1();
  const db = wrap(raw);

  const before = {
    students: raw.prepare('SELECT * FROM students ORDER BY id').all(),
    attendance: raw.prepare('SELECT COUNT(*) AS n FROM attendance').get() as { n: number },
    makeup: raw.prepare('SELECT * FROM makeup ORDER BY id').all(),
  };

  await createSchema(db);
  await runMigrations(db);

  assert.equal((raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 4);
  assert.equal(
    (raw.prepare('SELECT COUNT(*) AS n FROM attendance').get() as { n: number }).n,
    before.attendance.n,
    '출결 120건이 하나도 빠지지 않아야 한다'
  );

  const students = raw.prepare('SELECT * FROM students ORDER BY id').all() as Record<string, unknown>[];
  assert.equal(students.length, 3);
  assert.equal(students[0].name, '김민준');
  assert.equal(students[0].fee, 250000);
  assert.equal(students[0].scheduledDays, '["Mon","Wed"]');
  assert.equal(students[0].dayTimes, null, '요일별 시간은 비어 있고 기본 시간을 쓴다');

  const makeups = raw.prepare('SELECT * FROM makeup ORDER BY id').all() as Record<string, unknown>[];
  assert.equal(makeups.length, before.makeup.length);
  assert.equal(makeups[0].completed, 1);
  assert.equal(makeups[0].makeUpDate, '2026-03-22');
});

test('올라간 뒤 모든 행에 updatedAt이 채워진다', async () => {
  // 비어 있으면 병합에서 항상 져서, 다른 기기의 아무 기록에나 덮인다.
  const raw = openV1();
  await createSchema(wrap(raw));
  await runMigrations(wrap(raw));

  for (const table of ['students', 'attendance', 'makeup']) {
    const { n } = raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE updatedAt IS NULL`).get() as { n: number };
    assert.equal(n, 0, `${table}에 updatedAt 없는 행이 남았다`);
  }
});

test('올라간 뒤 삭제된 것으로 잘못 표시되지 않는다', async () => {
  const raw = openV1();
  await createSchema(wrap(raw));
  await runMigrations(wrap(raw));

  const { n } = raw.prepare('SELECT COUNT(*) AS n FROM attendance WHERE deletedAt IS NOT NULL').get() as { n: number };
  assert.equal(n, 0);
});

test('도중에 죽어도 다시 돌리면 이어서 올라간다', async () => {
  // user_version은 맨 끝에서 올라가므로, 중단되면 처음부터 다시 돈다.
  const raw = openV1();
  const db = wrap(raw);
  await createSchema(db);

  // v3까지만 손으로 흉내낸 뒤 전체를 다시 돌린다
  raw.exec('ALTER TABLE students ADD COLUMN dayTimes TEXT;');
  await runMigrations(db);
  await runMigrations(db);

  assert.equal((raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 4);
  assert.equal((raw.prepare('SELECT COUNT(*) AS n FROM attendance').get() as { n: number }).n, 120);
  assert.equal((raw.prepare('SELECT COUNT(*) AS n FROM students').get() as { n: number }).n, 3);
});

test('이미 v4인 데이터베이스는 건드리지 않는다', async () => {
  const raw = new DatabaseSync(':memory:');
  const db = wrap(raw);
  await createSchema(db);
  await runMigrations(db);

  raw.exec(`INSERT INTO students VALUES ('s1','김민준','중2','["Mon"]','16:00','18:00',NULL,NULL,'2026-01-01T00:00:00.000Z',NULL);`);
  await runMigrations(db);

  const student = raw.prepare('SELECT * FROM students').get() as Record<string, unknown>;
  assert.equal(student.updatedAt, '2026-01-01T00:00:00.000Z', 'updatedAt이 다시 덮이면 안 된다');
});
