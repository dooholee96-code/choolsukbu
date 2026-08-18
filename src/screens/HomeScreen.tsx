import React, { useCallback, useMemo, useState } from 'react';
import styled from 'styled-components/native';
import { Platform, SectionList, View } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useData } from '../hooks/useData';
import { useResponsive } from '../hooks/useResponsive';
import Screen from '../components/common/Screen';
import GridRow from '../components/common/GridRow';
import StudentCard from '../components/StudentCard';
import { isTimeWithinRange, getCurrentTime } from '../utils/date';
import { buildRoster, closureNote, isClosedOn, RosterEntry } from '../utils/roster';
import { chunk } from '../utils/array';
import { confirm } from '../utils/dialog';
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

const HeaderAction = styled.TouchableOpacity`
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

const HeaderActionText = styled.Text`
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 14px;
  color: ${({ theme }) => theme.colors.primaryStrong};
`;

const SectionTitle = styled.Text`
  font-size: 13px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: ${({ theme }) => theme.spacing.small}px;
  margin-top: ${({ theme }) => theme.spacing.medium}px;
  background-color: ${({ theme }) => theme.colors.background};
  padding-vertical: 4px;
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
  } = useData();
  const { columns, sizeClass } = useResponsive();
  const navigation = useNavigation();

  const [timeTarget, setTimeTarget] = useState<Attendance | null>(null);

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
    () => buildRoster(students, todayExceptions, new Date()),
    [students, todayExceptions]
  );

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

  /** 결석은 등원이 아니므로 출석 수에서 뺀다. */
  const checkedInCount = checkedInOnSchedule.length + unexpectedArrivals.length;

  const sections = useMemo<Section[]>(() => {
    if (closed) return [];

    const all: Section[] = [
      { title: `등원 예정 — ${pending.length}`, data: chunk(pending, columns), checkable: true },
      {
        title: `등원 완료 — ${checkedInOnSchedule.length}`,
        data: chunk(checkedInOnSchedule, columns),
        checkable: false,
      },
      {
        title: `예외 등원 — ${unexpectedArrivals.length}`,
        data: chunk(unexpectedArrivals, columns),
        checkable: false,
      },
      {
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

      await checkInStudent(student.id, status);
    },
    [rosterById, checkInStudent]
  );

  const handleMarkAbsent = useCallback(
    (student: Student) => {
      confirm({
        title: '결석 처리',
        message: `${student.name} 학생을 결석 처리할까요?\n보충 건이 함께 생성됩니다.`,
        confirmLabel: '결석',
        destructive: true,
        onConfirm: () => markAbsent(student.id),
      });
    },
    [markAbsent]
  );

  const handleUndo = useCallback(
    (student: Student) => undoTodayAttendance(student.id),
    [undoTodayAttendance]
  );

  const handleEditTime = useCallback(
    (_student: Student, attendance: Attendance) => setTimeTarget(attendance),
    []
  );

  const handleTimeChange = useCallback(
    (event: DateTimePickerEvent, selected?: Date) => {
      if (Platform.OS !== 'ios') setTimeTarget(null);
      if (event.type === 'dismissed' || !selected || !timeTarget) return;

      updateAttendanceTime(timeTarget.id, format(selected, 'HH:mm'));
      if (Platform.OS === 'ios') setTimeTarget(null);
    },
    [timeTarget, updateAttendanceTime]
  );

  const openSchedule = useCallback(() => navigation.navigate('ScheduleModal'), [navigation]);

  return (
    <Screen>
      <SectionList<Student[], Section>
        sections={sections}
        keyExtractor={(row, index) => row[0]?.id ?? `row-${index}`}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListHeaderComponent={
          <>
            <Header>
              <View>
                <DateText>{new Date().toLocaleDateString('ko-KR')}</DateText>
                <TitleText>오늘의 출석</TitleText>
              </View>
              <HeaderAction
                onPress={openSchedule}
                accessibilityRole="button"
                accessibilityLabel="일정 관리"
              >
                <Ionicons name="calendar-outline" size={16} />
                <HeaderActionText>일정</HeaderActionText>
              </HeaderAction>
            </Header>

            {closed ? (
              <ClosureCard>
                <Ionicons name="cafe-outline" size={32} />
                <ClosureTitle>오늘은 휴강입니다</ClosureTitle>
                {Boolean(note) && <ClosureNote>{note}</ClosureNote>}
                <ClosureNote>[일정]에서 해제할 수 있습니다.</ClosureNote>
              </ClosureCard>
            ) : (
              /* 금액은 홈에서 다루지 않는다. 수강료는 원생 탭의 토글과
                 이후 월계표 화면에서만 노출한다. */
              <SummaryCard>
                <SummaryTitle>오늘 등원</SummaryTitle>
                <SummaryValue>
                  {checkedInCount} / {roster.length}
                </SummaryValue>
                <StatsContainer $spread={sizeClass === 'compact'}>
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
        renderSectionHeader={({ section }) => <SectionTitle>{section.title}</SectionTitle>}
        renderItem={({ item, section }) => (
          <GridRow
            items={item}
            columns={columns}
            keyExtractor={(student) => student.id}
            renderItem={(student) => {
              const entry = rosterById.get(student.id);
              return (
                <StudentCard
                  student={student}
                  attendance={attendanceByStudent.get(student.id)}
                  startTime={entry?.startTime}
                  endTime={entry?.endTime}
                  isExtra={entry?.isExtra}
                  onCheckIn={section.checkable ? handleCheckIn : undefined}
                  onMarkAbsent={section.checkable ? handleMarkAbsent : undefined}
                  onUndo={section.checkable ? undefined : handleUndo}
                  onEditTime={section.checkable ? undefined : handleEditTime}
                />
              );
            }}
          />
        )}
        ListEmptyComponent={
          closed ? null : (
            <EmptyText>
              {students.length === 0
                ? '등록된 원생이 없습니다.\n[원생] 탭에서 추가해 주세요.'
                : '오늘 등원 예정인 원생이 없습니다.\n[일정]에서 추가할 수 있습니다.'}
            </EmptyText>
          )
        }
      />

      {timeTarget && (
        <DateTimePicker
          value={dateFromTime(timeTarget.time)}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={handleTimeChange}
        />
      )}
    </Screen>
  );
};

export default HomeScreen;
