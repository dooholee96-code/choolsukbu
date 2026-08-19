import type { SQLiteDatabase } from 'expo-sqlite';
import { serializeDayTimes } from '../utils/schedule';
import { listAttendanceIncludingDeleted } from '../data/attendance';
import { listExceptionsIncludingDeleted } from '../data/exceptions';
import { listMakeupsIncludingDeleted } from '../data/makeup';
import { listStudentsIncludingDeleted } from '../data/students';
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
 *
 * 행을 객체로 바꾸는 일은 src/data의 도메인 모듈이 한다. 여기에 사본을 두면
 * 컬럼이 하나 늘 때 한쪽만 고쳐지고, 그 차이는 동기화한 뒤에야 드러난다.
 */
export const readAll = async (db: SQLiteDatabase): Promise<MergeResult> => {
  const [students, attendance, makeups, exceptions] = await Promise.all([
    listStudentsIncludingDeleted(db),
    listAttendanceIncludingDeleted(db),
    listMakeupsIncludingDeleted(db),
    listExceptionsIncludingDeleted(db),
  ]);

  return { students, attendance, makeups, exceptions };
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

  // 지운 행도 '반영한 것'이다. 빼고 세면 행을 지워 놓고 0을 돌려주게 되고,
  // 부르는 쪽은 화면을 새로 읽지도, 바뀐 내용을 올리지도 않는다.
  const total =
    students.length +
    attendance.length +
    makeups.length +
    exceptions.length +
    staleAttendance.length +
    staleExceptions.length;
  if (total === 0) return 0;

  await db.withTransactionAsync(async () => {
    for (const row of students) {
      await db.runAsync(
        `INSERT INTO students (id, name, grade, scheduledDays, scheduledStartTime, scheduledEndTime, dayTimes, fee, withdrawnAt, note, updatedAt, deletedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, grade = excluded.grade,
           scheduledDays = excluded.scheduledDays,
           scheduledStartTime = excluded.scheduledStartTime,
           scheduledEndTime = excluded.scheduledEndTime,
           dayTimes = excluded.dayTimes, fee = excluded.fee,
           withdrawnAt = excluded.withdrawnAt, note = excluded.note,
           updatedAt = excluded.updatedAt, deletedAt = excluded.deletedAt;`,
        row.id,
        row.name,
        row.grade,
        JSON.stringify(row.scheduledDays),
        row.scheduledStartTime,
        row.scheduledEndTime,
        serializeDayTimes(row),
        row.fee ?? null,
        row.withdrawnAt ?? null,
        row.note ?? null,
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
        `INSERT INTO attendance (id, studentId, date, time, leaveTime, status, type, updatedAt, deletedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           time = excluded.time, leaveTime = excluded.leaveTime, status = excluded.status,
           updatedAt = excluded.updatedAt, deletedAt = excluded.deletedAt;`,
        row.id,
        row.studentId,
        row.date,
        row.time,
        row.leaveTime ?? null,
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
