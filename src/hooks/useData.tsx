import React, { createContext, useState, useEffect, useContext, useCallback, useMemo } from 'react';
import { Student, Attendance, MakeUp, DayOfWeek } from '../types';
import { getDB } from '../db';
import { createId } from '../utils/id';
import { getCurrentDate, getCurrentTime } from '../utils/date';
import { logger } from '../utils/logger';

interface DataContextType {
  students: Student[];
  /** 오늘 날짜의 checkIn 기록만. 전체 이력은 DB에만 있다. */
  todayAttendances: Attendance[];
  makeups: MakeUp[];
  addStudent: (student: Student) => Promise<void>;
  checkInStudent: (studentId: string, status: 'scheduled' | 'unexpected') => Promise<void>;
  refreshData: () => Promise<void>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

const VALID_DAYS: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * scheduledDays는 JSON 문자열로 저장된다. 한 행이라도 값이 깨져 있으면
 * map 전체가 throw하고 refreshData의 catch가 이를 삼켜서 원생 목록이
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

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [students, setStudents] = useState<Student[]>([]);
  const [todayAttendances, setTodayAttendances] = useState<Attendance[]>([]);
  const [makeups, setMakeups] = useState<MakeUp[]>([]);
  const db = getDB();

  const refreshData = useCallback(async () => {
    try {
      const allStudents = await db.getAllAsync<Omit<Student, 'scheduledDays'> & {
        scheduledDays: string;
      }>('SELECT * FROM students ORDER BY name;');
      setStudents(
        allStudents.map((row) => ({
          ...row,
          scheduledDays: parseScheduledDays(row.scheduledDays),
        }))
      );

      // 화면이 쓰는 것은 오늘 기록뿐인데 이전에는 출결 테이블 전체를
      // 메모리에 올렸고, refreshData는 쓰기가 일어날 때마다 호출된다.
      // 원생 50명이면 연 1만 행 규모로 누적되므로 체크인 한 번의 비용이
      // 누적 이력에 비례해 늘어난다. 오늘 날짜로 범위를 좁혀 비용을 고정한다.
      // (idx_attendance_date 인덱스를 탄다. 이력 조회 기능은 필요할 때
      //  별도 쿼리로 가져오면 된다 — DB에는 그대로 남아 있다.)
      const todayRecords = await db.getAllAsync<Attendance>(
        'SELECT * FROM attendance WHERE date = ? AND type = ?;',
        getCurrentDate(),
        'checkIn'
      );
      setTodayAttendances(todayRecords);

      const pendingMakeups = await db.getAllAsync<MakeUp>(
        'SELECT * FROM makeup WHERE completed = 0;'
      );
      setMakeups(pendingMakeups);
    } catch (error) {
      logger.error('Error fetching data:', error);
    }
  }, [db]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const addStudent = useCallback(
    async (student: Student) => {
      try {
        await db.runAsync(
          'INSERT INTO students (id, name, grade, scheduledDays, scheduledStartTime, scheduledEndTime, fee) VALUES (?, ?, ?, ?, ?, ?, ?);',
          student.id,
          student.name,
          student.grade,
          JSON.stringify(student.scheduledDays),
          student.scheduledStartTime,
          student.scheduledEndTime,
          student.fee ?? null
        );
        await refreshData();
      } catch (error) {
        logger.error('Error adding student:', error);
        throw error;
      }
    },
    [db, refreshData]
  );

  const checkInStudent = useCallback(
    async (studentId: string, status: 'scheduled' | 'unexpected') => {
      const date = getCurrentDate();

      try {
        // 같은 날 중복 체크인 방지. UI가 버튼을 숨기더라도 연타나
        // 화면 복귀 타이밍에 따라 두 번 눌릴 수 있다.
        const existing = await db.getFirstAsync<{ id: string }>(
          'SELECT id FROM attendance WHERE studentId = ? AND date = ? AND type = ? LIMIT 1;',
          studentId,
          date,
          'checkIn'
        );
        if (existing) return;

        const newAttendance: Attendance = {
          id: createId(),
          studentId,
          date,
          time: getCurrentTime(),
          status,
          type: 'checkIn',
        };

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
        logger.error('Error checking in:', error);
        throw error;
      }
    },
    [db, refreshData]
  );

  // 값 객체를 매 렌더 새로 만들면 모든 소비 화면이 함께 리렌더된다.
  const value = useMemo(
    () => ({ students, todayAttendances, makeups, addStudent, checkInStudent, refreshData }),
    [students, todayAttendances, makeups, addStudent, checkInStudent, refreshData]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

export const useData = () => {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
};
