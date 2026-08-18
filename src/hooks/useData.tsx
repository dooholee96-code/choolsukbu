import React, { createContext, useState, useEffect, useContext, useCallback, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { Attendance, MakeUp, ScheduleException, Student } from '../types';
import { getDB } from '../db';
import { getCurrentDate } from '../utils/date';
import { logger } from '../utils/logger';
import { useSync } from './useSync';
import type { SyncOutcome } from '../sync';
import * as students from '../data/students';
import * as attendance from '../data/attendance';
import * as makeup from '../data/makeup';
import * as exceptions from '../data/exceptions';

/**
 * 화면이 보는 데이터의 유일한 출입구.
 *
 * SQL은 src/data의 도메인 모듈에, 동기화 시점 관리는 useSync에 있다. 여기서는
 * 화면이 들고 있어야 하는 상태를 모으고, 쓰기가 끝날 때마다 다시 읽고 올릴 것을
 * 예약하는 일만 한다.
 */
interface DataContextType {
  students: Student[];
  /** 오늘 날짜의 checkIn 기록만. 전체 이력은 DB에만 있다. */
  todayAttendances: Attendance[];
  makeups: MakeUp[];
  /** 오늘 날짜의 일정 예외만. 다른 날짜는 loadExceptionsRange로 읽는다. */
  todayExceptions: ScheduleException[];

  addStudent: (student: Student) => Promise<void>;
  updateStudent: (student: Student) => Promise<void>;
  /** 원생과 그에 딸린 출결·보충 기록을 함께 삭제한다 */
  deleteStudent: (studentId: string) => Promise<void>;
  /** CSV 가져오기. 이미 있는 이름은 건너뛰고 넣은 수를 돌려준다. */
  importStudents: (students: Student[]) => Promise<{ added: number; skipped: number }>;

  checkInStudent: (studentId: string, status: 'scheduled' | 'unexpected') => Promise<void>;
  /** 결석 기록 + 같은 날짜의 보충 건 생성 */
  markAbsent: (studentId: string) => Promise<void>;
  /** 오늘 정규 수업 기록을 취소한다 (오입력 복구) */
  undoTodayAttendance: (studentId: string) => Promise<void>;
  /** 기록해 둔 등원 시각을 고친다. 뒤늦게 찍었을 때 실제 도착 시각으로 맞춘다. */
  updateAttendanceTime: (attendanceId: string, time: string) => Promise<void>;

  scheduleMakeup: (makeupId: string, makeUpDate: string) => Promise<void>;
  completeMakeup: (makeupId: string) => Promise<void>;
  deleteMakeup: (makeupId: string) => Promise<void>;

  /** 휴강 지정·해제 (그 날짜 전체) */
  setClosure: (date: string, closed: boolean, note?: string) => Promise<void>;
  /** 특정 날짜에 원생 하나를 추가(extra)하거나 빼는(skip) 예외를 만든다 */
  addStudentException: (
    date: string,
    studentId: string,
    kind: 'extra' | 'skip',
    times?: { startTime: string; endTime: string }
  ) => Promise<void>;
  removeException: (exceptionId: string) => Promise<void>;

  /** 상태에 담지 않고 그때그때 읽는 질의들. 담는 순간 오늘로 좁혀 둔 이유가 사라진다. */
  loadAllAttendance: () => Promise<Attendance[]>;
  loadAllMakeups: () => Promise<MakeUp[]>;
  loadAllExceptions: () => Promise<ScheduleException[]>;
  loadAttendanceRange: (fromDate: string, toDate: string) => Promise<Attendance[]>;
  loadExceptionsForDate: (date: string) => Promise<ScheduleException[]>;
  loadExceptionsRange: (fromDate: string, toDate: string) => Promise<ScheduleException[]>;

  refreshData: () => Promise<void>;
  lastSyncAt: string | null;
  syncUnavailable: string | null;
  syncError: string | null;
  syncing: boolean;
  syncNow: () => Promise<SyncOutcome>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const db = getDB();

  const [studentList, setStudentList] = useState<Student[]>([]);
  const [todayAttendances, setTodayAttendances] = useState<Attendance[]>([]);
  const [makeups, setMakeups] = useState<MakeUp[]>([]);
  const [todayExceptions, setTodayExceptions] = useState<ScheduleException[]>([]);

  /** 지금 화면에 올라와 있는 데이터가 어느 날짜의 것인지 */
  const loadedDate = useRef(getCurrentDate());

  const refreshData = useCallback(async () => {
    const today = getCurrentDate();
    loadedDate.current = today;

    try {
      // 화면이 쓰는 범위만 올린다. 출결 테이블 전체를 올리면 체크인 한 번의
      // 비용이 누적 이력에 비례해 늘어난다. 이력 조회는 필요할 때 따로 읽는다.
      const [list, records, pending, rules] = await Promise.all([
        students.listStudents(db),
        attendance.listForDate(db, today),
        makeup.listPending(db),
        exceptions.listForDate(db, today),
      ]);

      setStudentList(list);
      setTodayAttendances(records);
      setMakeups(pending);
      setTodayExceptions(rules);
    } catch (error) {
      logger.error('Error fetching data:', error);
    }
  }, [db]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const sync = useSync(db, refreshData);
  const { schedulePush, syncNow } = sync;

  /** 쓰기 뒤에 부르는 마무리. 화면을 새로 읽고, 잠잠해지면 올린다. */
  const commit = useCallback(async () => {
    await refreshData();
    schedulePush();
  }, [refreshData, schedulePush]);

  /**
   * 쓰기 한 번을 감싼다. 실패는 로그에 남기고 부르는 쪽으로 던진다 —
   * 화면이 '저장 실패'를 띄울 수 있어야 한다.
   */
  const write = useCallback(
    async (label: string, action: () => Promise<unknown>) => {
      try {
        await action();
        await commit();
      } catch (error) {
        logger.error(`${label} failed`, error);
        throw error;
      }
    },
    [commit]
  );

  /**
   * 날짜가 바뀌면 다시 읽고, 앱을 오갈 때 동기화한다.
   *
   * '오늘'은 refreshData가 도는 순간에만 정해지는데 refreshData는 쓰기가 일어날
   * 때만 불린다. 학원 문을 닫고 아이패드를 그대로 두면 다음 날 아침에 어제 명단이
   * 그대로 떠 있고 오늘 와야 하는 학생은 한 명도 보이지 않는다.
   */
  useEffect(() => {
    const refreshIfDateChanged = () => {
      if (getCurrentDate() !== loadedDate.current) refreshData();
    };

    const timer = setInterval(refreshIfDateChanged, 60_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refreshIfDateChanged();
        // 다른 기기에서 찍은 것이 있을 수 있다.
        syncNow().catch(() => {});
      } else if (state === 'background') {
        // 'inactive'는 제외한다. 공유 시트, 제어 센터, 앱 전환기가 전부 그 상태를
        // 거치는데 앱을 떠난 것이 아니다. 여기에 반응하면 CSV 한 번 내보낼 때마다
        // DB 전체를 올린다.
        syncNow().catch(() => {});
      }
    });

    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [refreshData, syncNow]);

  const value = useMemo<DataContextType>(
    () => ({
      students: studentList,
      todayAttendances,
      makeups,
      todayExceptions,

      addStudent: (student) => write('addStudent', () => students.insertStudent(db, student)),
      updateStudent: (student) =>
        write('updateStudent', () => students.updateStudentRow(db, student)),
      deleteStudent: (studentId) =>
        write('deleteStudent', () => students.softDeleteStudent(db, studentId)),
      importStudents: async (incoming) => {
        const result = await students.importStudentRows(db, incoming);
        await commit();
        return result;
      },

      checkInStudent: (studentId, status) =>
        write('checkIn', async () => {
          const date = getCurrentDate();
          // 같은 날 중복 기록 방지. UI가 버튼을 숨기더라도 연타나 화면 복귀
          // 타이밍에 따라 두 번 눌릴 수 있다.
          if (await attendance.findCheckIn(db, studentId, date)) return;
          await attendance.insertCheckIn(db, studentId, date, status);
        }),
      markAbsent: (studentId) =>
        write('markAbsent', async () => {
          const date = getCurrentDate();
          if (await attendance.findCheckIn(db, studentId, date)) return;
          await attendance.insertAbsence(db, studentId, date);
        }),
      undoTodayAttendance: (studentId) =>
        write('undoAttendance', () =>
          attendance.softDeleteCheckIn(db, studentId, getCurrentDate())
        ),
      updateAttendanceTime: (attendanceId, time) =>
        write('updateAttendanceTime', () => attendance.updateTime(db, attendanceId, time)),

      scheduleMakeup: (makeupId, makeUpDate) =>
        write('scheduleMakeup', () => makeup.setMakeupDate(db, makeupId, makeUpDate)),
      completeMakeup: (makeupId) =>
        write('completeMakeup', () =>
          makeup.completeMakeupRow(db, makeupId, getCurrentDate())
        ),
      deleteMakeup: (makeupId) =>
        write('deleteMakeup', () => makeup.softDeleteMakeup(db, makeupId)),

      setClosure: (date, closed, note) =>
        write('setClosure', () => exceptions.setClosureRow(db, date, closed, note)),
      addStudentException: (date, studentId, kind, times) =>
        write('addException', () =>
          exceptions.upsertStudentException(db, date, studentId, kind, times)
        ),
      removeException: (exceptionId) =>
        write('removeException', () => exceptions.softDeleteException(db, exceptionId)),

      loadAllAttendance: () => attendance.listAllAttendance(db),
      loadAllMakeups: () => makeup.listAllMakeupRows(db),
      loadAllExceptions: () => exceptions.listAllExceptionRows(db),
      loadAttendanceRange: (from, to) => attendance.listAttendanceRange(db, from, to),
      loadExceptionsForDate: (date) => exceptions.listForDate(db, date),
      loadExceptionsRange: (from, to) => exceptions.listRange(db, from, to),

      refreshData,
      lastSyncAt: sync.lastSyncAt,
      syncUnavailable: sync.unavailable,
      syncError: sync.error,
      syncing: sync.syncing,
      syncNow: sync.syncNow,
    }),
    [db, studentList, todayAttendances, makeups, todayExceptions, write, commit, refreshData, sync]
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
