import * as SQLite from 'expo-sqlite';

const db = SQLite.openDatabase('attendance.db');

export const initDB = () => {
  return new Promise<void>((resolve, reject) => {
    db.transaction((tx) => {
      // Students Table
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS students (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          grade TEXT,
          scheduledDays TEXT,
          scheduledStartTime TEXT,
          scheduledEndTime TEXT,
          fee INTEGER
        );`,
        [],
        () => {
          // Attendance Table
          tx.executeSql(
            `CREATE TABLE IF NOT EXISTS attendance (
              id TEXT PRIMARY KEY,
              studentId TEXT,
              date TEXT NOT NULL,
              time TEXT NOT NULL,
              status TEXT NOT NULL,
              type TEXT NOT NULL,
              FOREIGN KEY (studentId) REFERENCES students (id)
            );`,
            [],
            () => {
              // MakeUp Table
              tx.executeSql(
                `CREATE TABLE IF NOT EXISTS makeup (
                  id TEXT PRIMARY KEY,
                  studentId TEXT,
                  originalDate TEXT NOT NULL,
                  makeUpDate TEXT,
                  completed INTEGER DEFAULT 0,
                  FOREIGN KEY (studentId) REFERENCES students (id)
                );`,
                [],
                () => resolve(),
                (_, error) => {
                  console.error('Error creating makeup table:', error);
                  reject(error);
                  return false;
                }
              );
            },
            (_, error) => {
              console.error('Error creating attendance table:', error);
              reject(error);
              return false;
            }
          );
        },
        (_, error) => {
          console.error('Error creating students table:', error);
          reject(error);
          return false;
        }
      );
    });
  });
};

export const getDB = () => db;
