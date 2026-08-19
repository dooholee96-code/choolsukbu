import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { createSchema, runMigrations } from '../../src/db/index.ts';

/**
 * expo-sqlite가 쓰는 표면만 node:sqlite 위에 맞춘 껍데기.
 *
 * 병합 SQL은 앱에서 가장 조용히 틀릴 수 있는 부분이라 실제 데이터베이스에
 * 돌려봐야 한다. React Native를 띄우지 않고 그렇게 하는 유일한 길이다.
 */
export const wrapDb = (raw: DatabaseSync): SQLiteDatabase =>
  ({
    getAllAsync: async (sql: string, ...params: unknown[]) =>
      raw.prepare(sql).all(...(params as never[])),
    getFirstAsync: async (sql: string, ...params: unknown[]) =>
      raw.prepare(sql).get(...(params as never[])) ?? null,
    runAsync: async (sql: string, ...params: unknown[]) =>
      raw.prepare(sql).run(...(params as never[])),
    execAsync: async (sql: string) => raw.exec(sql),
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
  }) as unknown as SQLiteDatabase;

/**
 * 스키마는 앱과 같은 코드로 만든다.
 *
 * 예전에는 여기에 CREATE TABLE을 손으로 적어 두었는데, 앱에 컬럼이 하나 늘면
 * 테스트만 옛 스키마로 남아 '이 컬럼은 없다'는 엉뚱한 실패가 났다. 정작
 * 확인해야 할 것 — 새 컬럼이 동기화를 타는지 — 은 그때도 확인되지 않았다.
 */
export const openTestDb = async (): Promise<SQLiteDatabase> => {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');

  const db = wrapDb(raw);
  await createSchema(db);
  await runMigrations(db);

  return db;
};
