import React, {
  createContext,
  useState,
  useEffect,
  useContext,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { AppState } from 'react-native';
import { Student, Attendance, MakeUp, DayOfWeek, ScheduleException, ExceptionKind } from '../types';
import { getDB } from '../db';
import { createId } from '../utils/id';
import { getCurrentDate, getCurrentTime } from '../utils/date';
import { logger } from '../utils/logger';

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
  checkInStudent: (studentId: string, status: 'scheduled' | 'unexpected') => Promise<void>;
  /** 결석 기록 + 같은 날짜의 보충 건 생성 */
  markAbsent: (studentId: string) => Promise<void>;
  /** 오늘 정규 수업 기록을 취소한다 (오입력 복구) */
  undoTodayAttendance: (studentId: string) => Promise<void>;
  /** 기록해 둔 등원 시각을 고친다. 뒤늦게 찍었을 때 실제 도착 시각으로 맞춘다. */
  updateAttendanceTime: (attendanceId: string, time: string) => Promise<void>;
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
  /** 일정 관리 화면이 보고 있는 날짜의 예외를 읽는다 */
  loadExceptionsForDate: (date: string) => Promise<ScheduleException[]>;
  loadExceptionsRange: (fromDate: string, toDate: string) => Promise<ScheduleException[]>;
  scheduleMakeup: (makeupId: string, makeUpDate: string) => Promise<void>;
  completeMakeup: (makeupId: string) => Promise<void>;
  deleteMakeup: (makeupId: string) => Promise<void>;
  /** 내보내기용 전체 이력. 상태에 담지 않고 그때그때 읽는다. */
  loadAllAttendance: () => Promise<Attendance[]>;
  loadAllMakeups: () => Promise<MakeUp[]>;
  loadAllExceptions: () => Promise<ScheduleException[]>;
  /** 이력 조회용 기간 질의. 'YYYY-MM-DD' 경계 포함. */
  loadAttendanceRange: (fromDate: string, toDate: string) => Promise<Attendance[]>;
  /** CSV 가져오기. 이미 있는 이름은 건너뛰고 넣은 수를 돌려준다. */
  importStudents: (students: Student[]) => Promise<{ added: number; skipped: number }>;
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

/** SQLite는 빈 칸을 NULL로 돌려주는데 타입은 optional이라 undefined로 맞춘다. */
type ExceptionRow = {
  id: string;
  date: string;
  kind: string;
  studentId: string | null;
  startTime: string | null;
  endTime: string | null;
  note: string | null;
};

const VALID_KINDS: ExceptionKind[] = ['closure', 'extra', 'skip'];

const mapException = (row: ExceptionRow): ScheduleException => ({
  id: row.id,
  date: row.date,
  kind: (VALID_KINDS.includes(row.kind as ExceptionKind) ? row.kind : 'skip') as ExceptionKind,
  studentId: row.studentId ?? undefined,
  startTime: row.startTime ?? undefined,
  endTime: row.endTime ?? undefined,
  note: row.note ?? undefined,
});

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [students, setStudents] = useState<Student[]>([]);
  const [todayAttendances, setTodayAttendances] = useState<Attendance[]>([]);
  const [makeups, setMakeups] = useState<MakeUp[]>([]);
  const [todayExceptions, setTodayExceptions] = useState<ScheduleException[]>([]);
  const db = getDB();

  /** 지금 화면에 올라와 있는 데이터가 어느 날짜의 것인지 */
  const loadedDate = useRef(getCurrentDate());

  const refreshData = useCallback(async () => {
    const today = getCurrentDate();
    loadedDate.current = today;

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
        today,
        'checkIn'
      );
      setTodayAttendances(todayRecords);

      const pendingMakeups = await db.getAllAsync<MakeUp>(
        'SELECT * FROM makeup WHERE completed = 0;'
      );
      setMakeups(pendingMakeups);

      // 출결과 같은 이유로 오늘 것만 올린다. 홈 화면이 쓰는 범위가 딱 이만큼이다.
      const todayRules = await db.getAllAsync<ExceptionRow>(
        'SELECT * FROM schedule_exception WHERE date = ?;',
        today
      );
      setTodayExceptions(todayRules.map(mapException));
    } catch (error) {
      logger.error('Error fetching data:', error);
    }
  }, [db]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  /**
   * 날짜가 바뀌면 다시 읽는다.
   *
   * '오늘'은 refreshData가 도는 순간에만 정해지는데 refreshData는 쓰기가
   * 일어날 때만 불린다. 학원 문을 닫고 아이패드를 그대로 두면 다음 날 아침에
   * 어제 명단과 어제 등원 기록이 그대로 떠 있고, 오늘 와야 하는 학생은
   * 한 명도 보이지 않는다.
   *
   * 포그라운드로 돌아올 때 한 번 보고, 화면을 계속 켜 둔 경우를 위해
   * 1분마다 날짜 문자열만 비교한다. 바뀌지 않았으면 아무 일도 하지 않는다.
   */
  useEffect(() => {
    const refreshIfDateChanged = () => {
      if (getCurrentDate() !== loadedDate.current) refreshData();
    };

    const timer = setInterval(refreshIfDateChanged, 60_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshIfDateChanged();
    });

    return () => {
      clearInterval(timer);
      subscription.remove();
    };
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
          await db.runAsync('DELETE FROM schedule_exception WHERE studentId = ?;', studentId);
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

  /**
   * 기록된 등원 시각 교정. 3시에 온 학생을 5시에 찍으면 5시로 남는데,
   * 그 값이 그대로 '지각 2시간'이 되어 이력까지 흘러간다.
   */
  const updateAttendanceTime = useCallback(
    async (attendanceId: string, time: string) => {
      try {
        await db.runAsync('UPDATE attendance SET time = ? WHERE id = ?;', time, attendanceId);
        await refreshData();
      } catch (error) {
        logger.error('Error updating attendance time:', error);
        throw error;
      }
    },
    [db, refreshData]
  );

  /**
   * 휴강 지정·해제. 한 날짜에 휴강 행은 하나뿐이어야 하므로 켤 때도 먼저 지운다.
   * (연타나 두 화면에서 동시에 눌렀을 때 중복 행이 남는 것을 막는다.)
   */
  const setClosure = useCallback(
    async (date: string, closed: boolean, note?: string) => {
      try {
        await db.withTransactionAsync(async () => {
          await db.runAsync(
            "DELETE FROM schedule_exception WHERE date = ? AND kind = 'closure';",
            date
          );
          if (closed) {
            await db.runAsync(
              'INSERT INTO schedule_exception (id, date, kind, studentId, startTime, endTime, note) VALUES (?, ?, ?, NULL, NULL, NULL, ?);',
              createId(),
              date,
              'closure',
              note ?? null
            );
          }
        });
        await refreshData();
      } catch (error) {
        logger.error('Error setting closure:', error);
        throw error;
      }
    },
    [db, refreshData]
  );

  /**
   * 한 원생의 그 날짜 예외를 만든다.
   *
   * extra와 skip은 서로 반대라 같은 날 둘 다 있으면 명단 계산이 모순된다.
   * 새로 넣기 전에 그 원생의 그 날짜 예외를 지워 항상 하나만 남게 한다.
   */
  const addStudentException = useCallback(
    async (
      date: string,
      studentId: string,
      kind: 'extra' | 'skip',
      times?: { startTime: string; endTime: string }
    ) => {
      try {
        await db.withTransactionAsync(async () => {
          await db.runAsync(
            "DELETE FROM schedule_exception WHERE date = ? AND studentId = ? AND kind IN ('extra', 'skip');",
            date,
            studentId
          );
          await db.runAsync(
            'INSERT INTO schedule_exception (id, date, kind, studentId, startTime, endTime, note) VALUES (?, ?, ?, ?, ?, ?, NULL);',
            createId(),
            date,
            kind,
            studentId,
            times?.startTime ?? null,
            times?.endTime ?? null
          );
        });
        await refreshData();
      } catch (error) {
        logger.error('Error adding schedule exception:', error);
        throw error;
      }
    },
    [db, refreshData]
  );

  const removeException = useCallback(
    async (exceptionId: string) => {
      try {
        await db.runAsync('DELETE FROM schedule_exception WHERE id = ?;', exceptionId);
        await refreshData();
      } catch (error) {
        logger.error('Error removing schedule exception:', error);
        throw error;
      }
    },
    [db, refreshData]
  );

  const loadExceptionsForDate = useCallback(
    async (date: string) => {
      const rows = await db.getAllAsync<ExceptionRow>(
        'SELECT * FROM schedule_exception WHERE date = ?;',
        date
      );
      return rows.map(mapException);
    },
    [db]
  );

  const loadExceptionsRange = useCallback(
    async (fromDate: string, toDate: string) => {
      const rows = await db.getAllAsync<ExceptionRow>(
        'SELECT * FROM schedule_exception WHERE date >= ? AND date <= ? ORDER BY date;',
        fromDate,
        toDate
      );
      return rows.map(mapException);
    },
    [db]
  );

  const loadAllExceptions = useCallback(async () => {
    const rows = await db.getAllAsync<ExceptionRow>(
      'SELECT * FROM schedule_exception ORDER BY date;'
    );
    return rows.map(mapException);
  }, [db]);

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

  /*
   * 화면은 오늘 기록만 들고 있으므로 내보내기는 DB에서 직접 전체를 읽는다.
   * 결과를 상태에 담지 않는 게 핵심이다. 담는 순간 오늘로 범위를 좁혀 둔
   * 이유가 사라진다.
   */
  const loadAllAttendance = useCallback(
    () => db.getAllAsync<Attendance>('SELECT * FROM attendance ORDER BY date, time;'),
    [db]
  );

  const loadAllMakeups = useCallback(
    () => db.getAllAsync<MakeUp>('SELECT * FROM makeup ORDER BY originalDate;'),
    [db]
  );

  /**
   * 이력 화면이 보고 있는 달만 읽는다. 전체를 올리면 화면이 커질수록
   * 느려지고, 어차피 한 번에 한 달만 보여준다. idx_attendance_date를 탄다.
   */
  const loadAttendanceRange = useCallback(
    (fromDate: string, toDate: string) =>
      db.getAllAsync<Attendance>(
        'SELECT * FROM attendance WHERE date >= ? AND date <= ? ORDER BY date DESC, time DESC;',
        fromDate,
        toDate
      ),
    [db]
  );

  /**
   * 이름이 같은 원생은 건너뛴다. 같은 파일을 두 번 가져와도 명단이
   * 복제되지 않아야 하고, 이 앱에는 학번 같은 외부 식별자가 없어서
   * 이름이 유일한 실용적 기준이다.
   */
  const importStudents = useCallback(
    async (incoming: Student[]) => {
      let added = 0;
      let skipped = 0;

      try {
        await db.withTransactionAsync(async () => {
          for (const student of incoming) {
            const existing = await db.getFirstAsync<{ id: string }>(
              'SELECT id FROM students WHERE name = ? LIMIT 1;',
              student.name
            );
            if (existing) {
              skipped += 1;
              continue;
            }
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
            added += 1;
          }
        });
        await refreshData();
      } catch (error) {
        logger.error('Error importing students:', error);
        throw error;
      }

      return { added, skipped };
    },
    [db, refreshData]
  );

  // 값 객체를 매 렌더 새로 만들면 모든 소비 화면이 함께 리렌더된다.
  const value = useMemo(
    () => ({
      students,
      todayAttendances,
      makeups,
      todayExceptions,
      addStudent,
      updateStudent,
      deleteStudent,
      checkInStudent,
      markAbsent,
      undoTodayAttendance,
      updateAttendanceTime,
      setClosure,
      addStudentException,
      removeException,
      loadExceptionsForDate,
      loadExceptionsRange,
      scheduleMakeup,
      completeMakeup,
      deleteMakeup,
      loadAllAttendance,
      loadAllMakeups,
      loadAllExceptions,
      loadAttendanceRange,
      importStudents,
      refreshData,
    }),
    [
      students,
      todayAttendances,
      makeups,
      todayExceptions,
      addStudent,
      updateStudent,
      deleteStudent,
      checkInStudent,
      markAbsent,
      undoTodayAttendance,
      updateAttendanceTime,
      setClosure,
      addStudentException,
      removeException,
      loadExceptionsForDate,
      loadExceptionsRange,
      scheduleMakeup,
      completeMakeup,
      deleteMakeup,
      loadAllAttendance,
      loadAllMakeups,
      loadAllExceptions,
      loadAttendanceRange,
      importStudents,
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
