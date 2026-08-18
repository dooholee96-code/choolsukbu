import type { SQLiteDatabase } from 'expo-sqlite';
import { Attendance, DayOfWeek, ExceptionKind, MakeUp, ScheduleException, Student } from '../types';
import { parseDayTimes, serializeDayTimes } from '../utils/schedule';
import {
  attendanceKey,
  changedRows,
  exceptionKey,
  makeupKey,
  MergeResult,
  studentKey,
  supersededIds,
} from './merge';

/**
 * 동기화가 보는 DB. 화면 질의와 다르게 **삭제된 행까지 전부** 읽는다.
 * 묘비를 빼고 내보내면 상대 기기는 삭제가 있었다는 사실을 영영 모른다.
 */

const VALID_DAYS: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const VALID_KINDS: ExceptionKind[] = ['closure', 'extra', 'skip'];

type StudentRow = Omit<Student, 'scheduledDays' | 'dayTimes'> & {
  scheduledDays: string;
  dayTimes: string | null;
};

type ExceptionRow = Omit<ScheduleException, 'kind' | 'studentId' | 'startTime' | 'endTime' | 'note'> & {
  kind: string;
  studentId: string | null;
  startTime: string | null;
  endTime: string | null;
  note: string | null;
};

const parseDays = (raw: unknown): DayOfWeek[] => {
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((day): day is DayOfWeek => VALID_DAYS.includes(day))
      : [];
  } catch {
    return [];
  }
};

export const readAll = async (db: SQLiteDatabase): Promise<MergeResult> => {
  const [students, attendance, makeups, exceptions] = await Promise.all([
    db.getAllAsync<StudentRow>('SELECT * FROM students;'),
    db.getAllAsync<Attendance>('SELECT * FROM attendance;'),
    db.getAllAsync<MakeUp>('SELECT * FROM makeup;'),
    db.getAllAsync<ExceptionRow>('SELECT * FROM schedule_exception;'),
  ]);

  return {
    students: students.map((row) => ({
      ...row,
      scheduledDays: parseDays(row.scheduledDays),
      dayTimes: parseDayTimes(row.dayTimes),
      deletedAt: row.deletedAt ?? null,
    })),
    attendance: attendance.map((row) => ({ ...row, deletedAt: row.deletedAt ?? null })),
    makeups: makeups.map((row) => ({
      ...row,
      // SQLite는 boolean이 없어 0/1로 돌아온다. JSON으로 나갈 때 형이 흔들리지 않게 맞춘다.
      completed: Boolean(row.completed),
      deletedAt: row.deletedAt ?? null,
    })),
    exceptions: exceptions.map((row) => ({
      ...row,
      kind: (VALID_KINDS.includes(row.kind as ExceptionKind) ? row.kind : 'skip') as ExceptionKind,
      studentId: row.studentId ?? undefined,
      startTime: row.startTime ?? undefined,
      endTime: row.endTime ?? undefined,
      note: row.note ?? undefined,
      deletedAt: row.deletedAt ?? null,
    })),
  };
};

/**
 * 병합 결과를 로컬에 반영한다.
 *
 * 달라진 행만 만진다. 전부 다시 쓰면 원생 50명의 1년치가 매번 통째로 갱신되고,
 * 그때마다 updatedAt이 흔들려 다음 병합이 또 커진다.
 *
 * 외래키가 켜져 있으므로 원생을 먼저 넣어야 그에 딸린 행이 들어간다. 상대 기기가
 * 새 원생과 그 학생의 등원을 함께 보냈을 때 순서가 뒤집히면 제약 위반이 난다.
 */
export const applyMerge = async (
  db: SQLiteDatabase,
  local: MergeResult,
  merged: MergeResult
): Promise<number> => {
  const students = changedRows(studentKey, local.students, merged.students);
  const attendance = changedRows(attendanceKey, local.attendance, merged.attendance);
  const makeups = changedRows(makeupKey, local.makeups, merged.makeups);
  const exceptions = changedRows(exceptionKey, local.exceptions, merged.exceptions);

  // 같은 키에서 진 로컬 행. 남겨두면 화면에 중복으로 뜬다.
  const staleAttendance = supersededIds(attendanceKey, local.attendance, merged.attendance);
  const staleExceptions = supersededIds(exceptionKey, local.exceptions, merged.exceptions);

  const total =
    students.length + attendance.length + makeups.length + exceptions.length;
  if (total === 0 && staleAttendance.length === 0 && staleExceptions.length === 0) return 0;

  await db.withTransactionAsync(async () => {
    for (const row of students) {
      await db.runAsync(
        `INSERT INTO students (id, name, grade, scheduledDays, scheduledStartTime, scheduledEndTime, dayTimes, fee, updatedAt, deletedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, grade = excluded.grade,
           scheduledDays = excluded.scheduledDays,
           scheduledStartTime = excluded.scheduledStartTime,
           scheduledEndTime = excluded.scheduledEndTime,
           dayTimes = excluded.dayTimes, fee = excluded.fee,
           updatedAt = excluded.updatedAt, deletedAt = excluded.deletedAt;`,
        row.id,
        row.name,
        row.grade,
        JSON.stringify(row.scheduledDays),
        row.scheduledStartTime,
        row.scheduledEndTime,
        serializeDayTimes(row),
        row.fee ?? null,
        row.updatedAt ?? null,
        row.deletedAt ?? null
      );
    }

    for (const id of staleAttendance) {
      await db.runAsync('DELETE FROM attendance WHERE id = ?;', id);
    }
    for (const id of staleExceptions) {
      await db.runAsync('DELETE FROM schedule_exception WHERE id = ?;', id);
    }

    for (const row of attendance) {
      await db.runAsync(
        `INSERT INTO attendance (id, studentId, date, time, status, type, updatedAt, deletedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           time = excluded.time, status = excluded.status,
           updatedAt = excluded.updatedAt, deletedAt = excluded.deletedAt;`,
        row.id,
        row.studentId,
        row.date,
        row.time,
        row.status,
        row.type,
        row.updatedAt ?? null,
        row.deletedAt ?? null
      );
    }

    for (const row of makeups) {
      await db.runAsync(
        `INSERT INTO makeup (id, studentId, originalDate, makeUpDate, completed, updatedAt, deletedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           makeUpDate = excluded.makeUpDate, completed = excluded.completed,
           updatedAt = excluded.updatedAt, deletedAt = excluded.deletedAt;`,
        row.id,
        row.studentId,
        row.originalDate,
        row.makeUpDate ?? null,
        row.completed ? 1 : 0,
        row.updatedAt ?? null,
        row.deletedAt ?? null
      );
    }

    for (const row of exceptions) {
      await db.runAsync(
        `INSERT INTO schedule_exception (id, date, kind, studentId, startTime, endTime, note, updatedAt, deletedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           startTime = excluded.startTime, endTime = excluded.endTime, note = excluded.note,
           updatedAt = excluded.updatedAt, deletedAt = excluded.deletedAt;`,
        row.id,
        row.date,
        row.kind,
        row.studentId ?? null,
        row.startTime ?? null,
        row.endTime ?? null,
        row.note ?? null,
        row.updatedAt ?? null,
        row.deletedAt ?? null
      );
    }
  });

  return total;
};
