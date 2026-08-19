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

/**
 * 화면이 보는 명단. 퇴원생도 들어 있다.
 *
 * 퇴원생을 여기서 빼면 그 학생의 출결 이력이 화면에서 통째로 사라진다 —
 * 이력 화면은 이 목록으로 id를 이름에 붙이는데, 이름을 못 찾은 줄은 버리기
 * 때문이다. 오늘 명단에서 빼는 일은 buildRoster가, 목록에서 접어두는 일은
 * 원생 화면이 한다.
 */
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
    'INSERT INTO students (id, name, grade, scheduledDays, scheduledStartTime, scheduledEndTime, dayTimes, fee, withdrawnAt, note, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);',
    student.id,
    student.name,
    student.grade,
    JSON.stringify(student.scheduledDays),
    student.scheduledStartTime,
    student.scheduledEndTime,
    serializeDayTimes(student),
    student.fee ?? null,
    student.withdrawnAt ?? null,
    student.note?.trim() || null,
    stamp()
  );

/**
 * 원생 정보 수정. withdrawnAt은 일부러 건드리지 않는다 — 퇴원과 복학은
 * setWithdrawn으로만 바뀐다. 폼이 들고 있는 값으로 같이 쓰면, 퇴원한 학생의
 * 수업 시간을 고치는 것만으로 조용히 복학 처리가 된다.
 */
export const updateStudentRow = (db: SQLiteDatabase, student: Student) =>
  db.runAsync(
    'UPDATE students SET name = ?, grade = ?, scheduledDays = ?, scheduledStartTime = ?, scheduledEndTime = ?, dayTimes = ?, fee = ?, note = ?, updatedAt = ? WHERE id = ?;',
    student.name,
    student.grade,
    JSON.stringify(student.scheduledDays),
    student.scheduledStartTime,
    student.scheduledEndTime,
    serializeDayTimes(student),
    student.fee ?? null,
    student.note?.trim() || null,
    stamp(),
    student.id
  );

/**
 * 퇴원·복학. date에 날짜를 주면 그 날부터 명단에서 빠지고, null이면 되돌린다.
 *
 * 출결·보충·일정은 그대로 둔다. 그 기록들이 사라지지 않는 것이 삭제 대신
 * 퇴원을 두는 이유 전부다.
 */
export const setWithdrawn = (db: SQLiteDatabase, studentId: string, date: string | null) => {
  const now = stamp();
  return db.runAsync(
    'UPDATE students SET withdrawnAt = ?, updatedAt = ? WHERE id = ?;',
    date,
    now,
    studentId
  );
};

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
 * 이미 있는 원생은 건너뛴다. 같은 파일을 두 번 가져와도 명단이 복제되면 안 된다.
 *
 * 같은지 보는 기준은 이름 + 학년 + 구분이다. 이름만 보면 김민준이 둘인 학원에서
 * 두 번째 김민준이 영영 들어오지 않는다 — 조용히 건너뛰므로 빠졌다는 사실조차
 * 모른다. 학년까지 같은 동명이인은 구분(note)에 한 마디를 적어 가른다.
 */
const identityOf = (student: Student) =>
  [student.name.trim(), student.grade.trim(), student.note?.trim() ?? ''].join('|');

export const importStudentRows = async (db: SQLiteDatabase, incoming: Student[]) => {
  let added = 0;
  let skipped = 0;

  await db.withTransactionAsync(async () => {
    const existing = await db.getAllAsync<{ name: string; grade: string; note: string | null }>(
      'SELECT name, grade, note FROM students WHERE deletedAt IS NULL;'
    );
    // 파일 안에 같은 사람이 두 번 있을 수도 있으므로, 넣은 것도 함께 기억한다.
    const seen = new Set(
      existing.map((row) =>
        [row.name?.trim() ?? '', row.grade?.trim() ?? '', row.note?.trim() ?? ''].join('|')
      )
    );

    for (const student of incoming) {
      const identity = identityOf(student);
      if (seen.has(identity)) {
        skipped += 1;
        continue;
      }
      await insertStudent(db, student);
      seen.add(identity);
      added += 1;
    }
  });

  return { added, skipped };
};
