import type { SQLiteDatabase } from 'expo-sqlite';
import { MakeUp } from '../types';
import { getCurrentTime } from '../utils/date';
import { stamp } from './stamp';

export const listPending = (db: SQLiteDatabase) =>
  db.getAllAsync<MakeUp>('SELECT * FROM makeup WHERE completed = 0 AND deletedAt IS NULL;');

/** 동기화 전용. 묘비까지 전부. SQLite는 boolean이 없어 completed가 0/1로 돌아온다. */
export const listMakeupsIncludingDeleted = async (db: SQLiteDatabase): Promise<MakeUp[]> => {
  const rows = await db.getAllAsync<MakeUp>('SELECT * FROM makeup;');
  return rows.map((row) => ({
    ...row,
    completed: Boolean(row.completed),
    deletedAt: row.deletedAt ?? null,
  }));
};

export const listAllMakeupRows = (db: SQLiteDatabase) =>
  db.getAllAsync<MakeUp>('SELECT * FROM makeup WHERE deletedAt IS NULL ORDER BY originalDate;');

export const setMakeupDate = (db: SQLiteDatabase, makeupId: string, makeUpDate: string) =>
  db.runAsync(
    'UPDATE makeup SET makeUpDate = ?, updatedAt = ? WHERE id = ?;',
    makeUpDate,
    stamp(),
    makeupId
  );

/**
 * 보충 완료. 완료 표시와 함께 보충 수업 출결을 남겨 실제 수업이 있었다는
 * 사실이 출결 기록에도 드러나게 한다.
 *
 * 출결 행의 id로 보충 건의 id를 그대로 쓴다. 같은 보충을 두 기기에서 완료해도
 * 한 건으로 합쳐지고, 같은 날 서로 다른 보충 두 개는 id가 달라 둘 다 남는다.
 * (병합 키는 src/sync/merge.ts의 attendanceKey 참고)
 */
export const completeMakeupRow = async (
  db: SQLiteDatabase,
  makeupId: string,
  date: string
): Promise<boolean> => {
  const target = await db.getFirstAsync<MakeUp>(
    'SELECT * FROM makeup WHERE id = ? AND deletedAt IS NULL;',
    makeupId
  );
  if (!target || target.completed) return false;

  const now = stamp();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'UPDATE makeup SET completed = 1, makeUpDate = COALESCE(makeUpDate, ?), updatedAt = ? WHERE id = ?;',
      date,
      now,
      makeupId
    );
    await db.runAsync(
      'INSERT INTO attendance (id, studentId, date, time, status, type, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?);',
      makeupId,
      target.studentId,
      date,
      getCurrentTime(),
      'scheduled',
      'makeUp',
      now
    );
  });

  return true;
};

export const softDeleteMakeup = (db: SQLiteDatabase, makeupId: string) => {
  const now = stamp();
  return db.runAsync(
    'UPDATE makeup SET deletedAt = ?, updatedAt = ? WHERE id = ?;',
    now,
    now,
    makeupId
  );
};
