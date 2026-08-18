import type { SQLiteDatabase } from 'expo-sqlite';
import { DayOfWeek, Student } from '../types';
import { parseDayTimes, serializeDayTimes } from '../utils/schedule';
import { stamp } from './stamp';

const VALID_DAYS: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * scheduledDays는 JSON 문자열로 저장된다. 한 행이라도 값이 깨져 있으면
 * map 전체가 throw하고 부르는 쪽의 catch가 이를 삼켜서 원생 목록이
 * 통째로 비어버리므로, 행 단위로 방어한다.
 */
const parseScheduledDays = (raw: unknown): DayOfWeek[] => {
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((day): day is DayOfWeek => VALID_DAYS.includes(day));
  } catch {
    return [];
  }
};

type Row = Omit<Student, 'scheduledDays' | 'dayTimes'> & {
  scheduledDays: string;
  dayTimes: string | null;
};

const toStudent = (row: Row): Student => ({
  ...row,
  scheduledDays: parseScheduledDays(row.scheduledDays),
  dayTimes: parseDayTimes(row.dayTimes),
});

export const listStudents = async (db: SQLiteDatabase): Promise<Student[]> => {
  const rows = await db.getAllAsync<Row>(
    'SELECT * FROM students WHERE deletedAt IS NULL ORDER BY name;'
  );
  return rows.map(toStudent);
};

/** 동기화 전용. 묘비를 빼고 내보내면 상대 기기는 삭제를 영영 모른다. */
export const listStudentsIncludingDeleted = async (db: SQLiteDatabase): Promise<Student[]> => {
  const rows = await db.getAllAsync<Row>('SELECT * FROM students;');
  return rows.map((row) => ({ ...toStudent(row), deletedAt: row.deletedAt ?? null }));
};

export const insertStudent = (db: SQLiteDatabase, student: Student) =>
  db.runAsync(
    'INSERT INTO students (id, name, grade, scheduledDays, scheduledStartTime, scheduledEndTime, dayTimes, fee, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);',
    student.id,
    student.name,
    student.grade,
    JSON.stringify(student.scheduledDays),
    student.scheduledStartTime,
    student.scheduledEndTime,
    serializeDayTimes(student),
    student.fee ?? null,
    stamp()
  );

export const updateStudentRow = (db: SQLiteDatabase, student: Student) =>
  db.runAsync(
    'UPDATE students SET name = ?, grade = ?, scheduledDays = ?, scheduledStartTime = ?, scheduledEndTime = ?, dayTimes = ?, fee = ?, updatedAt = ? WHERE id = ?;',
    student.name,
    student.grade,
    JSON.stringify(student.scheduledDays),
    student.scheduledStartTime,
    student.scheduledEndTime,
    serializeDayTimes(student),
    student.fee ?? null,
    stamp(),
    student.id
  );

/**
 * 원생과 그에 딸린 기록을 지운다.
 *
 * 행을 없애지 않고 deletedAt만 찍는다. 그냥 지우면 상대 기기 파일에는 아직
 * 그 원생이 남아 있어 다음 동기화에서 되살아난다. 화면 질의가 모두
 * deletedAt IS NULL로 거르므로 사용자에게는 삭제된 것과 같다.
 *
 * 네 테이블이 한꺼번에 넘어가야 하므로 트랜잭션으로 묶는다.
 */
export const softDeleteStudent = async (db: SQLiteDatabase, studentId: string) => {
  const now = stamp();

  await db.withTransactionAsync(async () => {
    for (const table of ['attendance', 'makeup', 'schedule_exception']) {
      await db.runAsync(
        `UPDATE ${table} SET deletedAt = ?, updatedAt = ? WHERE studentId = ? AND deletedAt IS NULL;`,
        now,
        now,
        studentId
      );
    }
    await db.runAsync(
      'UPDATE students SET deletedAt = ?, updatedAt = ? WHERE id = ?;',
      now,
      now,
      studentId
    );
  });
};

/**
 * 이름이 같은 원생은 건너뛴다. 같은 파일을 두 번 가져와도 명단이 복제되지
 * 않아야 하고, 이 앱에는 학번 같은 외부 식별자가 없어서 이름이 유일한 실용적 기준이다.
 */
export const importStudentRows = async (db: SQLiteDatabase, incoming: Student[]) => {
  let added = 0;
  let skipped = 0;

  await db.withTransactionAsync(async () => {
    for (const student of incoming) {
      const existing = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM students WHERE name = ? AND deletedAt IS NULL LIMIT 1;',
        student.name
      );
      if (existing) {
        skipped += 1;
        continue;
      }
      await insertStudent(db, student);
      added += 1;
    }
  });

  return { added, skipped };
};
