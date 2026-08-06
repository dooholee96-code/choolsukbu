import * as SQLite from 'expo-sqlite';

const db = SQLite.openDatabaseSync('attendance.db');

/** 스키마 버전. 컬럼을 바꿀 때 올리고 runMigrations에 분기를 추가한다. */
const DATABASE_VERSION = 1;

export const initDB = async () => {
  // SQLite는 FOREIGN KEY 선언이 있어도 기본적으로 제약을 강제하지 않는다.
  // (expo-sqlite도 켜주지 않으므로 연결마다 직접 켜야 한다.)
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      grade TEXT,
      scheduledDays TEXT,
      scheduledStartTime TEXT,
      scheduledEndTime TEXT,
      fee INTEGER
    );
    CREATE TABLE IF NOT EXISTS attendance (
      id TEXT PRIMARY KEY,
      studentId TEXT,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      status TEXT NOT NULL,
      type TEXT NOT NULL,
      FOREIGN KEY (studentId) REFERENCES students (id)
    );
    CREATE TABLE IF NOT EXISTS makeup (
      id TEXT PRIMARY KEY,
      studentId TEXT,
      originalDate TEXT NOT NULL,
      makeUpDate TEXT,
      completed INTEGER DEFAULT 0,
      FOREIGN KEY (studentId) REFERENCES students (id)
    );
    CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance (date);
    CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance (studentId, date);
  `);

  await runMigrations();
};

/**
 * user_version을 앵커로 삼는 마이그레이션 훅.
 * 지금은 초기 버전을 기록만 한다. 이후 컬럼 추가 시 여기에 분기를 넣으면
 * 이미 앱을 설치한 기기에서도 스키마를 이어서 올릴 수 있다.
 */
const runMigrations = async () => {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  const currentVersion = row?.user_version ?? 0;

  if (currentVersion >= DATABASE_VERSION) return;

  // 예시: if (currentVersion < 2) { await db.execAsync('ALTER TABLE ...'); }

  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION};`);
};

export const getDB = () => db;
