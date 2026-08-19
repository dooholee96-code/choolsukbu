import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * expo-sqlite가 쓰는 표면만 node:sqlite 위에 맞춘 껍데기.
 *
 * 병합 SQL은 앱에서 가장 조용히 틀릴 수 있는 부분이라 실제 데이터베이스에
 * 돌려봐야 한다. React Native를 띄우지 않고 그렇게 하는 유일한 길이다.
 */
export const openTestDb = (): SQLiteDatabase => {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec(`
    CREATE TABLE students (id TEXT PRIMARY KEY, name TEXT NOT NULL, grade TEXT, scheduledDays TEXT,
      scheduledStartTime TEXT, scheduledEndTime TEXT, dayTimes TEXT, fee INTEGER,
      updatedAt TEXT, deletedAt TEXT);
    CREATE TABLE attendance (id TEXT PRIMARY KEY, studentId TEXT, date TEXT NOT NULL, time TEXT NOT NULL,
      status TEXT NOT NULL, type TEXT NOT NULL, updatedAt TEXT, deletedAt TEXT,
      FOREIGN KEY (studentId) REFERENCES students (id));
    CREATE TABLE makeup (id TEXT PRIMARY KEY, studentId TEXT, originalDate TEXT NOT NULL, makeUpDate TEXT,
      completed INTEGER DEFAULT 0, updatedAt TEXT, deletedAt TEXT,
      FOREIGN KEY (studentId) REFERENCES students (id));
    CREATE TABLE schedule_exception (id TEXT PRIMARY KEY, date TEXT NOT NULL, kind TEXT NOT NULL,
      studentId TEXT, startTime TEXT, endTime TEXT, note TEXT, updatedAt TEXT, deletedAt TEXT,
      FOREIGN KEY (studentId) REFERENCES students (id));
  `);

  return {
    getAllAsync: async (sql: string, ...params: unknown[]) => raw.prepare(sql).all(...(params as never[])),
    getFirstAsync: async (sql: string, ...params: unknown[]) =>
      raw.prepare(sql).get(...(params as never[])) ?? null,
    runAsync: async (sql: string, ...params: unknown[]) => raw.prepare(sql).run(...(params as never[])),
    withTransactionAsync: async (fn: () => Promise<void>) => {
      raw.exec('BEGIN');
      try {
        await fn();
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as SQLiteDatabase;
};
