import type { SQLiteDatabase } from 'expo-sqlite';
import { Attendance } from '../types';
import { getCurrentTime } from '../utils/date';
import { createId } from '../utils/id';
import { stamp } from './stamp';

/**
 * 오늘 정규 수업에 대한 기록이 이미 있는지 본다.
 * 출석과 결석은 같은 자리를 두고 다투는 값이므로 type으로만 판정한다.
 */
export const findCheckIn = (db: SQLiteDatabase, studentId: string, date: string) =>
  db.getFirstAsync<{ id: string }>(
    'SELECT id FROM attendance WHERE studentId = ? AND date = ? AND type = ? AND deletedAt IS NULL LIMIT 1;',
    studentId,
    date,
    'checkIn'
  );

/** 화면이 쓰는 것은 오늘 기록뿐이다. 전체 이력은 필요할 때 따로 읽는다. */
export const listForDate = (db: SQLiteDatabase, date: string) =>
  db.getAllAsync<Attendance>(
    'SELECT * FROM attendance WHERE date = ? AND type = ? AND deletedAt IS NULL;',
    date,
    'checkIn'
  );

/** 동기화 전용. 묘비까지 전부. */
export const listAttendanceIncludingDeleted = async (db: SQLiteDatabase): Promise<Attendance[]> => {
  const rows = await db.getAllAsync<Attendance>('SELECT * FROM attendance;');
  return rows.map((row) => ({ ...row, deletedAt: row.deletedAt ?? null }));
};

export const listAllAttendance = (db: SQLiteDatabase) =>
  db.getAllAsync<Attendance>(
    'SELECT * FROM attendance WHERE deletedAt IS NULL ORDER BY date, time;'
  );

/** 이력 화면이 보고 있는 달만 읽는다. idx_attendance_date를 탄다. */
export const listAttendanceRange = (db: SQLiteDatabase, fromDate: string, toDate: string) =>
  db.getAllAsync<Attendance>(
    'SELECT * FROM attendance WHERE date >= ? AND date <= ? AND deletedAt IS NULL ORDER BY date DESC, time DESC;',
    fromDate,
    toDate
  );

export const insertCheckIn = (
  db: SQLiteDatabase,
  studentId: string,
  date: string,
  status: 'scheduled' | 'unexpected'
) =>
  db.runAsync(
    'INSERT INTO attendance (id, studentId, date, time, status, type, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?);',
    createId(),
    studentId,
    date,
    getCurrentTime(),
    status,
    'checkIn',
    stamp()
  );

/**
 * 결석 처리. 출결에 absent를 남기고 같은 날짜로 보충 건을 연다.
 * 보충은 결석에서만 생기므로 두 기록은 항상 함께 만들어져야 한다.
 */
export const insertAbsence = async (db: SQLiteDatabase, studentId: string, date: string) => {
  const now = stamp();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'INSERT INTO attendance (id, studentId, date, time, status, type, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?);',
      createId(),
      studentId,
      date,
      getCurrentTime(),
      'absent',
      'checkIn',
      now
    );
    await db.runAsync(
      'INSERT INTO makeup (id, studentId, originalDate, makeUpDate, completed, updatedAt) VALUES (?, ?, ?, ?, 0, ?);',
      createId(),
      studentId,
      date,
      null,
      now
    );
  });
};

/**
 * 오늘 기록 취소. 결석을 취소하면 그때 열린 보충 건도 같이 지운다.
 * 다만 이미 보충일을 잡았거나 완료한 건은 별개의 판단이 들어간 기록이라 건드리지 않는다.
 */
export const softDeleteCheckIn = async (db: SQLiteDatabase, studentId: string, date: string) => {
  const now = stamp();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'UPDATE attendance SET deletedAt = ?, updatedAt = ? WHERE studentId = ? AND date = ? AND type = ? AND deletedAt IS NULL;',
      now,
      now,
      studentId,
      date,
      'checkIn'
    );
    await db.runAsync(
      'UPDATE makeup SET deletedAt = ?, updatedAt = ? WHERE studentId = ? AND originalDate = ? AND completed = 0 AND makeUpDate IS NULL AND deletedAt IS NULL;',
      now,
      now,
      studentId,
      date
    );
  });
};

export const updateTime = (db: SQLiteDatabase, attendanceId: string, time: string) =>
  db.runAsync(
    'UPDATE attendance SET time = ?, updatedAt = ? WHERE id = ?;',
    time,
    stamp(),
    attendanceId
  );
