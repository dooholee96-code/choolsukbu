import * as SQLite from 'expo-sqlite';

/**
 * 연결은 initDB()에서 비동기로 연다.
 *
 * openDatabaseSync를 모듈 최상단에서 부르면 import 시점에 부수효과가 생기고,
 * 웹에서는 동기 open이 워커 응답을 기다리다 'Sync operation timeout'으로 죽어
 * React가 마운트되기도 전에 화면이 백지가 된다.
 */
let db: SQLite.SQLiteDatabase | null = null;

/** 스키마 버전. 컬럼을 바꿀 때 올리고 runMigrations에 분기를 추가한다. */
const DATABASE_VERSION = 2;

export const initDB = async () => {
  if (!db) {
    db = await SQLite.openDatabaseAsync('attendance.db');
  }

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
    CREATE TABLE IF NOT EXISTS schedule_exception (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      kind TEXT NOT NULL,
      studentId TEXT,
      startTime TEXT,
      endTime TEXT,
      note TEXT,
      FOREIGN KEY (studentId) REFERENCES students (id)
    );
    CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance (date);
    CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance (studentId, date);
    CREATE INDEX IF NOT EXISTS idx_exception_date ON schedule_exception (date);
  `);

  await runMigrations();
};

/**
 * user_version을 앵커로 삼는 마이그레이션 훅.
 * 지금은 초기 버전을 기록만 한다. 이후 컬럼 추가 시 여기에 분기를 넣으면
 * 이미 앱을 설치한 기기에서도 스키마를 이어서 올릴 수 있다.
 */
const runMigrations = async () => {
  const database = getDB();
  const row = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  const currentVersion = row?.user_version ?? 0;

  if (currentVersion >= DATABASE_VERSION) return;

  // v2: 일정 예외(휴강·특강·빠짐). 위의 CREATE TABLE IF NOT EXISTS가 새 설치를
  // 이미 처리하므로, 여기서는 v1로 만들어진 기기에 테이블을 뒤늦게 붙여준다.
  if (currentVersion < 2) {
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS schedule_exception (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        kind TEXT NOT NULL,
        studentId TEXT,
        startTime TEXT,
        endTime TEXT,
        note TEXT,
        FOREIGN KEY (studentId) REFERENCES students (id)
      );
      CREATE INDEX IF NOT EXISTS idx_exception_date ON schedule_exception (date);
    `);
  }

  await database.execAsync(`PRAGMA user_version = ${DATABASE_VERSION};`);
};

/**
 * 열린 연결을 돌려준다. initDB()가 끝나기 전에는 호출할 수 없다.
 * App이 초기화 완료 후에만 DataProvider를 렌더하므로 정상 경로에서는 항상 안전하다.
 */
export const getDB = (): SQLite.SQLiteDatabase => {
  if (!db) {
    throw new Error('Database is not ready. initDB() must resolve before getDB().');
  }
  return db;
};
