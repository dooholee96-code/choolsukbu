import React, { useCallback, useMemo, useState } from 'react';
import styled, { useTheme } from 'styled-components/native';
import { FlatList, Platform, View } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../hooks/useData';
import { useResponsive } from '../hooks/useResponsive';
import Screen from '../components/common/Screen';
import GridRow from '../components/common/GridRow';
import MakeupCard, { MakeupEntry } from '../components/MakeupCard';
import { chunk } from '../utils/array';
import { confirm } from '../utils/dialog';

const Header = styled.View`
  margin-bottom: ${({ theme }) => theme.spacing.large}px;
`;

const TitleText = styled.Text`
  font-size: 28px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const SubText = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};

  font-size: 16px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Empty = styled.View`
  align-items: center;
  margin-top: ${({ theme }) => theme.spacing.large}px;
`;

const EmptyTitle = styled.Text`
  font-size: 16px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-top: ${({ theme }) => theme.spacing.medium}px;
`;

const EmptyText = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};

  font-size: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-align: center;
  margin-top: 6px;
`;

const MakeupScreen: React.FC = () => {
  const { makeups, students, scheduleMakeup, completeMakeup, deleteMakeup } = useData();
  const { columns } = useResponsive();
  const theme = useTheme();

  const [pickerTarget, setPickerTarget] = useState<MakeupEntry | null>(null);

  /**
   * 보충 건에 학생 정보를 붙인다. 학생이 지워졌는데 보충만 남은 경우는
   * 표시할 이름이 없으므로 목록에서 뺀다.
   * 날짜가 잡힌 건을 먼저, 그 안에서는 결석일이 오래된 순으로 보여준다.
   */
  const entries = useMemo<MakeupEntry[]>(() => {
    const byId = new Map(students.map((s) => [s.id, s]));

    return makeups
      .flatMap((makeup) => {
        const student = byId.get(makeup.studentId);
        return student ? [{ makeup, student }] : [];
      })
      .sort((a, b) => {
        const aDate = a.makeup.makeUpDate ?? '';
        const bDate = b.makeup.makeUpDate ?? '';
        if (Boolean(aDate) !== Boolean(bDate)) return aDate ? -1 : 1;
        if (aDate !== bDate) return aDate.localeCompare(bDate);
        return a.makeup.originalDate.localeCompare(b.makeup.originalDate);
      });
  }, [makeups, students]);

  const rows = useMemo(() => chunk(entries, columns), [entries, columns]);

  const handleSchedule = useCallback((entry: MakeupEntry) => setPickerTarget(entry), []);

  const handleDateChange = useCallback(
    (event: DateTimePickerEvent, selected?: Date) => {
      const target = pickerTarget;
      // Android는 취소해도 onChange가 불린다.
      if (Platform.OS !== 'ios') setPickerTarget(null);
      if (!target || event.type === 'dismissed' || !selected) return;

      scheduleMakeup(target.makeup.id, format(selected, 'yyyy-MM-dd'));
      if (Platform.OS === 'ios') setPickerTarget(null);
    },
    [pickerTarget, scheduleMakeup]
  );

  const handleComplete = useCallback(
    (entry: MakeupEntry) => {
      confirm({
        title: '보충 완료',
        message: `${entry.student.name} 학생의 보충을 완료 처리할까요?`,
        confirmLabel: '완료',
        onConfirm: () => completeMakeup(entry.makeup.id),
      });
    },
    [completeMakeup]
  );

  const handleDelete = useCallback(
    (entry: MakeupEntry) => {
      confirm({
        title: '보충 삭제',
        message: `${entry.student.name} 학생의 보충 건을 삭제할까요?`,
        confirmLabel: '삭제',
        destructive: true,
        onConfirm: () => deleteMakeup(entry.makeup.id),
      });
    },
    [deleteMakeup]
  );

  const scheduledCount = entries.filter((entry) => entry.makeup.makeUpDate).length;

  return (
    <Screen>
      <Header>
        <TitleText>보충 수업</TitleText>
        <SubText>
          {entries.length}건 대기 · 날짜 확정 {scheduledCount}건
        </SubText>
      </Header>

      <FlatList<MakeupEntry[]>
        data={rows}
        keyExtractor={(row, index) => row[0]?.makeup.id ?? `row-${index}`}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => (
          <GridRow
            items={item}
            columns={columns}
            keyExtractor={(entry) => entry.makeup.id}
            renderItem={(entry) => (
              <MakeupCard
                entry={entry}
                onSchedule={handleSchedule}
                onComplete={handleComplete}
                onDelete={handleDelete}
              />
            )}
          />
        )}
        ListEmptyComponent={
          <Empty>
            <Ionicons name="checkmark-done-outline" size={48} color={theme.colors.border} />
            <EmptyTitle>대기 중인 보충이 없습니다</EmptyTitle>
            <EmptyText>
              [오늘] 탭에서 결석 처리하면{'\n'}보충 건이 여기에 쌓입니다.
            </EmptyText>
          </Empty>
        }
      />

      {pickerTarget && (
        <View>
          <DateTimePicker
            value={
              pickerTarget.makeup.makeUpDate
                ? new Date(`${pickerTarget.makeup.makeUpDate}T00:00:00`)
                : new Date()
            }
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            onChange={handleDateChange}
            accessibilityLabel="보충일 선택"
          />
        </View>
      )}
    </Screen>
  );
};

export default MakeupScreen;
