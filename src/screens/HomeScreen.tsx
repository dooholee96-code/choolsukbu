import React, { useMemo } from 'react';
import styled from 'styled-components/native';
import { FlatList, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useData } from '../hooks/useData';
import StudentCard from '../components/StudentCard';
import { getCurrentDate, getDayOfWeek, isTimeWithinRange, getCurrentTime } from '../utils/date';
import { Student } from '../types';

const Container = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const Content = styled.View<{ insetTop: number }>`
  flex: 1;
  padding-top: ${({ insetTop }) => insetTop + 16}px;
  padding-horizontal: ${({ theme }) => theme.spacing.medium}px;
  width: ${({ theme }) => theme.layout.contentWidth};
  align-self: center;
`;

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
  font-size: 18px;
  font-weight: bold;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: ${({ theme }) => theme.spacing.small}px;
  margin-top: ${({ theme }) => theme.spacing.medium}px;
`;

const SummaryCard = styled.View`
  background-color: ${({ theme }) => theme.colors.primary};
  padding: ${({ theme }) => theme.spacing.large}px;
  border-radius: ${({ theme }) => theme.borderRadius.large}px;
  margin-bottom: ${({ theme }) => theme.spacing.large}px;
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

const StatsContainer = styled.View`
  flex-direction: row;
  justify-content: space-between;
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

const HomeScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { students, attendances, checkInStudent } = useData();

  const today = getCurrentDate();
  const dayOfWeek = getDayOfWeek(new Date());

  const todayAttendances = useMemo(() => {
    return attendances.filter((a) => a.date === today);
  }, [attendances, today]);

  const scheduledStudents = useMemo(() => {
    return students.filter((s) => s.scheduledDays.includes(dayOfWeek));
  }, [students, dayOfWeek]);

  const checkedInStudents = useMemo(() => {
    return students.filter((s) => todayAttendances.some((a) => a.studentId === s.id));
  }, [students, todayAttendances]);

  const notCheckedInScheduledStudents = useMemo(() => {
    return scheduledStudents.filter((s) => !checkedInStudents.some((cs) => cs.id === s.id));
  }, [scheduledStudents, checkedInStudents]);

  const unexpectedArrivals = useMemo(() => {
    return checkedInStudents.filter(
      (s) => !s.scheduledDays.includes(dayOfWeek) || todayAttendances.find(a => a.studentId === s.id)?.status === 'unexpected'
    );
  }, [checkedInStudents, dayOfWeek, todayAttendances]);

  const handleCheckIn = async (student: Student) => {
    const currentTime = getCurrentTime();
    let status: 'scheduled' | 'unexpected' = 'unexpected';

    if (student.scheduledDays.includes(dayOfWeek)) {
      if (isTimeWithinRange(currentTime, student.scheduledStartTime, student.scheduledEndTime)) {
        status = 'scheduled';
      } else {
        status = 'unexpected'; // 지정 요일이지만 시간 외
      }
    }

    await checkInStudent(student.id, status);
  };

  const totalExpectedRevenue = useMemo(() => {
    return students.reduce((sum, student) => sum + (student.fee || 0), 0);
  }, [students]);

  return (
    <Container>
      <Content insetTop={insets.top}>
        <Header>
          <DateText>{new Date().toLocaleDateString()}</DateText>
          <TitleText>Today's Attendance</TitleText>
        </Header>

        <SummaryCard>
          <SummaryTitle>EXPECTED MONTHLY REVENUE</SummaryTitle>
          <SummaryValue>₩{totalExpectedRevenue.toLocaleString()}</SummaryValue>
          <StatsContainer>
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
              <StatValue>{checkedInStudents.length}</StatValue>
            </StatItem>
          </StatsContainer>
        </SummaryCard>

        <FlatList
          data={[]}
          keyExtractor={() => 'dummy'}
          renderItem={null}
          ListHeaderComponent={
            <>
              <SectionTitle>SCHEDULED TODAY — {notCheckedInScheduledStudents.length}</SectionTitle>
              {notCheckedInScheduledStudents.map((student) => (
                <StudentCard
                  key={student.id}
                  student={student}
                  onCheckIn={() => handleCheckIn(student)}
                />
              ))}

              <SectionTitle>UNEXPECTED ARRIVALS — {unexpectedArrivals.length}</SectionTitle>
              {unexpectedArrivals.map((student) => (
                <StudentCard
                  key={student.id}
                  student={student}
                  attendance={todayAttendances.find((a) => a.studentId === student.id)}
                />
              ))}
              <View style={{ height: 20 }} />
            </>
          }
        />
      </Content>
    </Container>
  );
};

export default HomeScreen;
