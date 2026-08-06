import React, { useCallback, useMemo } from 'react';
import styled from 'styled-components/native';
import { SectionList } from 'react-native';
import { useData } from '../hooks/useData';
import { useResponsive } from '../hooks/useResponsive';
import Screen from '../components/common/Screen';
import GridRow from '../components/common/GridRow';
import StudentCard from '../components/StudentCard';
import { getCurrentDate, getDayOfWeek, isTimeWithinRange, getCurrentTime } from '../utils/date';
import { chunk } from '../utils/array';
import { Student, Attendance } from '../types';

const Header = styled.View`
  margin-bottom: ${({ theme }) => theme.spacing.large}px;
`;

const DateText = styled.Text`
  font-size: 16px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const TitleText = styled.Text`
  font-size: 28px;
  font-weight: bold;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const SectionTitle = styled.Text`
  font-size: 13px;
  font-weight: bold;
  letter-spacing: 0.5px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: ${({ theme }) => theme.spacing.small}px;
  margin-top: ${({ theme }) => theme.spacing.medium}px;
  background-color: ${({ theme }) => theme.colors.background};
  padding-vertical: 4px;
`;

const SummaryCard = styled.View`
  background-color: ${({ theme }) => theme.colors.primary};
  padding: ${({ theme }) => theme.spacing.large}px;
  border-radius: ${({ theme }) => theme.borderRadius.large}px;
  margin-bottom: ${({ theme }) => theme.spacing.small}px;
`;

const SummaryTitle = styled.Text`
  color: rgba(255, 255, 255, 0.8);
  font-size: 14px;
  margin-bottom: 4px;
`;

const SummaryValue = styled.Text`
  color: white;
  font-size: 32px;
  font-weight: bold;
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
  font-size: 12px;
`;

const StatValue = styled.Text`
  color: white;
  font-size: 20px;
  font-weight: bold;
`;

const EmptyText = styled.Text`
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

const HomeScreen: React.FC = () => {
  const { students, attendances, checkInStudent } = useData();
  const { columns, sizeClass } = useResponsive();

  const today = getCurrentDate();
  const dayOfWeek = getDayOfWeek(new Date());

  /** 오늘 등원 기록을 학생별로 하나씩. 같은 날 기록이 여러 개면 가장 늦은 것을 쓴다. */
  const attendanceByStudent = useMemo(() => {
    const map = new Map<string, Attendance>();
    for (const record of attendances) {
      if (record.date !== today || record.type !== 'checkIn') continue;

      const previous = map.get(record.studentId);
      if (!previous || record.time > previous.time) {
        map.set(record.studentId, record);
      }
    }
    return map;
  }, [attendances, today]);

  const scheduledStudents = useMemo(
    () => students.filter((s) => s.scheduledDays.includes(dayOfWeek)),
    [students, dayOfWeek]
  );

  /**
   * 등원 상태별 분류.
   *
   * 이전 구현은 '예정자 - 출석자'와 '예외 등원' 두 목록만 만들어서,
   * 정상(scheduled)으로 체크인한 학생이 어느 목록에도 잡히지 않고 사라졌다.
   * 등원 유형은 체크인 시점에 이미 결정되므로 그 status로 그대로 나눈다.
   */
  const { pending, checkedInOnSchedule, unexpectedArrivals } = useMemo(() => {
    const pendingList = scheduledStudents.filter((s) => !attendanceByStudent.has(s.id));
    const onSchedule: Student[] = [];
    const unexpected: Student[] = [];

    for (const student of students) {
      const record = attendanceByStudent.get(student.id);
      if (!record) continue;
      (record.status === 'scheduled' ? onSchedule : unexpected).push(student);
    }

    return {
      pending: pendingList,
      checkedInOnSchedule: onSchedule,
      unexpectedArrivals: unexpected,
    };
  }, [students, scheduledStudents, attendanceByStudent]);

  const sections = useMemo<Section[]>(() => {
    const all: Section[] = [
      { title: `SCHEDULED TODAY — ${pending.length}`, data: chunk(pending, columns), checkable: true },
      {
        title: `CHECKED IN — ${checkedInOnSchedule.length}`,
        data: chunk(checkedInOnSchedule, columns),
        checkable: false,
      },
      {
        title: `UNEXPECTED ARRIVALS — ${unexpectedArrivals.length}`,
        data: chunk(unexpectedArrivals, columns),
        checkable: false,
      },
    ];
    return all.filter((section) => section.data.length > 0);
  }, [pending, checkedInOnSchedule, unexpectedArrivals, columns]);

  const handleCheckIn = useCallback(
    async (student: Student) => {
      const currentTime = getCurrentTime();
      let status: 'scheduled' | 'unexpected' = 'unexpected';

      if (
        student.scheduledDays.includes(dayOfWeek) &&
        isTimeWithinRange(currentTime, student.scheduledStartTime, student.scheduledEndTime)
      ) {
        status = 'scheduled';
      }

      await checkInStudent(student.id, status);
    },
    [dayOfWeek, checkInStudent]
  );

  const totalExpectedRevenue = useMemo(
    () => students.reduce((sum, student) => sum + (student.fee || 0), 0),
    [students]
  );

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
              <DateText>{new Date().toLocaleDateString()}</DateText>
              <TitleText>Today's Attendance</TitleText>
            </Header>

            <SummaryCard>
              <SummaryTitle>EXPECTED MONTHLY REVENUE</SummaryTitle>
              <SummaryValue>₩{totalExpectedRevenue.toLocaleString()}</SummaryValue>
              <StatsContainer $spread={sizeClass === 'compact'}>
                <StatItem>
                  <StatLabel>Students</StatLabel>
                  <StatValue>{students.length}</StatValue>
                </StatItem>
                <StatItem>
                  <StatLabel>Scheduled</StatLabel>
                  <StatValue>{scheduledStudents.length}</StatValue>
                </StatItem>
                <StatItem>
                  <StatLabel>Checked In</StatLabel>
                  <StatValue>{attendanceByStudent.size}</StatValue>
                </StatItem>
              </StatsContainer>
            </SummaryCard>
          </>
        }
        renderSectionHeader={({ section }) => <SectionTitle>{section.title}</SectionTitle>}
        renderItem={({ item, section }) => (
          <GridRow
            items={item}
            columns={columns}
            keyExtractor={(student) => student.id}
            renderItem={(student) => (
              <StudentCard
                student={student}
                attendance={attendanceByStudent.get(student.id)}
                onCheckIn={section.checkable ? () => handleCheckIn(student) : undefined}
              />
            )}
          />
        )}
        ListEmptyComponent={
          <EmptyText>
            {students.length === 0
              ? '등록된 원생이 없습니다.\n[원생] 탭에서 추가해 주세요.'
              : '오늘 등원 예정인 원생이 없습니다.'}
          </EmptyText>
        }
      />
    </Screen>
  );
};

export default HomeScreen;
