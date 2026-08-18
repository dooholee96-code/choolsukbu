import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components/native';
import { Platform, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../hooks/useData';
import Button from '../components/common/Button';
import { formatDateLabel, formatTimeLabel } from '../utils/date';
import { buildRoster, closureNote, isClosedOn } from '../utils/roster';
import { logger } from '../utils/logger';
import { confirm, notify } from '../utils/dialog';
import { ScheduleException, Student } from '../types';

const Root = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const Content = styled.View`
  width: 100%;
  max-width: 560px;
  align-self: center;
  padding: ${({ theme }) => theme.spacing.medium}px;
`;

const TitleText = styled.Text`
  font-size: 24px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme }) => theme.colors.textPrimary};
  text-align: center;
`;

const Lead = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-align: center;
  margin-top: 6px;
  margin-bottom: ${({ theme }) => theme.spacing.large}px;
`;

const SectionTitle = styled.Text`
  font-size: 15px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-top: ${({ theme }) => theme.spacing.large}px;
  margin-bottom: ${({ theme }) => theme.spacing.small}px;
`;

const Note = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: ${({ theme }) => theme.spacing.small}px;
`;

const DateRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  background-color: ${({ theme }) => theme.colors.cardBackground};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  padding: ${({ theme }) => theme.spacing.medium}px;
`;

const DateLabel = styled.Text`
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 17px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const StepButton = styled.TouchableOpacity`
  padding: 8px;
`;

const Row = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  background-color: ${({ theme }) => theme.colors.cardBackground};
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  padding-vertical: 12px;
  padding-horizontal: ${({ theme }) => theme.spacing.medium}px;
  margin-bottom: 8px;
`;

const RowMain = styled.View`
  flex: 1;
`;

const RowName = styled.Text`
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 15px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const RowSub = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: 2px;
`;

const RowAction = styled.TouchableOpacity`
  padding-vertical: 6px;
  padding-horizontal: 10px;
  border-radius: 12px;
  background-color: ${({ theme }) => theme.colors.background};
`;

const RowActionText = styled.Text<{ $tone: 'add' | 'remove' }>`
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 13px;
  color: ${({ theme, $tone }) =>
    $tone === 'add' ? theme.colors.primaryStrong : theme.colors.dangerStrong};
`;

const Tag = styled.View<{ $tone: 'extra' | 'skip' }>`
  align-self: flex-start;
  background-color: ${({ theme, $tone }) =>
    $tone === 'extra' ? theme.colors.secondary : theme.colors.danger}20;
  padding-vertical: 2px;
  padding-horizontal: 7px;
  border-radius: 10px;
  margin-top: 4px;
`;

const TagText = styled.Text<{ $tone: 'extra' | 'skip' }>`
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 11px;
  color: ${({ theme, $tone }) =>
    $tone === 'extra' ? theme.colors.secondaryStrong : theme.colors.dangerStrong};
`;

const EmptyRow = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  padding-vertical: 10px;
`;

const ClosureBox = styled.View`
  background-color: ${({ theme }) => theme.colors.secondary}20;
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  padding: ${({ theme }) => theme.spacing.medium}px;
  align-items: center;
  margin-top: ${({ theme }) => theme.spacing.small}px;
`;

const ClosureText = styled.Text`
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 15px;
  color: ${({ theme }) => theme.colors.secondaryStrong};
  margin-bottom: ${({ theme }) => theme.spacing.small}px;
`;

const addDays = (date: Date, amount: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};

const ScheduleModal: React.FC = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const {
    students,
    loadExceptionsForDate,
    loadAttendanceRange,
    setClosure,
    addStudentException,
    removeException,
  } = useData();

  const [date, setDate] = useState(() => new Date());
  const [exceptions, setExceptions] = useState<ScheduleException[]>([]);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [busy, setBusy] = useState(false);

  const dateKey = format(date, 'yyyy-MM-dd');

  const reload = useCallback(async () => {
    try {
      setExceptions(await loadExceptionsForDate(dateKey));
    } catch (error) {
      logger.error('Failed to load schedule exceptions', error);
      notify('불러오기 실패', '그 날짜의 일정을 읽지 못했습니다.');
    }
  }, [dateKey, loadExceptionsForDate]);

  useEffect(() => {
    reload();
  }, [reload]);

  const closed = isClosedOn(exceptions);
  const note = closureNote(exceptions);

  const roster = useMemo(() => buildRoster(students, exceptions, date), [students, exceptions, date]);

  /** 명단에 든 원생 id. '추가할 수 있는 원생'을 고를 때 뺀다. */
  const rosterIds = useMemo(() => new Set(roster.map((entry) => entry.student.id)), [roster]);

  /** 정규 수업이 있었는데 그 날만 빠진 원생. 되돌릴 수 있게 따로 보여준다. */
  const skipped = useMemo(() => {
    const byId = new Map(students.map((student) => [student.id, student]));
    return exceptions
      .filter((rule) => rule.kind === 'skip' && rule.studentId)
      .map((rule) => ({ rule, student: byId.get(rule.studentId as string) }))
      .filter((row): row is { rule: ScheduleException; student: Student } => Boolean(row.student));
  }, [exceptions, students]);

  const addable = useMemo(
    () => students.filter((student) => !rosterIds.has(student.id)),
    [students, rosterIds]
  );

  const exceptionByStudent = useMemo(() => {
    const map = new Map<string, ScheduleException>();
    for (const rule of exceptions) {
      if (rule.studentId) map.set(rule.studentId, rule);
    }
    return map;
  }, [exceptions]);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      try {
        await action();
        await reload();
      } catch (error) {
        logger.error('Schedule change failed', error);
        notify('변경 실패', '일정을 바꾸지 못했습니다. 다시 시도해 주세요.');
      } finally {
        setBusy(false);
      }
    },
    [busy, reload]
  );

  /**
   * 휴강으로 지정하면 그 날 명단이 비어 홈 화면에서 사라진다. 이미 등원을 찍어
   * 둔 날이라면 그 기록에 손댈 방법이 없어지므로 (이력에는 남는다) 먼저 알린다.
   */
  const handleClose = useCallback(async () => {
    const existing = await loadAttendanceRange(dateKey, dateKey);
    if (existing.length === 0) {
      await run(() => setClosure(dateKey, true));
      return;
    }

    confirm({
      title: '이미 기록이 있습니다',
      message: `이 날 출결 기록 ${existing.length}건이 이미 있습니다.\n휴강으로 지정하면 [오늘] 화면에서 보이지 않게 됩니다.\n기록 자체는 이력에 남습니다.`,
      confirmLabel: '휴강으로 지정',
      onConfirm: () => run(() => setClosure(dateKey, true)),
    });
  }, [dateKey, loadAttendanceRange, run, setClosure]);

  const handleDateChange = useCallback((event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS !== 'ios') setShowDatePicker(false);
    if (event.type === 'dismissed' || !selected) return;
    setDate(selected);
    if (Platform.OS === 'ios') setShowDatePicker(false);
  }, []);

  return (
    <Root>
      <ScrollView
        // flex 없이는 ScrollView가 내용 높이만큼 커져서 시트 밖으로 잘려 나간다.
        style={{ flex: 1 }}
        contentContainerStyle={{
          // iOS의 modal/formSheet는 상태 표시줄 아래에서 시작하므로 top 인셋을 더하지 않는다.
          paddingTop: (Platform.OS === 'ios' ? 0 : insets.top) + 16,
          paddingBottom: insets.bottom + 32,
        }}
      >
        <Content>
          <TitleText>일정</TitleText>
          <Lead>
            휴강, 특강, 요일 변경처럼{'\n'}그 날 하루만 달라지는 것을 지정합니다.
          </Lead>

          <DateRow>
            <StepButton
              onPress={() => setDate((current) => addDays(current, -1))}
              accessibilityRole="button"
              accessibilityLabel="이전 날"
            >
              <Ionicons name="chevron-back" size={20} />
            </StepButton>
            <RowMain style={{ alignItems: 'center' }}>
              <DateLabel
                onPress={() => setShowDatePicker(true)}
                accessibilityRole="button"
                accessibilityLabel="날짜 선택"
              >
                {formatDateLabel(dateKey)}
              </DateLabel>
            </RowMain>
            <StepButton
              onPress={() => setDate((current) => addDays(current, 1))}
              accessibilityRole="button"
              accessibilityLabel="다음 날"
            >
              <Ionicons name="chevron-forward" size={20} />
            </StepButton>
          </DateRow>

          {showDatePicker && (
            <DateTimePicker
              value={date}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={handleDateChange}
            />
          )}

          <SectionTitle>휴강</SectionTitle>
          {closed ? (
            <ClosureBox>
              <ClosureText>이 날은 휴강입니다</ClosureText>
              {Boolean(note) && <Note>{note}</Note>}
              <Button
                title="휴강 해제"
                variant="secondary"
                size="compact"
                disabled={busy}
                onPress={() => run(() => setClosure(dateKey, false))}
              />
            </ClosureBox>
          ) : (
            <>
              <Note>공휴일이나 방학처럼 학원 전체가 쉬는 날로 지정합니다.</Note>
              <Button
                title="이 날 휴강으로 지정"
                variant="secondary"
                disabled={busy}
                onPress={handleClose}
              />
            </>
          )}

          {!closed && (
            <>
              <SectionTitle>이 날 오는 원생 — {roster.length}</SectionTitle>
              {roster.length === 0 ? (
                <EmptyRow>이 날 수업이 있는 원생이 없습니다.</EmptyRow>
              ) : (
                roster.map((entry) => {
                  const rule = exceptionByStudent.get(entry.student.id);
                  return (
                    <Row key={entry.student.id}>
                      <RowMain>
                        <RowName>{entry.student.name}</RowName>
                        <RowSub>
                          {entry.student.grade} · {formatTimeLabel(entry.startTime)} –{' '}
                          {formatTimeLabel(entry.endTime)}
                        </RowSub>
                        {entry.isExtra && (
                          <Tag $tone="extra">
                            <TagText $tone="extra">추가 일정</TagText>
                          </Tag>
                        )}
                      </RowMain>
                      <RowAction
                        disabled={busy}
                        accessibilityRole="button"
                        accessibilityLabel={`${entry.student.name} 이 날 제외`}
                        onPress={() =>
                          run(() =>
                            // 특강으로 넣은 자리는 예외를 지우면 원래대로 사라진다.
                            // 정규 수업은 지울 예외가 없으므로 skip을 새로 만든다.
                            entry.isExtra && rule
                              ? removeException(rule.id)
                              : addStudentException(dateKey, entry.student.id, 'skip')
                          )
                        }
                      >
                        <RowActionText $tone="remove">빼기</RowActionText>
                      </RowAction>
                    </Row>
                  );
                })
              )}

              {skipped.length > 0 && (
                <>
                  <SectionTitle>이 날 빠지는 원생 — {skipped.length}</SectionTitle>
                  <Note>결석이 아닙니다. 출결 기록에도 남지 않습니다.</Note>
                  {skipped.map(({ rule, student }) => (
                    <Row key={rule.id}>
                      <RowMain>
                        <RowName>{student.name}</RowName>
                        <RowSub>{student.grade}</RowSub>
                        <Tag $tone="skip">
                          <TagText $tone="skip">빠짐</TagText>
                        </Tag>
                      </RowMain>
                      <RowAction
                        disabled={busy}
                        accessibilityRole="button"
                        accessibilityLabel={`${student.name} 되돌리기`}
                        onPress={() => run(() => removeException(rule.id))}
                      >
                        <RowActionText $tone="add">되돌리기</RowActionText>
                      </RowAction>
                    </Row>
                  ))}
                </>
              )}

              <SectionTitle>이 날 추가로 부르기</SectionTitle>
              <Note>
                토요일 특강이나 요일을 옮겨 오는 원생을 넣습니다.{'\n'}
                요일을 옮길 때는 원래 날짜에서 [빼기]도 함께 해 주세요.
              </Note>
              {addable.length === 0 ? (
                <EmptyRow>모든 원생이 이미 이 날 명단에 있습니다.</EmptyRow>
              ) : (
                addable.map((student) => (
                  <Row key={student.id}>
                    <RowMain>
                      <RowName>{student.name}</RowName>
                      <RowSub>
                        {student.grade} · {formatTimeLabel(student.scheduledStartTime)} –{' '}
                        {formatTimeLabel(student.scheduledEndTime)}
                      </RowSub>
                    </RowMain>
                    <RowAction
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel={`${student.name} 이 날 추가`}
                      onPress={() => run(() => addStudentException(dateKey, student.id, 'extra'))}
                    >
                      <RowActionText $tone="add">추가</RowActionText>
                    </RowAction>
                  </Row>
                ))
              )}
            </>
          )}

          <View style={{ marginTop: 28 }}>
            <Button title="닫기" variant="secondary" onPress={() => navigation.goBack()} />
          </View>
        </Content>
      </ScrollView>
    </Root>
  );
};

export default ScheduleModal;
