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
  updateStudent: (student: Student) => Promise<void>;
  /** 원생과 그에 딸린 출결·보충 기록을 함께 삭제한다 */
  deleteStudent: (studentId: string) => Promise<void>;
  checkInStudent: (studentId: string, status: 'scheduled' | 'unexpected') => Promise<void>;
  /** 결석 기록 + 같은 날짜의 보충 건 생성 */
  markAbsent: (studentId: string) => Promise<void>;
  /** 오늘 정규 수업 기록을 취소한다 (오입력 복구) */
  undoTodayAttendance: (studentId: string) => Promise<void>;
  scheduleMakeup: (makeupId: string, makeUpDate: string) => Promise<void>;
  completeMakeup: (makeupId: string) => Promise<void>;
  deleteMakeup: (makeupId: string) => Promise<void>;
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

  const updateStudent = useCallback(
    async (student: Student) => {
      try {
        await db.runAsync(
          'UPDATE students SET name = ?, grade = ?, scheduledDays = ?, scheduledStartTime = ?, scheduledEndTime = ?, fee = ? WHERE id = ?;',
          student.name,
          student.grade,
          JSON.stringify(student.scheduledDays),
          student.scheduledStartTime,
          student.scheduledEndTime,
          student.fee ?? null,
          student.id
        );
        await refreshData();
      } catch (error) {
        logger.error('Error updating student:', error);
        throw error;
      }
    },
    [db, refreshData]
  );

  /**
   * 원생과 그에 딸린 기록을 지운다.
   *
   * attendance와 makeup이 students를 참조하는데 ON DELETE CASCADE가 없고
   * initDB에서 PRAGMA foreign_keys를 켜두었으므로, 자식 행을 먼저 지우지 않으면
   * 기록이 하나라도 있는 원생은 제약 위반으로 삭제 자체가 실패한다.
   * 셋 중 일부만 지워진 상태를 막기 위해 한 트랜잭션으로 묶는다.
   */
  const deleteStudent = useCallback(
    async (studentId: string) => {
      try {
        await db.withTransactionAsync(async () => {
          await db.runAsync('DELETE FROM attendance WHERE studentId = ?;', studentId);
          await db.runAsync('DELETE FROM makeup WHERE studentId = ?;', studentId);
          await db.runAsync('DELETE FROM students WHERE id = ?;', studentId);
        });
        await refreshData();
      } catch (error) {
        logger.error('Error deleting student:', error);
        throw error;
      }
    },
    [db, refreshData]
  );

  /**
   * 오늘 정규 수업에 대한 기록이 이미 있는지 본다.
   * 출석과 결석은 같은 자리를 두고 다투는 값이므로 type으로만 판정한다.
   */
  const findTodayRecord = useCallback(
    (studentId: string, date: string) =>
      db.getFirstAsync<{ id: string }>(
        'SELECT id FROM attendance WHERE studentId = ? AND date = ? AND type = ? LIMIT 1;',
        studentId,
        date,
        'checkIn'
      ),
    [db]
  );

  const checkInStudent = useCallback(
    async (studentId: string, status: 'scheduled' | 'unexpected') => {
      const date = getCurrentDate();

      try {
        // 같은 날 중복 기록 방지. UI가 버튼을 숨기더라도 연타나
        // 화면 복귀 타이밍에 따라 두 번 눌릴 수 있다.
        if (await findTodayRecord(studentId, date)) return;

        await db.runAsync(
          'INSERT INTO attendance (id, studentId, date, time, status, type) VALUES (?, ?, ?, ?, ?, ?);',
          createId(),
          studentId,
          date,
          getCurrentTime(),
          status,
          'checkIn'
        );
        await refreshData();
      } catch (error) {
        logger.error('Error checking in:', error);
        throw error;
      }
    },
    [db, refreshData, findTodayRecord]
  );

  /**
   * 결석 처리. 출결에 absent를 남기고 같은 날짜로 보충 건을 연다.
   * 보충은 결석에서만 생기므로 두 기록은 항상 함께 만들어져야 한다.
   * 하나만 남는 상태를 막기 위해 트랜잭션으로 묶는다.
   */
  const markAbsent = useCallback(
    async (studentId: string) => {
      const date = getCurrentDate();

      try {
        if (await findTodayRecord(studentId, date)) return;

        await db.withTransactionAsync(async () => {
          await db.runAsync(
            'INSERT INTO attendance (id, studentId, date, time, status, type) VALUES (?, ?, ?, ?, ?, ?);',
            createId(),
            studentId,
            date,
            getCurrentTime(),
            'absent',
            'checkIn'
          );
          await db.runAsync(
            'INSERT INTO makeup (id, studentId, originalDate, makeUpDate, completed) VALUES (?, ?, ?, ?, 0);',
            createId(),
            studentId,
            date,
            null
          );
        });
        await refreshData();
      } catch (error) {
        logger.error('Error marking absent:', error);
        throw error;
      }
    },
    [db, refreshData, findTodayRecord]
  );

  /**
   * 오늘 기록 취소. 잘못 누른 것을 되돌리는 경로가 없으면
   * 출결 화면에서 실수 하나가 그대로 남는다.
   * 결석을 취소하면 그때 열린 보충 건도 같이 지운다. 다만 이미 보충일을
   * 잡았거나 완료한 건은 별개의 판단이 들어간 기록이므로 건드리지 않는다.
   */
  const undoTodayAttendance = useCallback(
    async (studentId: string) => {
      const date = getCurrentDate();

      try {
        await db.withTransactionAsync(async () => {
          await db.runAsync(
            'DELETE FROM attendance WHERE studentId = ? AND date = ? AND type = ?;',
            studentId,
            date,
            'checkIn'
          );
          await db.runAsync(
            'DELETE FROM makeup WHERE studentId = ? AND originalDate = ? AND completed = 0 AND makeUpDate IS NULL;',
            studentId,
            date
          );
        });
        await refreshData();
      } catch (error) {
        logger.error('Error undoing attendance:', error);
        throw error;
      }
    },
    [db, refreshData]
  );

  /** 보충 예정일 지정. 'YYYY-MM-DD'. */
  const scheduleMakeup = useCallback(
    async (makeupId: string, makeUpDate: string) => {
      try {
        await db.runAsync('UPDATE makeup SET makeUpDate = ? WHERE id = ?;', makeUpDate, makeupId);
        await refreshData();
      } catch (error) {
        logger.error('Error scheduling makeup:', error);
        throw error;
      }
    },
    [db, refreshData]
  );

  /**
   * 보충 완료. 완료 표시와 함께 보충 수업 출결을 남겨 실제 수업이
   * 있었다는 사실이 출결 기록에도 드러나게 한다.
   */
  const completeMakeup = useCallback(
    async (makeupId: string) => {
      const date = getCurrentDate();

      try {
        const target = await db.getFirstAsync<MakeUp>('SELECT * FROM makeup WHERE id = ?;', makeupId);
        if (!target || target.completed) return;

        await db.withTransactionAsync(async () => {
          await db.runAsync(
            'UPDATE makeup SET completed = 1, makeUpDate = COALESCE(makeUpDate, ?) WHERE id = ?;',
            date,
            makeupId
          );
          await db.runAsync(
            'INSERT INTO attendance (id, studentId, date, time, status, type) VALUES (?, ?, ?, ?, ?, ?);',
            createId(),
            target.studentId,
            date,
            getCurrentTime(),
            'scheduled',
            'makeUp'
          );
        });
        await refreshData();
      } catch (error) {
        logger.error('Error completing makeup:', error);
        throw error;
      }
    },
    [db, refreshData]
  );

  const deleteMakeup = useCallback(
    async (makeupId: string) => {
      try {
        await db.runAsync('DELETE FROM makeup WHERE id = ?;', makeupId);
        await refreshData();
      } catch (error) {
        logger.error('Error deleting makeup:', error);
        throw error;
      }
    },
    [db, refreshData]
  );

  // 값 객체를 매 렌더 새로 만들면 모든 소비 화면이 함께 리렌더된다.
  const value = useMemo(
    () => ({
      students,
      todayAttendances,
      makeups,
      addStudent,
      updateStudent,
      deleteStudent,
      checkInStudent,
      markAbsent,
      undoTodayAttendance,
      scheduleMakeup,
      completeMakeup,
      deleteMakeup,
      refreshData,
    }),
    [
      students,
      todayAttendances,
      makeups,
      addStudent,
      updateStudent,
      deleteStudent,
      checkInStudent,
      markAbsent,
      undoTodayAttendance,
      scheduleMakeup,
      completeMakeup,
      deleteMakeup,
      refreshData,
    ]
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
