import * as SQLite from 'expo-sqlite';

// 최신 방식인 동기식(Sync) 열기 사용
const db = SQLite.openDatabaseSync('attendance.db');

export const initDB = async () => {
  try {
    // execAsync를 사용하여 한 번에 테이블 생성
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
    `);
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
};

export const getDB = () => db;
