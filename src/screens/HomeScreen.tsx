import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled, { useTheme } from 'styled-components/native';
import { Animated, Platform, SectionList, View } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useData } from '../hooks/useData';
import { useAppLockContext } from '../hooks/appLockContext';
import { useResponsive } from '../hooks/useResponsive';
import Screen from '../components/common/Screen';
import GridRow from '../components/common/GridRow';
import StudentCard from '../components/StudentCard';
import BoardLane, { LaneEmpty, LaneGap, LaneGroupTitle } from '../components/BoardLane';
import PressableScale from '../components/common/PressableScale';
import { useBump } from '../hooks/useMotion';
import { haptic, HapticKind } from '../utils/haptics';
import { isTimeWithinRange, getCurrentTime, formatTimeLabel, fromDateKey } from '../utils/date';
import { buildRoster, closureNote, isClosedOn, RosterEntry } from '../utils/roster';
import { duplicateNames } from '../utils/student';
import { chunk } from '../utils/array';
import { confirm, notify } from '../utils/dialog';
import { Student, Attendance } from '../types';

const Header = styled.View`
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: ${({ theme }) => theme.spacing.large}px;
`;

const DateText = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};

  font-size: 16px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const TitleText = styled.Text`
  font-size: 28px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const HeaderAction = styled(PressableScale)`
  flex-direction: row;
  align-items: center;
  gap: 6px;
  padding-vertical: 8px;
  padding-horizontal: 12px;
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  background-color: ${({ theme }) => theme.colors.cardBackground};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
`;

const SyncLine = styled(PressableScale)`
  flex-direction: row;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  align-self: flex-end;
`;

const SyncText = styled.Text<{ $warn: boolean }>`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 12px;
  color: ${({ theme, $warn }) =>
    $warn ? theme.colors.secondaryStrong : theme.colors.textSecondary};
`;

const HeaderActionText = styled.Text`
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 14px;
  color: ${({ theme }) => theme.colors.primaryStrong};
`;

const SectionHeader = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin-bottom: ${({ theme }) => theme.spacing.small}px;
  margin-top: ${({ theme }) => theme.spacing.medium}px;
  background-color: ${({ theme }) => theme.colors.background};
  padding-vertical: 4px;
`;

/* 보드의 칸 색과 같은 점. 좁은 화면의 목록에서도 어느 무리인지 색으로 이어진다. */
const SectionDot = styled.View<{ $color: string }>`
  width: 8px;
  height: 8px;
  border-radius: 4px;
  background-color: ${({ $color }) => $color};
`;

const SectionTitle = styled.Text`
  font-size: 13px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const SummaryCard = styled.View`
  background-color: ${({ theme }) => theme.colors.primaryStrong};
  padding: ${({ theme }) => theme.spacing.large}px;
  border-radius: ${({ theme }) => theme.borderRadius.large}px;
  margin-bottom: ${({ theme }) => theme.spacing.small}px;
`;

const SummaryTitle = styled.Text`
  color: rgba(255, 255, 255, 0.8);
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 14px;
  margin-bottom: 4px;
`;

const SummaryValue = styled.Text`
  color: white;
  font-size: 32px;
  font-family: ${({ theme }) => theme.fonts.bold};
  margin-bottom: ${({ theme }) => theme.spacing.medium}px;
`;

const StatsContainer = styled.View<{ $spread: boolean }>`
  flex-direction: row;
  justify-content: ${({ $spread }) => ($spread ? 'space-between' : 'flex-start')};
  gap: ${({ $spread }) => ($spread ? 0 : 56)}px;
`;

const StatItem = styled.View``;

const StatLabel = styled.Text`
  color: rgba(255, 255, 255, 0.8);
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 12px;
`;

const StatValue = styled.Text`
  color: white;
  font-size: 20px;
  font-family: ${({ theme }) => theme.fonts.bold};`;

/* 보드용 납작한 요약. 큰 숫자 카드가 차지하던 세로 자리를 명단에 돌려준다. */
const SummaryBar = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  background-color: ${({ theme }) => theme.colors.primaryStrong};
  padding-vertical: 12px;
  padding-horizontal: ${({ theme }) => theme.spacing.large}px;
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  margin-bottom: ${({ theme }) => theme.spacing.medium}px;
`;

const SummaryLead = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 12px;
`;

const Board = styled.View`
  flex: 1;
  flex-direction: row;
  gap: ${({ theme }) => theme.spacing.medium}px;
  padding-bottom: ${({ theme }) => theme.spacing.medium}px;
`;

const ClosureCard = styled.View`
  background-color: ${({ theme }) => theme.colors.secondary}20;
  border-radius: ${({ theme }) => theme.borderRadius.large}px;
  padding: ${({ theme }) => theme.spacing.large}px;
  align-items: center;
`;

const ClosureTitle = styled.Text`
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 20px;
  color: ${({ theme }) => theme.colors.secondaryStrong};
  margin-top: ${({ theme }) => theme.spacing.small}px;
`;

const ClosureNote = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: 6px;
  text-align: center;
`;

const EmptyText = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};

  font-size: 15px;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-align: center;
  margin-top: ${({ theme }) => theme.spacing.large}px;
`;

interface Section {
  /**
   * 칸의 정체. 제목은 인원 수가 들어가 바뀌므로 key로 쓸 수 없다. 칸이 생기고
   * 없어질 때(결석이 처음 생기는 순간 등) 뒤쪽 칸들이 통째로 새로 만들어지지 않게 한다.
   */
  key: 'pending' | 'onSchedule' | 'unexpected' | 'absent';
  title: string;
  /** 한 행씩 끊어 담은 학생 목록 */
  data: Student[][];
  checkable: boolean;
}

/** 'HH:mm' 을 피커가 요구하는 Date로. */
const dateFromTime = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  const date = new Date();
  date.setHours(hours || 0, minutes || 0, 0, 0);
  return date;
};

const HomeScreen: React.FC = () => {
  const {
    students,
    todayAttendances,
    todayExceptions,
    checkInStudent,
    markAbsent,
    undoTodayAttendance,
    updateAttendanceTime,
    setLeaveTime,
    lastSyncAt,
    syncUnavailable,
    syncError,
    syncing,
    syncNow,
    loaded,
    today,
  } = useData();
  const { columns, sizeClass } = useResponsive();
  const theme = useTheme();
  const navigation = useNavigation();
  const lock = useAppLockContext();

  /** 시각 피커가 고치고 있는 대상. 등원과 하원 둘 다 같은 피커를 쓴다. */
  const [timeTarget, setTimeTarget] = useState<{
    attendance: Attendance;
    edge: 'in' | 'out';
  } | null>(null);

  /**
   * 방금 손댄 카드. 그 카드만 한 번 튄다.
   *
   * 잠시 뒤 비운다. 남겨 두면 다른 학생을 찍어 목록이 다시 짜일 때 이 카드가 새로
   * 그려지면서 또 튄다 — 아무것도 안 했는데 움직이는 카드는 눈을 끈다.
   */
  const [pulse, setPulse] = useState<{ id: string; n: number } | null>(null);
  const pulseCount = useRef(0);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bumpCard = useCallback((studentId: string) => {
    pulseCount.current += 1;
    setPulse({ id: studentId, n: pulseCount.current });
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    pulseTimer.current = setTimeout(() => setPulse(null), 700);
  }, []);

  useEffect(
    () => () => {
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
    },
    []
  );

  /**
   * 기록 한 번. 끝나면 카드를 튀기고 햅틱을 내고, 실패하면 알린다.
   *
   * 예전에는 실패가 어디에도 닿지 않았다. 카드의 onPress가 돌려준 약속을 아무도
   * 받지 않아서, 저장이 안 돼도 화면은 조용했다 — 누른 사람은 된 줄 안다.
   * 햅틱을 결과 뒤에 내는 것도 같은 이유다. 누르자마자 '성공'을 떨면 실패한 날도
   * 성공이라고 말하게 된다.
   */
  const act = useCallback(
    async (studentId: string, task: () => Promise<unknown>, done: HapticKind, failure: string) => {
      try {
        await task();
        haptic(done);
        bumpCard(studentId);
      } catch {
        haptic('error');
        notify('저장 실패', `${failure}\n다시 시도해 주세요.`);
      }
    },
    [bumpCard]
  );

  const closed = isClosedOn(todayExceptions);
  const note = closureNote(todayExceptions);

  /**
   * 등원 기록을 학생별로 하나씩. 같은 날 기록이 여러 개면 가장 늦은 것을 쓴다.
   * 날짜와 type 필터는 쿼리에서 이미 걸렀다.
   */
  const attendanceByStudent = useMemo(() => {
    const map = new Map<string, Attendance>();
    for (const record of todayAttendances) {
      const previous = map.get(record.studentId);
      if (!previous || record.time > previous.time) {
        map.set(record.studentId, record);
      }
    }
    return map;
  }, [todayAttendances]);

  /**
   * 정규 시간표에 오늘의 예외(휴강·특강·빠짐)를 얹은 최종 명단.
   * 이전에는 scheduledDays만 봐서, 요일을 옮겨 온 학생이 홈 화면에
   * 아예 나타나지 않아 등원을 찍을 방법이 없었다.
   */
  const roster = useMemo(
    // 요일은 목록이 읽힌 날짜로 정한다. new Date()로 정하면 자정 직후 목록은 새 날짜인데
    // 명단만 어제 요일로 짜이거나, 반대로 목록은 그대로인데 요일만 넘어간다.
    () => buildRoster(students, todayExceptions, fromDateKey(today)),
    // today가 꼭 있어야 한다. 목록은 바뀌지 않으면 예전 배열 그대로라(utils/reconcile),
    // 원생도 예외도 그대로인 채 날짜만 넘어가면 이것 없이는 어제 요일의 명단이 남는다.
    [students, todayExceptions, today]
  );

  /** 이름이 겹치는 원생이 있으면 카드가 그 사실을 알린다. */
  const twins = useMemo(() => duplicateNames(students), [students]);

  const rosterById = useMemo(() => {
    const map = new Map<string, RosterEntry>();
    for (const entry of roster) map.set(entry.student.id, entry);
    return map;
  }, [roster]);

  /**
   * 등원 상태별 분류.
   *
   * 이전 구현은 '예정자 - 출석자'와 '예외 등원' 두 목록만 만들어서,
   * 정상(scheduled)으로 체크인한 학생이 어느 목록에도 잡히지 않고 사라졌다.
   * 등원 유형은 체크인 시점에 이미 결정되므로 그 status로 그대로 나눈다.
   */
  const { pending, checkedInOnSchedule, unexpectedArrivals, absentStudents } = useMemo(() => {
    const pendingList = roster
      .filter((entry) => !attendanceByStudent.has(entry.student.id))
      .map((entry) => entry.student);
    const onSchedule: Student[] = [];
    const unexpected: Student[] = [];
    const absent: Student[] = [];

    for (const student of students) {
      const record = attendanceByStudent.get(student.id);
      if (!record) continue;

      if (record.status === 'absent') absent.push(student);
      else if (record.status === 'scheduled') onSchedule.push(student);
      else unexpected.push(student);
    }

    return {
      pending: pendingList,
      checkedInOnSchedule: onSchedule,
      unexpectedArrivals: unexpected,
      absentStudents: absent,
    };
  }, [students, roster, attendanceByStudent]);

  /**
   * 보드용: 등원한 학생을 아직 있는 쪽과 하원한 쪽으로 가른다.
   *
   * 있는 쪽은 먼저 온 순서다. 대개 먼저 온 아이가 먼저 가므로 하원을 누를 카드가
   * 칸 위쪽에 모인다. 하원한 쪽은 방금 간 아이가 위 — 잘못 눌렀으면 바로 보인다.
   */
  const { inClass, leftToday } = useMemo(() => {
    const present = [...checkedInOnSchedule, ...unexpectedArrivals];
    const recordOf = (student: Student) => attendanceByStudent.get(student.id);
    const staying = present
      .filter((student) => !recordOf(student)?.leaveTime)
      .sort((a, b) => (recordOf(a)?.time ?? '').localeCompare(recordOf(b)?.time ?? ''));
    const left = present
      .filter((student) => Boolean(recordOf(student)?.leaveTime))
      .sort((a, b) =>
        (recordOf(b)?.leaveTime ?? '').localeCompare(recordOf(a)?.leaveTime ?? '')
      );
    return { inClass: staying, leftToday: left };
  }, [checkedInOnSchedule, unexpectedArrivals, attendanceByStudent]);

  /** 결석은 등원이 아니므로 출석 수에서 뺀다. */
  const checkedInCount = checkedInOnSchedule.length + unexpectedArrivals.length;

  /**
   * 숫자가 바뀌면 살짝 부푼다. 카드가 옮겨 간 것과 숫자가 오른 것이 한 번에 읽힌다.
   * 첫 읽기 전의 0은 '0명'이 아니라 모르는 값이다. 그대로 넘기면 앱을 열 때마다
   * 0에서 실제 수로 바뀌며 튄다.
   */
  const countScale = useBump(loaded ? checkedInCount : undefined);

  const sections = useMemo<Section[]>(() => {
    if (closed) return [];

    const all: Section[] = [
      {
        key: 'pending',
        title: `등원 예정 — ${pending.length}`,
        data: chunk(pending, columns),
        checkable: true,
      },
      {
        key: 'onSchedule',
        title: `등원 완료 — ${checkedInOnSchedule.length}`,
        data: chunk(checkedInOnSchedule, columns),
        checkable: false,
      },
      {
        key: 'unexpected',
        title: `예외 등원 — ${unexpectedArrivals.length}`,
        data: chunk(unexpectedArrivals, columns),
        checkable: false,
      },
      {
        key: 'absent',
        title: `결석 — ${absentStudents.length}`,
        data: chunk(absentStudents, columns),
        checkable: false,
      },
    ];
    return all.filter((section) => section.data.length > 0);
  }, [closed, pending, checkedInOnSchedule, unexpectedArrivals, absentStudents, columns]);

  const handleCheckIn = useCallback(
    async (student: Student) => {
      const currentTime = getCurrentTime();
      const entry = rosterById.get(student.id);

      // 오늘 명단에 있고 그 시간대 안이면 정상 등원이다. 특강으로 들어온
      // 학생도 명단에 있으므로 '예외'로 밀리지 않는다.
      const status =
        entry && isTimeWithinRange(currentTime, entry.startTime, entry.endTime)
          ? 'scheduled'
          : 'unexpected';

      await act(
        student.id,
        () => checkInStudent(student.id, status),
        'success',
        `${student.name} 학생의 등원을 기록하지 못했습니다.`
      );
    },
    [rosterById, checkInStudent, act]
  );

  const handleMarkAbsent = useCallback(
    (student: Student) => {
      confirm({
        title: '결석 처리',
        message: `${student.name} 학생을 결석 처리할까요?\n보충 건이 함께 생성됩니다.`,
        confirmLabel: '결석',
        destructive: true,
        onConfirm: () =>
          act(
            student.id,
            () => markAbsent(student.id),
            'warning',
            `${student.name} 학생의 결석을 기록하지 못했습니다.`
          ),
      });
    },
    [markAbsent, act]
  );

  /**
   * 오늘 기록 취소. 한 번 더 묻는다.
   *
   * 되돌린 뒤 다시 등원을 누르면 **그때 시각**으로 새로 남는다. 4시에 온 학생을 6시에
   * 실수로 취소하면 도착 시각과 하원 시각을 함께 잃는다. 바로 위에 하원 버튼이 붙으면서
   * 잘못 누를 일도 늘었다.
   */
  const handleUndo = useCallback(
    (student: Student, record?: Attendance) => {
      // 보충 건은 날짜를 잡기 전일 때만 같이 지운다 (softDeleteCheckIn). 잡았거나 끝낸
      // 건까지 지운다고 말하면, 남아 있는 보충을 사라진 줄 알고 손대지 않게 된다.
      const what =
        record?.status === 'absent'
          ? '결석 기록과, 아직 날짜를 잡지 않은 보충 건을 지웁니다.\n날짜를 잡았거나 끝낸 보충 건은 남습니다.'
          : record
            ? `${formatTimeLabel(record.time)} 등원 기록${record.leaveTime ? '과 하원 시각' : ''}을 지웁니다.\n다시 등원을 누르면 그때 시각으로 새로 남습니다.`
            : '';

      confirm({
        title: '기록 취소',
        message: `${student.name} 학생의 오늘 기록을 취소할까요?\n${what}`,
        confirmLabel: '취소하기',
        destructive: true,
        onConfirm: () =>
          act(
            student.id,
            () => undoTodayAttendance(student.id),
            'tap',
            `${student.name} 학생의 기록을 취소하지 못했습니다.`
          ),
      });
    },
    [undoTodayAttendance, act]
  );

  const handleEditTime = useCallback(
    (_student: Student, attendance: Attendance) => setTimeTarget({ attendance, edge: 'in' }),
    []
  );

  const handleEditLeaveTime = useCallback(
    (_student: Student, attendance: Attendance) => setTimeTarget({ attendance, edge: 'out' }),
    []
  );

  /** 지금 시각으로 하원. 대부분은 아이가 나가는 순간에 누르므로 물어볼 것이 없다. */
  const handleCheckOut = useCallback(
    (student: Student, attendance: Attendance) =>
      act(
        student.id,
        () => setLeaveTime(attendance.id, getCurrentTime()),
        'success',
        `${student.name} 학생의 하원을 기록하지 못했습니다.`
      ),
    [setLeaveTime, act]
  );

  const handleTimeChange = useCallback(
    (event: DateTimePickerEvent, selected?: Date) => {
      if (Platform.OS !== 'ios') setTimeTarget(null);
      if (event.type === 'dismissed' || !selected || !timeTarget) return;

      const time = format(selected, 'HH:mm');
      const { attendance, edge } = timeTarget;
      act(
        attendance.studentId,
        () =>
          edge === 'in'
            ? updateAttendanceTime(attendance.id, time)
            : setLeaveTime(attendance.id, time),
        'select',
        edge === 'in' ? '등원 시각을 고치지 못했습니다.' : '하원 시각을 고치지 못했습니다.'
      );

      if (Platform.OS === 'ios') setTimeTarget(null);
    },
    [timeTarget, updateAttendanceTime, setLeaveTime, act]
  );

  const openSchedule = useCallback(() => navigation.navigate('ScheduleModal'), [navigation]);

  const handleSync = useCallback(() => {
    syncNow().catch(() => {});
  }, [syncNow]);

  /**
   * 조용히 실패하지 않게 한다. 언제 맞췄는지, 못 맞추고 있다면 왜인지 늘 보인다.
   * 동기화를 아예 쓸 수 없는 빌드(무료 계정)에서는 줄 자체를 띄우지 않는다.
   */
  const syncLabel = syncing
    ? '맞추는 중…'
    : syncError
      ? '못 맞춤 — 눌러서 다시'
      : lastSyncAt
        ? `${new Date(lastSyncAt).toLocaleTimeString('ko-KR', {
            hour: 'numeric',
            minute: '2-digit',
          })}에 맞춤`
        : '아직 안 맞춤';

  /**
   * 카드 한 장. 목록과 보드가 같은 카드를 쓰고, 보드에서는 납작한 모양만 고른다.
   * checkable은 아직 등원 전인 칸 — 등원·결석 버튼이 붙고, 기록 쪽 동작은 없다.
   */
  const renderCard = useCallback(
    (student: Student, checkable: boolean, dense: boolean) => {
      const entry = rosterById.get(student.id);
      return (
        <StudentCard
          key={student.id}
          dense={dense}
          student={student}
          attendance={attendanceByStudent.get(student.id)}
          startTime={entry?.startTime}
          endTime={entry?.endTime}
          isExtra={entry?.isExtra}
          onCheckIn={checkable ? handleCheckIn : undefined}
          onMarkAbsent={checkable ? handleMarkAbsent : undefined}
          onUndo={checkable ? undefined : handleUndo}
          onEditTime={checkable ? undefined : handleEditTime}
          onCheckOut={checkable ? undefined : handleCheckOut}
          onEditLeaveTime={checkable ? undefined : handleEditLeaveTime}
          hasNameTwin={twins.has(student.name.trim())}
          pulse={pulse?.id === student.id ? pulse.n : undefined}
        />
      );
    },
    [
      rosterById,
      attendanceByStudent,
      handleCheckIn,
      handleMarkAbsent,
      handleUndo,
      handleEditTime,
      handleCheckOut,
      handleEditLeaveTime,
      twins,
      pulse,
    ]
  );

  /**
   * 아이패드처럼 넓은 창에서는 칸을 옆으로 늘어놓는다 — 누가 올 차례고, 누가 와 있고,
   * 누가 갔는지를 스크롤 없이 한 화면에서. 좁은 창(아이폰, Split View로 좁힌 창)은
   * 예전처럼 한 줄 목록이다. 회전이나 창 크기가 바뀌면 그 자리에서 갈아탄다.
   */
  const board = sizeClass !== 'compact';

  /** 목록 머리의 점 색. 카드의 상태 표시(출석·예외·결석)와 같은 색이다. */
  const sectionColor: Record<Section['key'], string> = {
    pending: theme.colors.primary,
    onSchedule: theme.colors.success,
    unexpected: theme.colors.secondary,
    absent: theme.colors.danger,
  };
  /** 가장 넓은 창만 하원·결석에 칸을 따로 준다. 그보다 좁으면 등원 칸 아래에 붙인다. */
  const threeLanes = sizeClass === 'expanded';

  const emptyNotice =
    students.length === 0
      ? '등록된 원생이 없습니다.\n[원생] 탭에서 추가해 주세요.'
      : '오늘 등원 예정인 원생이 없습니다.\n[일정]에서 추가할 수 있습니다.';

  const header = (
    <Header style={board ? { marginBottom: 16 } : undefined}>
      <View>
        <DateText>{fromDateKey(today).toLocaleDateString('ko-KR')}</DateText>
        <TitleText>오늘의 출석</TitleText>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {/* 수업용으로 아이패드를 건네주기 직전에 누른다. 앱을 켠 채로
              넘기는 경우는 자동 잠금으로 잡을 수 없다. */}
          {lock.enabled && (
            <HeaderAction
              onPress={lock.lock}
              pressScale={0.9}
              haptic="tap"
              accessibilityRole="button"
              accessibilityLabel="지금 잠그기"
            >
              <Ionicons name="lock-closed-outline" size={16} />
            </HeaderAction>
          )}
          <HeaderAction
            onPress={openSchedule}
            pressScale={0.93}
            accessibilityRole="button"
            accessibilityLabel="일정 관리"
          >
            <Ionicons name="calendar-outline" size={16} />
            <HeaderActionText>일정</HeaderActionText>
          </HeaderAction>
        </View>
        {syncUnavailable === null && (
          <SyncLine
            onPress={handleSync}
            disabled={syncing}
            pressScale={0.95}
            pressOpacity={0.6}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            accessibilityRole="button"
            accessibilityLabel="지금 동기화"
          >
            <Ionicons
              name={syncing ? 'sync' : syncError ? 'cloud-offline-outline' : 'cloud-done-outline'}
              size={12}
            />
            <SyncText $warn={Boolean(syncError) || !lastSyncAt}>{syncLabel}</SyncText>
          </SyncLine>
        )}
      </View>
    </Header>
  );

  const closure = (
    <ClosureCard>
      <Ionicons name="cafe-outline" size={32} />
      <ClosureTitle>오늘은 휴강입니다</ClosureTitle>
      {Boolean(note) && <ClosureNote>{note}</ClosureNote>}
      <ClosureNote>[일정]에서 해제할 수 있습니다.</ClosureNote>
    </ClosureCard>
  );

  /* 숫자가 튈 때 폭을 글자에 맞춰야 글자 한가운데를 중심으로 부푼다. */
  const count = (
    <Animated.View style={{ alignSelf: 'flex-start', transform: [{ scale: countScale }] }}>
      <SummaryValue style={board ? { marginBottom: 0, fontSize: 26 } : undefined}>
        {checkedInCount} / {roster.length}
      </SummaryValue>
    </Animated.View>
  );

  const timePicker = timeTarget && (
    <DateTimePicker
      value={dateFromTime(
        (timeTarget.edge === 'in' ? timeTarget.attendance.time : timeTarget.attendance.leaveTime) ??
          getCurrentTime()
      )}
      mode="time"
      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
      onChange={handleTimeChange}
      accessibilityLabel={timeTarget.edge === 'in' ? '등원 시각' : '하원 시각'}
    />
  );

  if (board) {
    const finishedLane = (
      <>
        {leftToday.length > 0 && (
          <LaneGap>{leftToday.map((student) => renderCard(student, false, true))}</LaneGap>
        )}
        {absentStudents.length > 0 && (
          <>
            <LaneGroupTitle $color={theme.colors.dangerStrong}>
              결석 — {absentStudents.length}
            </LaneGroupTitle>
            <LaneGap>{absentStudents.map((student) => renderCard(student, false, true))}</LaneGap>
          </>
        )}
      </>
    );

    return (
      <Screen>
        {header}
        {closed ? (
          closure
        ) : (
          <>
            {/* 금액은 홈에서 다루지 않는다. 수강료는 원생 탭의 토글과
                이후 월계표 화면에서만 노출한다. */}
            <SummaryBar>
              <SummaryLead>
                <SummaryTitle style={{ marginBottom: 0 }}>오늘 등원</SummaryTitle>
                {count}
              </SummaryLead>
              <StatsContainer $spread={false} style={{ gap: 36 }}>
                <StatItem>
                  <StatLabel>수업 중</StatLabel>
                  <StatValue>{inClass.length}</StatValue>
                </StatItem>
                <StatItem>
                  <StatLabel>하원</StatLabel>
                  <StatValue>{leftToday.length}</StatValue>
                </StatItem>
                <StatItem>
                  <StatLabel>결석</StatLabel>
                  <StatValue>{absentStudents.length}</StatValue>
                </StatItem>
                <StatItem>
                  <StatLabel>남음</StatLabel>
                  <StatValue>{pending.length}</StatValue>
                </StatItem>
              </StatsContainer>
            </SummaryBar>

            <Board>
              <BoardLane title="등원 예정" count={pending.length} tone="pending">
                {pending.length > 0 ? (
                  <LaneGap>{pending.map((student) => renderCard(student, true, true))}</LaneGap>
                ) : (
                  <LaneEmpty>{roster.length === 0 ? emptyNotice : '모두 왔습니다.'}</LaneEmpty>
                )}
              </BoardLane>

              <BoardLane title="수업 중" count={inClass.length} tone="present">
                {inClass.length > 0 ? (
                  <LaneGap>{inClass.map((student) => renderCard(student, false, true))}</LaneGap>
                ) : (
                  <LaneEmpty>
                    {checkedInCount > 0 ? '모두 하원했습니다.' : '등원하면 여기로 옵니다.'}
                  </LaneEmpty>
                )}
                {!threeLanes && (leftToday.length > 0 || absentStudents.length > 0) && (
                  <>
                    {leftToday.length > 0 && (
                      <LaneGroupTitle $color={theme.colors.lavenderStrong}>
                        하원 — {leftToday.length}
                      </LaneGroupTitle>
                    )}
                    {finishedLane}
                  </>
                )}
              </BoardLane>

              {threeLanes && (
                <BoardLane
                  title="하원 · 결석"
                  count={leftToday.length + absentStudents.length}
                  tone="done"
                >
                  {leftToday.length + absentStudents.length > 0 ? (
                    finishedLane
                  ) : (
                    <LaneEmpty>하원을 누르거나 결석으로 두면 여기로 옵니다.</LaneEmpty>
                  )}
                </BoardLane>
              )}
            </Board>
          </>
        )}
        {timePicker}
      </Screen>
    );
  }

  return (
    <Screen>
      <SectionList<Student[], Section>
        sections={sections}
        // 행은 자리로 부른다. 첫 학생 id로 부르면 한 명이 빠질 때마다 뒤 행들의 첫 학생이
        // 바뀌어 행이 통째로 새로 만들어지고, 그 안의 카드도 전부 처음부터 다시 그려진다.
        // 행 안의 카드는 GridRow가 학생 id로 부르므로 같은 행에 남은 카드는 그대로 간다.
        keyExtractor={(_row, index) => String(index)}
        // 목록 데이터가 그대로여도 튈 카드가 바뀌면 다시 그려야 한다. 없으면
        // 하원·시각 수정처럼 칸을 옮기지 않는 기록에서 카드가 튀지 않는다.
        extraData={pulse}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListHeaderComponent={
          <>
            {header}
            {closed ? (
              closure
            ) : (
              /* 금액은 홈에서 다루지 않는다. 수강료는 원생 탭의 토글과
                 이후 월계표 화면에서만 노출한다. */
              <SummaryCard>
                <SummaryTitle>오늘 등원</SummaryTitle>
                {count}
                <StatsContainer $spread>
                  <StatItem>
                    <StatLabel>예정</StatLabel>
                    <StatValue>{roster.length}</StatValue>
                  </StatItem>
                  <StatItem>
                    <StatLabel>등원</StatLabel>
                    <StatValue>{checkedInCount}</StatValue>
                  </StatItem>
                  <StatItem>
                    <StatLabel>남음</StatLabel>
                    <StatValue>{pending.length}</StatValue>
                  </StatItem>
                </StatsContainer>
              </SummaryCard>
            )}
          </>
        }
        renderSectionHeader={({ section }) => (
          <SectionHeader>
            <SectionDot $color={sectionColor[section.key]} />
            <SectionTitle>{section.title}</SectionTitle>
          </SectionHeader>
        )}
        renderItem={({ item, section }) => (
          <GridRow
            items={item}
            columns={columns}
            keyExtractor={(student) => student.id}
            renderItem={(student) => renderCard(student, section.checkable, false)}
          />
        )}
        ListEmptyComponent={closed ? null : <EmptyText>{emptyNotice}</EmptyText>}
      />
      {timePicker}
    </Screen>
  );
};

export default HomeScreen;
