import type { SQLiteDatabase } from 'expo-sqlite';
import { ExceptionKind, ScheduleException } from '../types';
import { createId } from '../utils/id';
import { stamp } from './stamp';

const VALID_KINDS: ExceptionKind[] = ['closure', 'extra', 'skip'];

/** SQLite는 빈 칸을 NULL로 돌려주는데 타입은 optional이라 undefined로 맞춘다. */
type Row = {
  id: string;
  date: string;
  kind: string;
  studentId: string | null;
  startTime: string | null;
  endTime: string | null;
  note: string | null;
  updatedAt: string | null;
  deletedAt: string | null;
};

const toException = (row: Row): ScheduleException => ({
  id: row.id,
  date: row.date,
  kind: (VALID_KINDS.includes(row.kind as ExceptionKind) ? row.kind : 'skip') as ExceptionKind,
  studentId: row.studentId ?? undefined,
  startTime: row.startTime ?? undefined,
  endTime: row.endTime ?? undefined,
  note: row.note ?? undefined,
  updatedAt: row.updatedAt ?? undefined,
  deletedAt: row.deletedAt ?? null,
});

/** 동기화 전용. 묘비까지 전부. */
export const listExceptionsIncludingDeleted = async (db: SQLiteDatabase) => {
  const rows = await db.getAllAsync<Row>('SELECT * FROM schedule_exception;');
  return rows.map(toException);
};

export const listForDate = async (db: SQLiteDatabase, date: string) => {
  const rows = await db.getAllAsync<Row>(
    'SELECT * FROM schedule_exception WHERE date = ? AND deletedAt IS NULL;',
    date
  );
  return rows.map(toException);
};

export const listRange = async (db: SQLiteDatabase, fromDate: string, toDate: string) => {
  const rows = await db.getAllAsync<Row>(
    'SELECT * FROM schedule_exception WHERE date >= ? AND date <= ? AND deletedAt IS NULL ORDER BY date;',
    fromDate,
    toDate
  );
  return rows.map(toException);
};

export const listAllExceptionRows = async (db: SQLiteDatabase) => {
  const rows = await db.getAllAsync<Row>(
    'SELECT * FROM schedule_exception WHERE deletedAt IS NULL ORDER BY date;'
  );
  return rows.map(toException);
};

/**
 * 휴강 지정·해제. 한 날짜에 휴강 행은 하나뿐이어야 하므로 켤 때도 먼저 지운다.
 * (연타나 두 화면에서 동시에 눌렀을 때 중복 행이 남는 것을 막는다.)
 */
export const setClosureRow = async (
  db: SQLiteDatabase,
  date: string,
  closed: boolean,
  note?: string
) => {
  const now = stamp();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "UPDATE schedule_exception SET deletedAt = ?, updatedAt = ? WHERE date = ? AND kind = 'closure' AND deletedAt IS NULL;",
      now,
      now,
      date
    );
    if (closed) {
      await db.runAsync(
        'INSERT INTO schedule_exception (id, date, kind, studentId, startTime, endTime, note, updatedAt) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?);',
        createId(),
        date,
        'closure',
        note ?? null,
        // 묘비보다 반드시 늦어야 한다. 같으면 병합이 둘 중 하나를 추첨한다.
        stamp()
      );
    }
  });
};

/**
 * 한 원생의 그 날짜 예외를 만든다.
 *
 * extra와 skip은 서로 반대라 같은 날 둘 다 있으면 명단 계산이 모순된다.
 * 새로 넣기 전에 그 원생의 그 날짜 예외를 지워 항상 하나만 남게 한다.
 */
export const upsertStudentException = async (
  db: SQLiteDatabase,
  date: string,
  studentId: string,
  kind: 'extra' | 'skip',
  times?: { startTime: string; endTime: string }
) => {
  const now = stamp();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "UPDATE schedule_exception SET deletedAt = ?, updatedAt = ? WHERE date = ? AND studentId = ? AND kind IN ('extra', 'skip') AND deletedAt IS NULL;",
      now,
      now,
      date,
      studentId
    );
    await db.runAsync(
      'INSERT INTO schedule_exception (id, date, kind, studentId, startTime, endTime, note, updatedAt) VALUES (?, ?, ?, ?, ?, ?, NULL, ?);',
      createId(),
      date,
      kind,
      studentId,
      times?.startTime ?? null,
      times?.endTime ?? null,
      // 묘비보다 반드시 늦어야 한다. 같으면 병합이 둘 중 하나를 추첨한다.
      stamp()
    );
  });
};

export const softDeleteException = (db: SQLiteDatabase, exceptionId: string) => {
  const now = stamp();
  return db.runAsync(
    'UPDATE schedule_exception SET deletedAt = ?, updatedAt = ? WHERE id = ?;',
    now,
    now,
    exceptionId
  );
};
