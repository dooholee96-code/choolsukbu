import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * 연결은 initDB()에서 비동기로 연다.
 *
 * openDatabaseSync를 모듈 최상단에서 부르면 import 시점에 부수효과가 생기고,
 * 웹에서는 동기 open이 워커 응답을 기다리다 'Sync operation timeout'으로 죽어
 * React가 마운트되기도 전에 화면이 백지가 된다.
 */
let db: SQLiteDatabase | null = null;

/** 스키마 버전. 컬럼을 바꿀 때 올리고 runMigrations에 분기를 추가한다. */
const DATABASE_VERSION = 4;

export const initDB = async () => {
  if (!db) {
    // 여는 순간에만 네이티브 모듈을 부른다. 최상단에서 부르면 스키마와
    // 마이그레이션이 React Native에 묶여, 실제 데이터가 든 옛 버전
    // 데이터베이스를 만들어 올려보는 검증을 할 수 없다.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SQLite = require('expo-sqlite') as {
      openDatabaseAsync: (name: string) => Promise<SQLiteDatabase>;
    };
    db = await SQLite.openDatabaseAsync('attendance.db');
  }

  // SQLite는 FOREIGN KEY 선언이 있어도 기본적으로 제약을 강제하지 않는다.
  // (expo-sqlite도 켜주지 않으므로 연결마다 직접 켜야 한다.)
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');

  await createSchema(db);
  await runMigrations(db);
};

/** 새 설치용. 이미 있는 기기에서는 전부 no-op이고 migrate가 이어받는다. */
export const createSchema = async (database: SQLiteDatabase) => {
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      grade TEXT,
      scheduledDays TEXT,
      scheduledStartTime TEXT,
      scheduledEndTime TEXT,
      dayTimes TEXT,
      fee INTEGER,
      updatedAt TEXT,
      deletedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS attendance (
      id TEXT PRIMARY KEY,
      studentId TEXT,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      status TEXT NOT NULL,
      type TEXT NOT NULL,
      updatedAt TEXT,
      deletedAt TEXT,
      FOREIGN KEY (studentId) REFERENCES students (id)
    );
    CREATE TABLE IF NOT EXISTS makeup (
      id TEXT PRIMARY KEY,
      studentId TEXT,
      originalDate TEXT NOT NULL,
      makeUpDate TEXT,
      completed INTEGER DEFAULT 0,
      updatedAt TEXT,
      deletedAt TEXT,
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
      updatedAt TEXT,
      deletedAt TEXT,
      FOREIGN KEY (studentId) REFERENCES students (id)
    );
    CREATE TABLE IF NOT EXISTS device (
      id TEXT PRIMARY KEY,
      deviceId TEXT NOT NULL,
      lastSyncAt TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance (date);
    CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance (studentId, date);
    CREATE INDEX IF NOT EXISTS idx_exception_date ON schedule_exception (date);
  `);
};

/**
 * user_version을 앵커로 삼는 마이그레이션.
 *
 * 각 단계는 여러 번 돌려도 같은 결과가 나오도록 썼다. user_version은 맨 끝에서
 * 올리므로, 도중에 앱이 죽으면 다음 실행에서 처음부터 다시 도는데 그때 이미
 * 끝난 단계를 또 밟기 때문이다.
 *
 * db를 인자로 받는 이유는 실제 데이터가 든 옛 버전 데이터베이스를 만들어
 * 올려보는 검증을 하기 위해서다. 여기서 실수하면 사용자의 기록이 사라진다.
 */
export const runMigrations = async (database: SQLiteDatabase) => {
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

  // v3: 요일별 수업 시간. 위의 CREATE TABLE이 새 설치를 처리하므로 여기서는
  // 이미 students 테이블이 있는 기기에만 컬럼을 붙인다. NULL이면 모든 요일이
  // scheduledStartTime/EndTime을 쓰므로 기존 데이터는 그대로 동작한다.
  if (currentVersion < 3) {
    const columns = await database.getAllAsync<{ name: string }>(
      'PRAGMA table_info(students);'
    );
    if (!columns.some((column) => column.name === 'dayTimes')) {
      await database.execAsync('ALTER TABLE students ADD COLUMN dayTimes TEXT;');
    }
  }

  // v4: 동기화용 메타. updatedAt은 두 기기 기록이 겹칠 때 최신을 가리는 근거이고,
  // deletedAt은 삭제가 상대 기기 파일에서 되살아나지 않게 하는 묘비다.
  // 이미 있는 행은 지금 시각으로 채운다 — 값이 비어 있으면 병합에서 항상 진다.
  if (currentVersion < 4) {
    const now = new Date().toISOString();

    for (const table of ['students', 'attendance', 'makeup', 'schedule_exception']) {
      const columns = await database.getAllAsync<{ name: string }>(
        `PRAGMA table_info(${table});`
      );
      for (const column of ['updatedAt', 'deletedAt']) {
        if (!columns.some((existing) => existing.name === column)) {
          await database.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT;`);
        }
      }
      // 값이 비어 있으면 병합에서 항상 지므로, 있는 행은 지금 시각으로 채운다.
      await database.runAsync(
        `UPDATE ${table} SET updatedAt = ? WHERE updatedAt IS NULL;`,
        now
      );
    }

    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS device (
        id TEXT PRIMARY KEY,
        deviceId TEXT NOT NULL,
        lastSyncAt TEXT
      );
    `);
  }

  await database.execAsync(`PRAGMA user_version = ${DATABASE_VERSION};`);
};

/**
 * 열린 연결을 돌려준다. initDB()가 끝나기 전에는 호출할 수 없다.
 * App이 초기화 완료 후에만 DataProvider를 렌더하므로 정상 경로에서는 항상 안전하다.
 */
export const getDB = (): SQLiteDatabase => {
  if (!db) {
    throw new Error('Database is not ready. initDB() must resolve before getDB().');
  }
  return db;
};
