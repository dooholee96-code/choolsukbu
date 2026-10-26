import type { SQLiteDatabase } from 'expo-sqlite';
import { Attendance } from '../types';
import { datesBetween, planPresence, presenceRange } from '../utils/presence';
import { listRange as listExceptionsRange } from './exceptions';
import { listStudents } from './students';

/**
 * '결석만 표시' 출석에서 지난날의 출석을 채운다 (계산은 utils/presence).
 *
 * 이미 채운 날은 다시 보지 않는다. 다시 보면 그 사이에 새로 등록한 원생이, 등록하기 전
 * 날들에까지 출석으로 들어간다 — 원생에게는 등록일이 따로 없어서 명단만으로는 구분이
 * 안 된다. 채운 날은 이 기기의 presence_fill에 적고, 다른 기기가 채워 동기화로 넘어온
 * 날(자동 출석 행이 있는 날)도 채운 날로 본다.
 *
 * 채운 수를 돌려준다.
 */
export const fillPresence = async (
  db: SQLiteDatabase,
  since: string | null | undefined,
  today: string
): Promise<number> => {
  const range = presenceRange(since, today);
  if (!range) return 0;

  const [doneRows, autoRows] = await Promise.all([
    db.getAllAsync<{ date: string }>(
      'SELECT date FROM presence_fill WHERE date >= ? AND date <= ?;',
      range.from,
      range.to
    ),
    db.getAllAsync<{ date: string }>(
      "SELECT DISTINCT date FROM attendance WHERE id LIKE 'auto:%' AND date >= ? AND date <= ?;",
      range.from,
      range.to
    ),
  ]);
  const done = new Set([...doneRows, ...autoRows].map((row) => row.date));
  const dates = datesBetween(range.from, range.to).filter((date) => !done.has(date));
  if (dates.length === 0) return 0;

  const from = dates[0];
  const to = dates[dates.length - 1];
  const [students, exceptions, existing] = await Promise.all([
    listStudents(db),
    listExceptionsRange(db, from, to),
    db.getAllAsync<Attendance>(
      "SELECT * FROM attendance WHERE type = 'checkIn' AND date >= ? AND date <= ?;",
      from,
      to
    ),
  ]);

  const rows = planPresence({ students, exceptions, existing, dates });
  let inserted = 0;

  await db.withTransactionAsync(async () => {
    for (const row of rows) {
      // 계산과 쓰기 사이에 누른 결석이 끼어들 수 있으므로 한 문장에서 다시 확인한다.
      const result = await db.runAsync(
        `INSERT OR IGNORE INTO attendance (id, studentId, date, time, leaveTime, status, type, updatedAt, deletedAt)
         SELECT ?, ?, ?, ?, NULL, ?, 'checkIn', ?, NULL
         WHERE NOT EXISTS (
           SELECT 1 FROM attendance
           WHERE studentId = ? AND date = ? AND type = 'checkIn' AND deletedAt IS NULL
         );`,
        row.id,
        row.studentId,
        row.date,
        row.time,
        row.status,
        row.updatedAt ?? null,
        row.studentId,
        row.date
      );
      inserted += result.changes;
    }
    for (const date of dates) {
      await db.runAsync('INSERT OR IGNORE INTO presence_fill (date) VALUES (?);', date);
    }
  });

  return inserted;
};
