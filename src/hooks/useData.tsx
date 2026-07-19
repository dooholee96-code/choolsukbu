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
    try {
      // 최신 방식인 getAllAsync 사용
      const allStudents = await db.getAllAsync<any>('SELECT * FROM students;');
      setStudents(
        allStudents.map((row) => ({
          ...row,
          scheduledDays: JSON.parse(row.scheduledDays),
        }))
      );

      const allAttendances = await db.getAllAsync<Attendance>('SELECT * FROM attendance;');
      setAttendances(allAttendances);

      const allMakeups = await db.getAllAsync<MakeUp>('SELECT * FROM makeup;');
      setMakeups(allMakeups);
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  };

  useEffect(() => {
    refreshData();
  }, []);

  const addStudent = async (student: Student) => {
    try {
      // 최신 방식인 runAsync 사용
      await db.runAsync(
        'INSERT INTO students (id, name, grade, scheduledDays, scheduledStartTime, scheduledEndTime, fee) VALUES (?, ?, ?, ?, ?, ?, ?);',
        student.id,
        student.name,
        student.grade,
        JSON.stringify(student.scheduledDays),
        student.scheduledStartTime,
        student.scheduledEndTime,
        student.fee || null
      );
      await refreshData();
    } catch (error) {
      console.error('Error adding student:', error);
      throw error;
    }
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

    try {
      await db.runAsync(
        'INSERT INTO attendance (id, studentId, date, time, status, type) VALUES (?, ?, ?, ?, ?, ?);',
        newAttendance.id,
        newAttendance.studentId,
        newAttendance.date,
        newAttendance.time,
        newAttendance.status,
        newAttendance.type
      );
      await refreshData();
    } catch (error) {
      console.error('Error checking in:', error);
      throw error;
    }
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
