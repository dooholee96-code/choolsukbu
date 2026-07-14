import React, { createContext, useState, useEffect, useContext } from 'react';
import { Student, Attendance, MakeUp } from '../types';
import { getDB } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { getCurrentDate, getCurrentTime } from '../utils/date';

interface DataContextType {
  students: Student[];
  attendances: Attendance[];
  makeups: MakeUp[];
  addStudent: (student: Student) => Promise<void>;
  checkInStudent: (studentId: string, status: 'scheduled' | 'unexpected') => Promise<void>;
  refreshData: () => Promise<void>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [students, setStudents] = useState<Student[]>([]);
  const [attendances, setAttendances] = useState<Attendance[]>([]);
  const [makeups, setMakeups] = useState<MakeUp[]>([]);
  const db = getDB();

  const refreshData = async () => {
    db.transaction((tx) => {
      tx.executeSql('SELECT * FROM students;', [], (_, { rows }) =>
        setStudents(
          rows._array.map((row) => ({
            ...row,
            scheduledDays: JSON.parse(row.scheduledDays),
          }))
        )
      );
      tx.executeSql('SELECT * FROM attendance;', [], (_, { rows }) => setAttendances(rows._array));
      tx.executeSql('SELECT * FROM makeup;', [], (_, { rows }) => setMakeups(rows._array));
    });
  };

  useEffect(() => {
    refreshData();
  }, []);

  const addStudent = async (student: Student) => {
    return new Promise<void>((resolve, reject) => {
      db.transaction(
        (tx) => {
          tx.executeSql(
            'INSERT INTO students (id, name, grade, scheduledDays, scheduledStartTime, scheduledEndTime, fee) VALUES (?, ?, ?, ?, ?, ?, ?);',
            [
              student.id,
              student.name,
              student.grade,
              JSON.stringify(student.scheduledDays),
              student.scheduledStartTime,
              student.scheduledEndTime,
              student.fee || null,
            ]
          );
        },
        (error) => reject(error),
        () => {
          refreshData();
          resolve();
        }
      );
    });
  };

  const checkInStudent = async (studentId: string, status: 'scheduled' | 'unexpected') => {
    const newAttendance: Attendance = {
      id: uuidv4(),
      studentId,
      date: getCurrentDate(),
      time: getCurrentTime(),
      status,
      type: 'checkIn',
    };

    return new Promise<void>((resolve, reject) => {
      db.transaction(
        (tx) => {
          tx.executeSql(
            'INSERT INTO attendance (id, studentId, date, time, status, type) VALUES (?, ?, ?, ?, ?, ?);',
            [
              newAttendance.id,
              newAttendance.studentId,
              newAttendance.date,
              newAttendance.time,
              newAttendance.status,
              newAttendance.type,
            ]
          );
        },
        (error) => reject(error),
        () => {
          refreshData();
          resolve();
        }
      );
    });
  };

  return (
    <DataContext.Provider
      value={{ students, attendances, makeups, addStudent, checkInStudent, refreshData }}
    >
      {children}
    </DataContext.Provider>
  );
};

export const useData = () => {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
};
