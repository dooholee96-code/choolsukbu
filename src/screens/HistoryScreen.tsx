import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styled, { useTheme } from 'styled-components/native';
import { ActivityIndicator, SectionList, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../hooks/useData';
import Screen from '../components/common/Screen';
import { Attendance, ScheduleException, Student } from '../types';
import { formatDateLabel, formatTimeLabel } from '../utils/date';
import { isWithdrawn, studentSubtitle } from '../utils/student';
import { logger } from '../utils/logger';

const Header = styled.View`
  margin-bottom: ${({ theme }) => theme.spacing.medium}px;
`;

const TitleText = styled.Text`
  font-size: 28px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const MonthBar = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  background-color: ${({ theme }) => theme.colors.cardBackground};
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  padding-vertical: 8px;
  padding-horizontal: 8px;
  margin-top: ${({ theme }) => theme.spacing.medium}px;
`;

const MonthButton = styled.TouchableOpacity`
  padding: 8px;
`;

const MonthLabel = styled.Text`
  font-size: 17px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Tallies = styled.View`
  flex-direction: row;
  gap: 8px;
  margin-top: ${({ theme }) => theme.spacing.medium}px;
`;

const Tally = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.cardBackground};
  border-radius: ${({ theme }) => theme.borderRadius.small}px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  padding-vertical: 10px;
  align-items: center;
`;

const TallyValue = styled.Text<{ $tone: string }>`
  font-size: 20px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ $tone }) => $tone};
`;

const TallyLabel = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: 2px;
`;

const Segmented = styled.View`
  flex-direction: row;
  background-color: ${({ theme }) => theme.colors.cardBackground};
  border-radius: ${({ theme }) => theme.borderRadius.small}px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  margin-top: ${({ theme }) => theme.spacing.medium}px;
  overflow: hidden;
`;

const SegmentButton = styled.TouchableOpacity<{ $active: boolean }>`
  flex: 1;
  padding-vertical: 10px;
  align-items: center;
  background-color: ${({ theme, $active }) =>
    $active ? theme.colors.primaryStrong : 'transparent'};
`;

const SegmentLabel = styled.Text<{ $active: boolean }>`
  font-size: 14px;
  font-family: ${({ theme, $active }) => ($active ? theme.fonts.bold : theme.fonts.regular)};
  color: ${({ theme, $active }) => ($active ? 'white' : theme.colors.textSecondary)};
`;

const SectionTitle = styled.Text`
  font-size: 13px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme }) => theme.colors.textSecondary};
  background-color: ${({ theme }) => theme.colors.background};
  padding-vertical: 6px;
  margin-top: ${({ theme }) => theme.spacing.small}px;
`;

const Row = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  background-color: ${({ theme }) => theme.colors.cardBackground};
  border-radius: ${({ theme }) => theme.borderRadius.small}px;
  padding-vertical: 12px;
  padding-horizontal: ${({ theme }) => theme.spacing.medium}px;
  margin-bottom: 6px;
`;

const RowName = styled.Text`
  font-size: 15px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme }) => theme.colors.textPrimary};
  flex: 1;
`;

const RowMeta = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-left: 8px;
`;

const Badge = styled.Text<{ $tone: string }>`
  font-size: 13px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ $tone }) => $tone};
  margin-left: 10px;
  min-width: 34px;
  text-align: right;
`;

const EmptyText = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 15px;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-align: center;
  margin-top: ${({ theme }) => theme.spacing.large}px;
`;

type Mode = 'student' | 'date';

/** 날짜별 보기의 한 줄. 출결 기록이거나, 그 날이 휴강이었다는 표시다. */
type DateRow =
  | { kind: 'record'; id: string; record: Attendance; student: Student }
  | { kind: 'closure'; id: string; note: string };

interface StudentTally {
  student: Student;
  scheduled: number;
  unexpected: number;
  absent: number;
  makeUp: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const monthBounds = (year: number, month: number) => ({
  from: `${year}-${pad(month + 1)}-01`,
  to: `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`,
});

const HistoryScreen: React.FC = () => {
  const { students, loadAttendanceRange, loadExceptionsRange } = useData();
  const theme = useTheme();

  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [records, setRecords] = useState<Attendance[]>([]);
  const [exceptions, setExceptions] = useState<ScheduleException[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>('student');

  const { from, to } = useMemo(() => monthBounds(cursor.year, cursor.month), [cursor]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [monthRecords, monthExceptions] = await Promise.all([
        loadAttendanceRange(from, to),
        loadExceptionsRange(from, to),
      ]);
      setRecords(monthRecords);
      setExceptions(monthExceptions);
    } catch (error) {
      logger.error('Failed to load attendance range', error);
      setRecords([]);
      setExceptions([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, loadAttendanceRange, loadExceptionsRange]);

  // 다른 탭에서 체크인하고 돌아오면 최신 상태여야 한다.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    load();
  }, [load]);

  const shiftMonth = (delta: number) =>
    setCursor(({ year, month }) => {
      const next = new Date(year, month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });

  const isCurrentMonth =
    cursor.year === today.getFullYear() && cursor.month === today.getMonth();

  const totals = useMemo(() => {
    const t = { scheduled: 0, unexpected: 0, absent: 0, makeUp: 0 };
    for (const r of records) {
      if (r.type === 'makeUp') t.makeUp += 1;
      else if (r.status === 'absent') t.absent += 1;
      else if (r.status === 'scheduled') t.scheduled += 1;
      else t.unexpected += 1;
    }
    return t;
  }, [records]);

  const studentSections = useMemo(() => {
    const byId = new Map(students.map((s) => [s.id, s]));
    const tallies = new Map<string, StudentTally>();

    for (const r of records) {
      const student = byId.get(r.studentId);
      if (!student) continue; // 삭제된 원생

      const t =
        tallies.get(r.studentId) ??
        { student, scheduled: 0, unexpected: 0, absent: 0, makeUp: 0 };
      if (r.type === 'makeUp') t.makeUp += 1;
      else if (r.status === 'absent') t.absent += 1;
      else if (r.status === 'scheduled') t.scheduled += 1;
      else t.unexpected += 1;
      tallies.set(r.studentId, t);
    }

    const rows = [...tallies.values()].sort((a, b) =>
      a.student.name.localeCompare(b.student.name, 'ko')
    );
    return rows.length ? [{ title: `원생 ${rows.length}명`, data: rows }] : [];
  }, [records, students]);

  /**
   * 날짜별 묶음. 휴강일은 출결 기록이 하나도 없어서 그냥 두면 목록에서 사라지고,
   * 나중에 보면 '전원 결석'과 구분이 안 된다. 기록이 없어도 줄을 하나 만든다.
   */
  const dateSections = useMemo(() => {
    const byId = new Map(students.map((s) => [s.id, s]));
    const byDate = new Map<string, DateRow[]>();

    for (const r of records) {
      const student = byId.get(r.studentId);
      if (!student) continue;
      const list = byDate.get(r.date) ?? [];
      list.push({ kind: 'record', id: r.id, record: r, student });
      byDate.set(r.date, list);
    }

    for (const rule of exceptions) {
      if (rule.kind !== 'closure') continue;
      const list = byDate.get(rule.date) ?? [];
      list.unshift({ kind: 'closure', id: rule.id, note: rule.note ?? '' });
      byDate.set(rule.date, list);
    }

    return [...byDate.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, data]) => ({ title: formatDateLabel(date), data }));
  }, [records, exceptions, students]);

  const toneFor = (record: Attendance) => {
    if (record.type === 'makeUp') return theme.colors.primaryStrong;
    if (record.status === 'absent') return theme.colors.dangerStrong;
    if (record.status === 'scheduled') return theme.colors.successStrong;
    return theme.colors.secondaryStrong;
  };

  const labelFor = (record: Attendance) => {
    if (record.type === 'makeUp') return '보충';
    return { scheduled: '출석', unexpected: '예외', absent: '결석' }[record.status];
  };

  const header = (
    <>
      <Header>
        <TitleText>출결 이력</TitleText>
      </Header>

      <MonthBar>
        <MonthButton
          onPress={() => shiftMonth(-1)}
          accessibilityRole="button"
          accessibilityLabel="이전 달"
        >
          <Ionicons name="chevron-back" size={22} color={theme.colors.primaryStrong} />
        </MonthButton>
        <MonthLabel>
          {cursor.year}년 {cursor.month + 1}월
        </MonthLabel>
        <MonthButton
          onPress={() => shiftMonth(1)}
          disabled={isCurrentMonth}
          accessibilityRole="button"
          accessibilityLabel="다음 달"
        >
          <Ionicons
            name="chevron-forward"
            size={22}
            color={isCurrentMonth ? theme.colors.border : theme.colors.primaryStrong}
          />
        </MonthButton>
      </MonthBar>

      <Tallies>
        <Tally>
          <TallyValue $tone={theme.colors.successStrong}>{totals.scheduled}</TallyValue>
          <TallyLabel>출석</TallyLabel>
        </Tally>
        <Tally>
          <TallyValue $tone={theme.colors.secondaryStrong}>{totals.unexpected}</TallyValue>
          <TallyLabel>예외</TallyLabel>
        </Tally>
        <Tally>
          <TallyValue $tone={theme.colors.dangerStrong}>{totals.absent}</TallyValue>
          <TallyLabel>결석</TallyLabel>
        </Tally>
        <Tally>
          <TallyValue $tone={theme.colors.primaryStrong}>{totals.makeUp}</TallyValue>
          <TallyLabel>보충</TallyLabel>
        </Tally>
      </Tallies>

      <Segmented>
        {(['student', 'date'] as Mode[]).map((m) => (
          <SegmentButton
            key={m}
            $active={mode === m}
            onPress={() => setMode(m)}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === m }}
          >
            <SegmentLabel $active={mode === m}>
              {m === 'student' ? '학생별' : '날짜별'}
            </SegmentLabel>
          </SegmentButton>
        ))}
      </Segmented>

      {loading && (
        <View style={{ paddingVertical: 24 }}>
          <ActivityIndicator color={theme.colors.primaryStrong} />
        </View>
      )}
    </>
  );

  const empty = loading ? null : (
    <EmptyText>이 달에는 기록이 없습니다.</EmptyText>
  );

  if (mode === 'student') {
    return (
      <Screen>
        <SectionList
          sections={studentSections}
          keyExtractor={(item) => item.student.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 24 }}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          renderSectionHeader={({ section }) => <SectionTitle>{section.title}</SectionTitle>}
          renderItem={({ item }) => (
            <Row>
              <RowName numberOfLines={1}>{item.student.name}</RowName>
              <RowMeta>{studentSubtitle(item.student)}</RowMeta>
              {isWithdrawn(item.student) && <RowMeta>퇴원</RowMeta>}
              <Badge $tone={theme.colors.successStrong}>출석 {item.scheduled}</Badge>
              <Badge $tone={theme.colors.secondaryStrong}>예외 {item.unexpected}</Badge>
              <Badge $tone={theme.colors.dangerStrong}>결석 {item.absent}</Badge>
              <Badge $tone={theme.colors.primaryStrong}>보충 {item.makeUp}</Badge>
            </Row>
          )}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <SectionList
        sections={dateSections}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        renderSectionHeader={({ section }) => <SectionTitle>{section.title}</SectionTitle>}
        renderItem={({ item }) =>
          item.kind === 'closure' ? (
            <Row>
              <RowName numberOfLines={1}>휴강</RowName>
              <RowMeta>{item.note || '학원 전체 휴강'}</RowMeta>
              <Badge $tone={theme.colors.secondaryStrong}>휴강</Badge>
            </Row>
          ) : (
            <Row>
              <RowName numberOfLines={1}>{item.student.name}</RowName>
              <RowMeta>{studentSubtitle(item.student)}</RowMeta>
              <RowMeta>
                {formatTimeLabel(item.record.time)}
                {/* 하원까지 찍은 날은 머문 구간이 통째로 보여야 조퇴를 알아본다. */}
                {item.record.leaveTime ? ` – ${formatTimeLabel(item.record.leaveTime)}` : ''}
              </RowMeta>
              <Badge $tone={toneFor(item.record)}>{labelFor(item.record)}</Badge>
            </Row>
          )
        }
      />
    </Screen>
  );
};

export default HistoryScreen;
