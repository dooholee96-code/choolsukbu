import type { SQLiteDatabase } from 'expo-sqlite';
import { Attendance } from '../types';
import { getCurrentTime } from '../utils/date';
import { createId } from '../utils/id';
import { stamp } from './stamp';

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

/**
 * 그 날 정규 기록이 아직 없을 때만 넣는다.
 *
 * 확인과 삽입을 한 문장으로 묶는다. 먼저 조회하고 따로 넣으면, 연타로 두 요청이
 * 겹쳤을 때 둘 다 '없음'을 본 뒤 둘 다 넣어 같은 날 등원이 두 줄 남는다.
 * 출석과 결석은 같은 자리를 두고 다투는 값이므로 status가 아니라 type으로 본다.
 */
export const insertCheckIn = (
  db: SQLiteDatabase,
  studentId: string,
  date: string,
  status: 'scheduled' | 'unexpected'
) =>
  db.runAsync(
    `INSERT INTO attendance (id, studentId, date, time, status, type, updatedAt)
     SELECT ?, ?, ?, ?, ?, 'checkIn', ?
     WHERE NOT EXISTS (
       SELECT 1 FROM attendance
       WHERE studentId = ? AND date = ? AND type = 'checkIn' AND deletedAt IS NULL
     );`,
    createId(),
    studentId,
    date,
    getCurrentTime(),
    status,
    stamp(),
    studentId,
    date
  );

/**
 * 결석 처리. 출결에 absent를 남기고 같은 날짜로 보충 건을 연다.
 * 보충은 결석에서만 생기므로 두 기록은 항상 함께 만들어져야 한다.
 *
 * 등원과 같은 방식으로 한 문장에서 확인하고 넣는다. 그 날 기록이 이미 있으면
 * (먼저 찍힌 등원, 연타로 겹친 결석) 아무것도 남기지 않는다 — 보충 건도 열지 않는다.
 * 결석 기록 없이 보충만 생기면 빠진 적 없는 수업을 메우라는 건이 된다.
 */
export const insertAbsence = async (db: SQLiteDatabase, studentId: string, date: string) => {
  const now = stamp();

  await db.withTransactionAsync(async () => {
    const inserted = await db.runAsync(
      `INSERT INTO attendance (id, studentId, date, time, status, type, updatedAt)
       SELECT ?, ?, ?, ?, 'absent', 'checkIn', ?
       WHERE NOT EXISTS (
         SELECT 1 FROM attendance
         WHERE studentId = ? AND date = ? AND type = 'checkIn' AND deletedAt IS NULL
       );`,
      createId(),
      studentId,
      date,
      getCurrentTime(),
      now,
      studentId,
      date
    );
    if (inserted.changes === 0) return;

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

/**
 * 하원 시각. null을 주면 지운다 (잘못 찍었을 때).
 *
 * 결석 행에는 붙이지 않는다 — 오지 않은 학생이 몇 시에 갔는지는 없는 값이고,
 * 남으면 이력에서 조퇴처럼 읽힌다.
 */
export const setLeaveTime = (
  db: SQLiteDatabase,
  attendanceId: string,
  time: string | null
) =>
  db.runAsync(
    "UPDATE attendance SET leaveTime = ?, updatedAt = ? WHERE id = ? AND status != 'absent';",
    time,
    stamp(),
    attendanceId
  );
