import React, { createContext, useState, useEffect, useContext, useCallback, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import {
  AcademyInfo,
  Attendance,
  FeeRule,
  MakeUp,
  Payment,
  PaymentMethod,
  ScheduleException,
  Student,
} from '../types';
import { getDB } from '../db';
import { exclusive } from '../db/queue';
import { getCurrentDate } from '../utils/date';
import { logger } from '../utils/logger';
import { reconcile } from '../utils/reconcile';
import { useSync } from './useSync';
import type { SyncOutcome } from '../sync';
import { buildBackup, readBackup, restoreBackup, summarize, type BackupSummary } from '../sync/backup';
import * as students from '../data/students';
import * as attendance from '../data/attendance';
import * as makeup from '../data/makeup';
import * as exceptions from '../data/exceptions';
import * as payments from '../data/payments';
import * as academy from '../data/academy';

/**
 * 화면이 보는 데이터의 유일한 출입구.
 *
 * SQL은 src/data의 도메인 모듈에, 동기화 시점 관리는 useSync에 있다. 여기서는
 * 화면이 들고 있어야 하는 상태를 모으고, 쓰기가 끝날 때마다 다시 읽고 올릴 것을
 * 예약하는 일만 한다.
 *
 * 두 가지를 지킨다. 그래야 등원 한 번에 원생 카드 전부가 다시 그려지지 않는다.
 *   - 함수는 앱이 떠 있는 동안 늘 같은 것이다. 데이터가 바뀔 때마다 새로 만들면
 *     그 함수를 받는 카드가 전부 '바뀐 것'이 된다.
 *   - 다시 읽어도 바뀌지 않은 행은 예전 객체 그대로다 (utils/reconcile).
 *
 * 그 대신 '데이터가 바뀌었다'를 함수의 정체로 알아채던 화면은 이제 revision을 본다.
 */
interface DataContextType {
  students: Student[];
  /** 오늘 날짜의 checkIn 기록만. 전체 이력은 DB에만 있다. */
  todayAttendances: Attendance[];
  makeups: MakeUp[];
  /** 오늘 날짜의 일정 예외만. 다른 날짜는 loadExceptionsRange로 읽는다. */
  todayExceptions: ScheduleException[];
  /** 첫 읽기가 끝났는가. 그 전의 빈 목록은 '0건'이 아니라 '아직 모름'이다. */
  loaded: boolean;
  /**
   * 위의 목록이 어느 날짜의 것인가 ('YYYY-MM-DD'). 화면이 '오늘'을 직접 계산하지
   * 않고 이것을 쓴다. 자정이 지나 목록은 새 날짜로 바뀌었는데 화면만 어제 요일로
   * 명단을 짜는 일이 없어야 한다.
   */
  today: string;
  /**
   * DB를 다시 읽을 때마다 오른다. 쓰기, 다른 기기에서 온 변경, 날짜 바뀜 모두.
   * 이력처럼 위의 상태에 담지 않고 그때그때 읽는 화면이 '다시 읽을 때'를 안다.
   */
  revision: number;

  addStudent: (student: Student) => Promise<void>;
  updateStudent: (student: Student) => Promise<void>;
  /** 원생과 그에 딸린 출결·보충 기록을 함께 삭제한다 */
  deleteStudent: (studentId: string) => Promise<void>;
  /**
   * 퇴원 처리. 그 날부터 명단에서 빠지지만 출결 이력은 남는다.
   * date에 null을 주면 복학이다.
   */
  setStudentWithdrawn: (studentId: string, date: string | null) => Promise<void>;
  /** CSV 가져오기. 이미 있는 이름은 건너뛰고 넣은 수를 돌려준다. */
  importStudents: (students: Student[]) => Promise<{ added: number; skipped: number }>;

  checkInStudent: (studentId: string, status: 'scheduled' | 'unexpected') => Promise<void>;
  /** 결석 기록 + 같은 날짜의 보충 건 생성 */
  markAbsent: (studentId: string) => Promise<void>;
  /** 오늘 정규 수업 기록을 취소한다 (오입력 복구) */
  undoTodayAttendance: (studentId: string) => Promise<void>;
  /** 기록해 둔 등원 시각을 고친다. 뒤늦게 찍었을 때 실제 도착 시각으로 맞춘다. */
  updateAttendanceTime: (attendanceId: string, time: string) => Promise<void>;
  /** 하원 시각을 남긴다. null이면 지운다 (잘못 찍었을 때). */
  setLeaveTime: (attendanceId: string, time: string | null) => Promise<void>;

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

  /** 받은 수강료 한 건. 원생의 미취학 표시는 부르는 쪽이 받는 순간의 값으로 채운다. */
  recordPayment: (payment: Payment) => Promise<void>;
  updatePayment: (payment: Payment) => Promise<void>;
  deletePayment: (paymentId: string) => Promise<void>;

  /** 학원 정보·운영 설정. 적은 적이 없으면 null. 증명서의 학원 칸, 수강료 기준표가 여기 있다. */
  loadAcademy: () => Promise<AcademyInfo | null>;
  /** 일부만 고친다. 다른 칸은 지금 저장된 값 그대로다. */
  patchAcademy: (patch: Partial<Omit<AcademyInfo, 'updatedAt'>>) => Promise<void>;
  /** 수강료가 비어 있는 재원생에게 기준표대로 채운다. 채운 수. */
  fillMissingFees: (rules: FeeRule[]) => Promise<number>;

  /** 상태에 담지 않고 그때그때 읽는 질의들. 담는 순간 오늘로 좁혀 둔 이유가 사라진다. */
  loadAllAttendance: () => Promise<Attendance[]>;
  loadAllMakeups: () => Promise<MakeUp[]>;
  loadAllExceptions: () => Promise<ScheduleException[]>;
  loadAttendanceRange: (fromDate: string, toDate: string) => Promise<Attendance[]>;
  loadExceptionsForDate: (date: string) => Promise<ScheduleException[]>;
  loadExceptionsRange: (fromDate: string, toDate: string) => Promise<ScheduleException[]>;
  /** 그 달 수강료로 받은 것 ('YYYY-MM'). */
  loadPaymentsForMonth: (month: string) => Promise<Payment[]>;
  /** 받은 날이 그 기간 안인 것. 신고 자료가 쓴다. */
  loadPaymentsPaidBetween: (fromDate: string, toDate: string) => Promise<Payment[]>;
  /** 그 원생이 마지막으로 낸 결제수단. 없으면 null. 수납 기록의 기본값이 된다. */
  loadLastPaymentMethod: (studentId: string) => Promise<PaymentMethod | null>;
  /** 지운 원생까지. 수납 장부가 지운 원생의 이름을 붙일 때 쓴다. */
  loadStudentsIncludingDeleted: () => Promise<Student[]>;

  /** 기기 전체를 파일 하나로. CSV와 달리 되돌릴 수 있다. */
  exportBackup: () => Promise<string>;
  /** 백업 파일을 읽어 되돌린다. 덮어쓰기가 아니라 병합이라 최신 기록은 살아남는다. */
  restoreBackup: (text: string) => Promise<{ summary: BackupSummary; applied: number } | null>;

  refreshData: () => Promise<void>;
  lastSyncAt: string | null;
  syncUnavailable: string | null;
  syncError: string | null;
  syncing: boolean;
  syncNow: () => Promise<SyncOutcome>;
}

/** 상태가 아닌 것 — 화면이 부르는 함수들. 앱이 떠 있는 동안 바뀌지 않는다. */
type DataActions = Omit<
  DataContextType,
  | 'students'
  | 'todayAttendances'
  | 'makeups'
  | 'todayExceptions'
  | 'loaded'
  | 'today'
  | 'revision'
  | 'lastSyncAt'
  | 'syncUnavailable'
  | 'syncError'
  | 'syncing'
>;

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const db = getDB();

  const [studentList, setStudentList] = useState<Student[]>([]);
  const [todayAttendances, setTodayAttendances] = useState<Attendance[]>([]);
  const [makeups, setMakeups] = useState<MakeUp[]>([]);
  const [todayExceptions, setTodayExceptions] = useState<ScheduleException[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [today, setToday] = useState(getCurrentDate);
  const [revision, setRevision] = useState(0);

  /** 지금 화면에 올라와 있는 데이터가 어느 날짜의 것인지 */
  const loadedDate = useRef(getCurrentDate());

  const refreshData = useCallback(async () => {
    const date = getCurrentDate();
    loadedDate.current = date;

    try {
      // 화면이 쓰는 범위만 올린다. 출결 테이블 전체를 올리면 체크인 한 번의
      // 비용이 누적 이력에 비례해 늘어난다. 이력 조회는 필요할 때 따로 읽는다.
      const [list, records, pending, rules] = await Promise.all([
        students.listStudents(db),
        attendance.listForDate(db, date),
        makeup.listPending(db),
        exceptions.listForDate(db, date),
      ]);

      // 바뀌지 않은 목록은 예전 배열 그대로라 React가 갱신을 건너뛴다.
      setStudentList((previous) => reconcile(previous, list));
      setTodayAttendances((previous) => reconcile(previous, records));
      setMakeups((previous) => reconcile(previous, pending));
      setTodayExceptions((previous) => reconcile(previous, rules));
      setToday(date);
      setLoaded(true);
      setRevision((n) => n + 1);
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
   *
   * 쓰기 자체는 줄을 선다 (db/queue). 다시 읽기는 줄 밖에서 한다.
   */
  const write = useCallback(
    async (label: string, action: () => Promise<unknown>) => {
      try {
        await exclusive(action);
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

  /**
   * 화면이 부르는 함수들. db·write·commit·refreshData·syncNow가 모두 한 번 만들어지면
   * 바뀌지 않으므로 이 묶음도 앱이 떠 있는 동안 그대로다.
   */
  const actions = useMemo<DataActions>(
    () => ({
      addStudent: (student) => write('addStudent', () => students.insertStudent(db, student)),
      updateStudent: (student) =>
        write('updateStudent', () => students.updateStudentRow(db, student)),
      deleteStudent: (studentId) =>
        write('deleteStudent', () => students.softDeleteStudent(db, studentId)),
      setStudentWithdrawn: (studentId, date) =>
        write('setWithdrawn', () => students.setWithdrawn(db, studentId, date)),
      importStudents: async (incoming) => {
        const result = await exclusive(() => students.importStudentRows(db, incoming));
        await commit();
        return result;
      },

      // 같은 날 두 번 남지 않게 하는 것은 SQL 쪽이 한 문장으로 맡는다 (연타 대비).
      checkInStudent: (studentId, status) =>
        write('checkIn', () =>
          attendance.insertCheckIn(db, studentId, getCurrentDate(), status)
        ),
      markAbsent: (studentId) =>
        write('markAbsent', () => attendance.insertAbsence(db, studentId, getCurrentDate())),
      undoTodayAttendance: (studentId) =>
        write('undoAttendance', () =>
          attendance.softDeleteCheckIn(db, studentId, getCurrentDate())
        ),
      updateAttendanceTime: (attendanceId, time) =>
        write('updateAttendanceTime', () => attendance.updateTime(db, attendanceId, time)),
      setLeaveTime: (attendanceId, time) =>
        write('setLeaveTime', () => attendance.setLeaveTime(db, attendanceId, time)),

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

      recordPayment: (payment) => write('recordPayment', () => payments.insertPayment(db, payment)),
      updatePayment: (payment) =>
        write('updatePayment', () => payments.updatePaymentRow(db, payment)),
      deletePayment: (paymentId) =>
        write('deletePayment', () => payments.softDeletePayment(db, paymentId)),

      loadAcademy: () => academy.getAcademy(db),
      patchAcademy: (patch) => write('patchAcademy', () => academy.patchAcademy(db, patch)),
      fillMissingFees: async (rules) => {
        const filled = await exclusive(() => students.fillMissingFees(db, rules));
        await commit();
        return filled;
      },

      exportBackup: () => buildBackup(db),
      restoreBackup: async (text) => {
        const snapshot = readBackup(text);
        if (!snapshot) return null;

        const applied = await exclusive(() => restoreBackup(db, snapshot));
        await commit();
        return { summary: summarize(snapshot), applied };
      },

      loadAllAttendance: () => attendance.listAllAttendance(db),
      loadAllMakeups: () => makeup.listAllMakeupRows(db),
      loadAllExceptions: () => exceptions.listAllExceptionRows(db),
      loadAttendanceRange: (from, to) => attendance.listAttendanceRange(db, from, to),
      loadExceptionsForDate: (date) => exceptions.listForDate(db, date),
      loadExceptionsRange: (from, to) => exceptions.listRange(db, from, to),
      loadPaymentsForMonth: (month) => payments.listForMonth(db, month),
      loadPaymentsPaidBetween: (from, to) => payments.listPaidBetween(db, from, to),
      loadStudentsIncludingDeleted: () => students.listStudentsIncludingDeleted(db),
      loadLastPaymentMethod: (studentId) => payments.lastMethodFor(db, studentId),

      refreshData,
      syncNow,
    }),
    [db, write, commit, refreshData, syncNow]
  );

  // sync 객체 자체는 넣지 않는다. useSync가 렌더마다 새 객체를 돌려주므로, 넣으면
  // App이 다시 그려질 때마다(잠금·해제) 값이 새로 만들어져 모든 화면이 다시 그려진다.
  const { lastSyncAt, unavailable: syncUnavailable, error: syncError, syncing } = sync;

  const value = useMemo<DataContextType>(
    () => ({
      students: studentList,
      todayAttendances,
      makeups,
      todayExceptions,
      loaded,
      today,
      revision,
      ...actions,
      lastSyncAt,
      syncUnavailable,
      syncError,
      syncing,
    }),
    [
      studentList,
      todayAttendances,
      makeups,
      todayExceptions,
      loaded,
      today,
      revision,
      actions,
      lastSyncAt,
      syncUnavailable,
      syncError,
      syncing,
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
