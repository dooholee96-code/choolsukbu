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
import { parseDayTimes, serializeDayTimes } from '../utils/schedule';
import { checkAvailability, getLastSyncAt, runSync, type SyncOutcome } from '../sync';

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
  /** 마지막으로 맞춘 시각. 한 번도 안 했으면 null. */
  lastSyncAt: string | null;
  /** 동기화를 쓸 수 없으면 그 이유. 쓸 수 있으면 null. */
  syncUnavailable: string | null;
  syncing: boolean;
  /** 지금 맞추기. 실패해도 로컬 데이터는 그대로다. */
  syncNow: () => Promise<SyncOutcome>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

/** 동기화 비교의 유일한 근거. 기기 시계 기준 ISO 8601(UTC). */
const stamp = () => new Date().toISOString();

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
  updatedAt: string | null;
  deletedAt: string | null;
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
  updatedAt: row.updatedAt ?? undefined,
  deletedAt: row.deletedAt ?? null,
});

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [students, setStudents] = useState<Student[]>([]);
  const [todayAttendances, setTodayAttendances] = useState<Attendance[]>([]);
  const [makeups, setMakeups] = useState<MakeUp[]>([]);
  const [todayExceptions, setTodayExceptions] = useState<ScheduleException[]>([]);
  const db = getDB();

  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncUnavailable, setSyncUnavailable] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  /** 지금 화면에 올라와 있는 데이터가 어느 날짜의 것인지 */
  const loadedDate = useRef(getCurrentDate());

  /** 기록할 때마다 올리면 낭비라, 잠잠해지면 한 번 올린다. */
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshData = useCallback(async () => {
    const today = getCurrentDate();
    loadedDate.current = today;

    try {
      const allStudents = await db.getAllAsync<
        Omit<Student, 'scheduledDays' | 'dayTimes'> & {
          scheduledDays: string;
          dayTimes: string | null;
        }
      >('SELECT * FROM students WHERE deletedAt IS NULL ORDER BY name;');
      setStudents(
        allStudents.map((row) => ({
          ...row,
          scheduledDays: parseScheduledDays(row.scheduledDays),
          dayTimes: parseDayTimes(row.dayTimes),
        }))
      );

      // 화면이 쓰는 것은 오늘 기록뿐인데 이전에는 출결 테이블 전체를
      // 메모리에 올렸고, refreshData는 쓰기가 일어날 때마다 호출된다.
      // 원생 50명이면 연 1만 행 규모로 누적되므로 체크인 한 번의 비용이
      // 누적 이력에 비례해 늘어난다. 오늘 날짜로 범위를 좁혀 비용을 고정한다.
      // (idx_attendance_date 인덱스를 탄다. 이력 조회 기능은 필요할 때
      //  별도 쿼리로 가져오면 된다 — DB에는 그대로 남아 있다.)
      const todayRecords = await db.getAllAsync<Attendance>(
        'SELECT * FROM attendance WHERE date = ? AND type = ? AND deletedAt IS NULL;',
        today,
        'checkIn'
      );
      setTodayAttendances(todayRecords);

      const pendingMakeups = await db.getAllAsync<MakeUp>(
        'SELECT * FROM makeup WHERE completed = 0 AND deletedAt IS NULL;'
      );
      setMakeups(pendingMakeups);

      // 출결과 같은 이유로 오늘 것만 올린다. 홈 화면이 쓰는 범위가 딱 이만큼이다.
      const todayRules = await db.getAllAsync<ExceptionRow>(
        'SELECT * FROM schedule_exception WHERE date = ? AND deletedAt IS NULL;',
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
   * 한 번 맞추고 화면을 새로 읽는다.
   *
   * 실패해도 조용히 넘기지 않는다 — 언제 맞췄는지 화면에 남기고, 못 쓰는 상태면
   * 그 이유를 띄운다. 어느 쪽이든 로컬 기록은 이미 안전하다.
   */
  const syncNow = useCallback(async (): Promise<SyncOutcome> => {
    setSyncing(true);
    try {
      const outcome = await runSync(db);

      if (outcome.status === 'synced') {
        setSyncUnavailable(null);
        setLastSyncAt(outcome.at);
        if (outcome.applied > 0) await refreshData();
      } else if (outcome.status === 'unavailable') {
        setSyncUnavailable(outcome.reason);
      }

      return outcome;
    } finally {
      setSyncing(false);
    }
  }, [db, refreshData]);

  /** 쓰기가 잠잠해지면 한 번 올린다. 등원을 연달아 찍을 때마다 올리면 낭비다. */
  const schedulePush = useCallback(() => {
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      pushTimer.current = null;
      syncNow().catch(() => {});
    }, 3_000);
  }, [syncNow]);

  /** 쓰기 뒤에 부르는 마무리. 화면을 새로 읽고, 잠잠해지면 올린다. */
  const commit = useCallback(async () => {
    await refreshData();
    schedulePush();
  }, [refreshData, schedulePush]);

  // 앱을 열 때 한 번. 못 쓰는 상태면 이유만 기억해 두고 넘어간다.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = await getLastSyncAt(db).catch(() => null);
      if (!cancelled && stored) setLastSyncAt(stored);

      const availability = await checkAvailability();
      if (cancelled) return;

      if (!availability.ok) {
        // 사유 문구는 runSync가 만든다. 여기서는 한 번 돌려 상태만 받아 둔다.
        await syncNow();
        return;
      }
      await syncNow();
    })();

    return () => {
      cancelled = true;
    };
    // 앱 시작 시 한 번만 돈다. syncNow는 refreshData에 매여 있어 넣으면 매번 재실행된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

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
      if (state === 'active') {
        refreshIfDateChanged();
        // 다른 기기에서 찍은 것이 있을 수 있다.
        syncNow().catch(() => {});
      } else {
        // 내려놓을 때 아직 안 올라간 것을 밀어 둔다.
        if (pushTimer.current) clearTimeout(pushTimer.current);
        syncNow().catch(() => {});
      }
    });

    return () => {
      clearInterval(timer);
      subscription.remove();
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [refreshData, syncNow]);

  const addStudent = useCallback(
    async (student: Student) => {
      try {
        await db.runAsync(
          'INSERT INTO students (id, name, grade, scheduledDays, scheduledStartTime, scheduledEndTime, dayTimes, fee, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);',
          student.id,
          student.name,
          student.grade,
          JSON.stringify(student.scheduledDays),
          student.scheduledStartTime,
          student.scheduledEndTime,
          serializeDayTimes(student),
          student.fee ?? null,
          stamp()
        );
        await commit();
      } catch (error) {
        logger.error('Error adding student:', error);
        throw error;
      }
    },
    [db, commit]
  );

  const updateStudent = useCallback(
    async (student: Student) => {
      try {
        await db.runAsync(
          'UPDATE students SET name = ?, grade = ?, scheduledDays = ?, scheduledStartTime = ?, scheduledEndTime = ?, dayTimes = ?, fee = ?, updatedAt = ? WHERE id = ?;',
          student.name,
          student.grade,
          JSON.stringify(student.scheduledDays),
          student.scheduledStartTime,
          student.scheduledEndTime,
          serializeDayTimes(student),
          student.fee ?? null,
          stamp(),
          student.id
        );
        await commit();
      } catch (error) {
        logger.error('Error updating student:', error);
        throw error;
      }
    },
    [db, commit]
  );

  /**
   * 원생과 그에 딸린 기록을 지운다.
   *
   * 행을 없애지 않고 deletedAt만 찍는다. 그냥 지우면 상대 기기 파일에는 아직
   * 그 원생이 남아 있어 다음 동기화에서 되살아난다. 화면 질의가 모두
   * deletedAt IS NULL로 거르므로 사용자에게는 삭제된 것과 같다.
   *
   * 네 테이블이 한꺼번에 넘어가야 하므로 트랜잭션으로 묶는다.
   */
  const deleteStudent = useCallback(
    async (studentId: string) => {
      try {
        const now = stamp();
        await db.withTransactionAsync(async () => {
          for (const table of ['attendance', 'makeup', 'schedule_exception']) {
            await db.runAsync(
              `UPDATE ${table} SET deletedAt = ?, updatedAt = ? WHERE studentId = ? AND deletedAt IS NULL;`,
              now,
              now,
              studentId
            );
          }
          await db.runAsync(
            'UPDATE students SET deletedAt = ?, updatedAt = ? WHERE id = ?;',
            now,
            now,
            studentId
          );
        });
        await commit();
      } catch (error) {
        logger.error('Error deleting student:', error);
        throw error;
      }
    },
    [db, commit]
  );

  /**
   * 오늘 정규 수업에 대한 기록이 이미 있는지 본다.
   * 출석과 결석은 같은 자리를 두고 다투는 값이므로 type으로만 판정한다.
   */
  const findTodayRecord = useCallback(
    (studentId: string, date: string) =>
      db.getFirstAsync<{ id: string }>(
        'SELECT id FROM attendance WHERE studentId = ? AND date = ? AND type = ? AND deletedAt IS NULL LIMIT 1;',
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
          'INSERT INTO attendance (id, studentId, date, time, status, type, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?);',
          createId(),
          studentId,
          date,
          getCurrentTime(),
          status,
          'checkIn',
          stamp()
        );
        await commit();
      } catch (error) {
        logger.error('Error checking in:', error);
        throw error;
      }
    },
    [db, commit, findTodayRecord]
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

        const now = stamp();
        await db.withTransactionAsync(async () => {
          await db.runAsync(
            'INSERT INTO attendance (id, studentId, date, time, status, type, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?);',
            createId(),
            studentId,
            date,
            getCurrentTime(),
            'absent',
            'checkIn',
            now
          );
          await db.runAsync(
            'INSERT INTO makeup (id, studentId, originalDate, makeUpDate, completed, updatedAt) VALUES (?, ?, ?, ?, 0, ?);',
            createId(),
            studentId,
            date,
            null,
            now
          );
        });
        await commit();
      } catch (error) {
        logger.error('Error marking absent:', error);
        throw error;
      }
    },
    [db, commit, findTodayRecord]
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
        const now = stamp();
        await db.withTransactionAsync(async () => {
          await db.runAsync(
            'UPDATE attendance SET deletedAt = ?, updatedAt = ? WHERE studentId = ? AND date = ? AND type = ? AND deletedAt IS NULL;',
            now,
            now,
            studentId,
            date,
            'checkIn'
          );
          await db.runAsync(
            'UPDATE makeup SET deletedAt = ?, updatedAt = ? WHERE studentId = ? AND originalDate = ? AND completed = 0 AND makeUpDate IS NULL AND deletedAt IS NULL;',
            now,
            now,
            studentId,
            date
          );
        });
        await commit();
      } catch (error) {
        logger.error('Error undoing attendance:', error);
        throw error;
      }
    },
    [db, commit]
  );

  /**
   * 기록된 등원 시각 교정. 3시에 온 학생을 5시에 찍으면 5시로 남는데,
   * 그 값이 그대로 '지각 2시간'이 되어 이력까지 흘러간다.
   */
  const updateAttendanceTime = useCallback(
    async (attendanceId: string, time: string) => {
      try {
        await db.runAsync(
          'UPDATE attendance SET time = ?, updatedAt = ? WHERE id = ?;',
          time,
          stamp(),
          attendanceId
        );
        await commit();
      } catch (error) {
        logger.error('Error updating attendance time:', error);
        throw error;
      }
    },
    [db, commit]
  );

  /**
   * 휴강 지정·해제. 한 날짜에 휴강 행은 하나뿐이어야 하므로 켤 때도 먼저 지운다.
   * (연타나 두 화면에서 동시에 눌렀을 때 중복 행이 남는 것을 막는다.)
   */
  const setClosure = useCallback(
    async (date: string, closed: boolean, note?: string) => {
      try {
        const now = stamp();
        await db.withTransactionAsync(async () => {
          await db.runAsync(
            "UPDATE schedule_exception SET deletedAt = ?, updatedAt = ? WHERE date = ? AND kind = 'closure' AND deletedAt IS NULL;",
            now,
            now,
            date
          );
          if (closed) {
            await db.runAsync(
              'INSERT INTO schedule_exception (id, date, kind, studentId, startTime, endTime, note, updatedAt) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?);',
              createId(),
              date,
              'closure',
              note ?? null,
              now
            );
          }
        });
        await commit();
      } catch (error) {
        logger.error('Error setting closure:', error);
        throw error;
      }
    },
    [db, commit]
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
        const now = stamp();
        await db.withTransactionAsync(async () => {
          await db.runAsync(
            "UPDATE schedule_exception SET deletedAt = ?, updatedAt = ? WHERE date = ? AND studentId = ? AND kind IN ('extra', 'skip') AND deletedAt IS NULL;",
            now,
            now,
            date,
            studentId
          );
          await db.runAsync(
            'INSERT INTO schedule_exception (id, date, kind, studentId, startTime, endTime, note, updatedAt) VALUES (?, ?, ?, ?, ?, ?, NULL, ?);',
            createId(),
            date,
            kind,
            studentId,
            times?.startTime ?? null,
            times?.endTime ?? null,
            now
          );
        });
        await commit();
      } catch (error) {
        logger.error('Error adding schedule exception:', error);
        throw error;
      }
    },
    [db, commit]
  );

  const removeException = useCallback(
    async (exceptionId: string) => {
      try {
        const now = stamp();
        await db.runAsync(
          'UPDATE schedule_exception SET deletedAt = ?, updatedAt = ? WHERE id = ?;',
          now,
          now,
          exceptionId
        );
        await commit();
      } catch (error) {
        logger.error('Error removing schedule exception:', error);
        throw error;
      }
    },
    [db, commit]
  );

  const loadExceptionsForDate = useCallback(
    async (date: string) => {
      const rows = await db.getAllAsync<ExceptionRow>(
        'SELECT * FROM schedule_exception WHERE date = ? AND deletedAt IS NULL;',
        date
      );
      return rows.map(mapException);
    },
    [db]
  );

  const loadExceptionsRange = useCallback(
    async (fromDate: string, toDate: string) => {
      const rows = await db.getAllAsync<ExceptionRow>(
        'SELECT * FROM schedule_exception WHERE date >= ? AND date <= ? AND deletedAt IS NULL ORDER BY date;',
        fromDate,
        toDate
      );
      return rows.map(mapException);
    },
    [db]
  );

  const loadAllExceptions = useCallback(async () => {
    const rows = await db.getAllAsync<ExceptionRow>(
      'SELECT * FROM schedule_exception WHERE deletedAt IS NULL ORDER BY date;'
    );
    return rows.map(mapException);
  }, [db]);

  /** 보충 예정일 지정. 'YYYY-MM-DD'. */
  const scheduleMakeup = useCallback(
    async (makeupId: string, makeUpDate: string) => {
      try {
        await db.runAsync(
          'UPDATE makeup SET makeUpDate = ?, updatedAt = ? WHERE id = ?;',
          makeUpDate,
          stamp(),
          makeupId
        );
        await commit();
      } catch (error) {
        logger.error('Error scheduling makeup:', error);
        throw error;
      }
    },
    [db, commit]
  );

  /**
   * 보충 완료. 완료 표시와 함께 보충 수업 출결을 남겨 실제 수업이
   * 있었다는 사실이 출결 기록에도 드러나게 한다.
   */
  const completeMakeup = useCallback(
    async (makeupId: string) => {
      const date = getCurrentDate();

      try {
        const target = await db.getFirstAsync<MakeUp>('SELECT * FROM makeup WHERE id = ? AND deletedAt IS NULL;', makeupId);
        if (!target || target.completed) return;

        const now = stamp();
        await db.withTransactionAsync(async () => {
          await db.runAsync(
            'UPDATE makeup SET completed = 1, makeUpDate = COALESCE(makeUpDate, ?), updatedAt = ? WHERE id = ?;',
            date,
            now,
            makeupId
          );
          await db.runAsync(
            'INSERT INTO attendance (id, studentId, date, time, status, type, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?);',
            createId(),
            target.studentId,
            date,
            getCurrentTime(),
            'scheduled',
            'makeUp',
            now
          );
        });
        await commit();
      } catch (error) {
        logger.error('Error completing makeup:', error);
        throw error;
      }
    },
    [db, commit]
  );

  const deleteMakeup = useCallback(
    async (makeupId: string) => {
      try {
        const now = stamp();
        await db.runAsync(
          'UPDATE makeup SET deletedAt = ?, updatedAt = ? WHERE id = ?;',
          now,
          now,
          makeupId
        );
        await commit();
      } catch (error) {
        logger.error('Error deleting makeup:', error);
        throw error;
      }
    },
    [db, commit]
  );

  /*
   * 화면은 오늘 기록만 들고 있으므로 내보내기는 DB에서 직접 전체를 읽는다.
   * 결과를 상태에 담지 않는 게 핵심이다. 담는 순간 오늘로 범위를 좁혀 둔
   * 이유가 사라진다.
   */
  const loadAllAttendance = useCallback(
    () => db.getAllAsync<Attendance>(
      'SELECT * FROM attendance WHERE deletedAt IS NULL ORDER BY date, time;'
    ),
    [db]
  );

  const loadAllMakeups = useCallback(
    () => db.getAllAsync<MakeUp>(
      'SELECT * FROM makeup WHERE deletedAt IS NULL ORDER BY originalDate;'
    ),
    [db]
  );

  /**
   * 이력 화면이 보고 있는 달만 읽는다. 전체를 올리면 화면이 커질수록
   * 느려지고, 어차피 한 번에 한 달만 보여준다. idx_attendance_date를 탄다.
   */
  const loadAttendanceRange = useCallback(
    (fromDate: string, toDate: string) =>
      db.getAllAsync<Attendance>(
        'SELECT * FROM attendance WHERE date >= ? AND date <= ? AND deletedAt IS NULL ORDER BY date DESC, time DESC;',
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
              'SELECT id FROM students WHERE name = ? AND deletedAt IS NULL LIMIT 1;',
              student.name
            );
            if (existing) {
              skipped += 1;
              continue;
            }
            await db.runAsync(
              'INSERT INTO students (id, name, grade, scheduledDays, scheduledStartTime, scheduledEndTime, dayTimes, fee, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);',
              student.id,
              student.name,
              student.grade,
              JSON.stringify(student.scheduledDays),
              student.scheduledStartTime,
              student.scheduledEndTime,
              serializeDayTimes(student),
              student.fee ?? null,
              stamp()
            );
            added += 1;
          }
        });
        await commit();
      } catch (error) {
        logger.error('Error importing students:', error);
        throw error;
      }

      return { added, skipped };
    },
    [db, commit]
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
      lastSyncAt,
      syncUnavailable,
      syncing,
      syncNow,
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
      lastSyncAt,
      syncUnavailable,
      syncing,
      syncNow,
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
