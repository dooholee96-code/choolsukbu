import React, { useState } from 'react';
import styled from 'styled-components/native';
import { View, ScrollView, Platform, KeyboardAvoidingView } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../hooks/useData';
import Button from '../components/common/Button';
import Chip from '../components/common/Chip';
import { DayOfWeek, DaySchedule, Student } from '../types';
import { createId } from '../utils/id';
import type { RootStackParamList } from '../types/navigation';
import { logger } from '../utils/logger';
import { confirm, notify } from '../utils/dialog';
import { DAY_LABEL, DAYS } from '../utils/schedule';

const Root = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const Form = styled.View`
  width: 100%;
  max-width: 560px;
  align-self: center;
  padding: ${({ theme }) => theme.spacing.medium}px;
`;

const TitleText = styled.Text`
  font-size: 24px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-bottom: ${({ theme }) => theme.spacing.large}px;
  text-align: center;
`;

const Label = styled.Text`
  font-size: 16px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-bottom: ${({ theme }) => theme.spacing.small}px;
  margin-top: ${({ theme }) => theme.spacing.medium}px;
`;

const StyledTextInput = styled.TextInput`
  background-color: ${({ theme }) => theme.colors.cardBackground};
  padding: ${({ theme }) => theme.spacing.medium}px;
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 16px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const ChipContainer = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
`;

const TimeRow = styled.View`
  flex-direction: row;
  gap: 12px;
`;

const TimeField = styled.View`
  flex: 1;
`;

const TimePickerButton = styled.TouchableOpacity`
  background-color: ${({ theme }) => theme.colors.cardBackground};
  padding: ${({ theme }) => theme.spacing.medium}px;
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  align-items: center;
`;

const TimePickerText = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};

  font-size: 16px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Actions = styled.View`
  margin-top: ${({ theme }) => theme.spacing.large}px;
  gap: 12px;
`;

const ToggleRow = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding-vertical: 10px;
`;

const ToggleBox = styled.View<{ $on: boolean }>`
  width: 22px;
  height: 22px;
  border-radius: 7px;
  border-width: 2px;
  border-color: ${({ theme, $on }) => ($on ? theme.colors.primaryStrong : theme.colors.border)};
  background-color: ${({ theme, $on }) => ($on ? theme.colors.primaryStrong : 'transparent')};
  align-items: center;
  justify-content: center;
`;

const ToggleLabel = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 15px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const DayTimeRow = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
`;

const DayTimeLabel = styled.Text`
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 16px;
  color: ${({ theme }) => theme.colors.textPrimary};
  width: 24px;
`;

const HintText = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: ${({ theme }) => theme.spacing.small}px;
`;

/** 오늘 날짜의 특정 시각. 피커는 Date를 요구하지만 날짜 부분은 쓰지 않는다. */
const timeAt = (hours: number, minutes = 0) => {
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
};

/** 'HH:mm' 을 피커가 요구하는 Date로. 값이 이상하면 기본 시각으로 떨어진다. */
const timeFrom = (value: string | undefined, fallbackHour: number) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? '');
  if (!match) return timeAt(fallbackHour);
  return timeAt(Number(match[1]), Number(match[2]));
};

const StudentFormModal: React.FC = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { params } = useRoute<RouteProp<RootStackParamList, 'StudentFormModal'>>();
  const { students, addStudent, updateStudent, deleteStudent } = useData();

  // 수정 대상. 신규 등록이면 undefined다.
  const editing = params?.studentId
    ? students.find((s) => s.id === params.studentId)
    : undefined;
  const isEditing = Boolean(editing);

  const [name, setName] = useState(editing?.name ?? '');
  const [grade, setGrade] = useState(editing?.grade ?? '');
  const [selectedDays, setSelectedDays] = useState<DayOfWeek[]>(editing?.scheduledDays ?? []);
  // 신규 등록의 기본값을 둘 다 new Date()로 두면 시작과 종료가 같아져 구간 길이가
  // 0이 되고, 사용자가 시간을 건드리지 않으면 모든 등원이 '예외'로 기록된다.
  const [startTime, setStartTime] = useState(() => timeFrom(editing?.scheduledStartTime, 16));
  const [endTime, setEndTime] = useState(() => timeFrom(editing?.scheduledEndTime, 18));
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);

  // 요일별로 시간이 다른 반. 켜면 선택한 요일마다 시간 줄이 하나씩 생긴다.
  const [perDay, setPerDay] = useState(() => Boolean(editing?.dayTimes));
  const [dayTimes, setDayTimes] = useState<Partial<Record<DayOfWeek, DaySchedule>>>(
    () => editing?.dayTimes ?? {}
  );
  const [dayPicker, setDayPicker] = useState<{ day: DayOfWeek; edge: 'start' | 'end' } | null>(
    null
  );
  const [fee, setFee] = useState(editing?.fee != null ? String(editing.fee) : '');
  const [isSaving, setIsSaving] = useState(false);

  // iOS의 modal/formSheet는 상태 표시줄 아래에서 시작하므로 창의 top 인셋을 더하면
  // 그만큼 위가 비고 내용이 아래로 밀린다. Android 모달은 전체 화면이라 인셋이 필요하다.
  const topInset = Platform.OS === 'ios' ? 0 : insets.top;

  const toggleDay = (day: DayOfWeek) => {
    setSelectedDays((previous) =>
      previous.includes(day) ? previous.filter((d) => d !== day) : [...previous, day]
    );
    // 해제한 요일의 시간까지 들고 있으면, 나중에 다시 켰을 때 예전 값이
    // 되살아나 사용자가 지정한 적 없는 시간이 저장된다.
    setDayTimes((previous) => {
      const next = { ...previous };
      delete next[day];
      return next;
    });
  };

  /** 요일별 줄의 현재 값. 아직 안 건드린 요일은 기본 시간으로 보인다. */
  const timeForDay = (day: DayOfWeek): DaySchedule =>
    dayTimes[day] ?? { start: format(startTime, 'HH:mm'), end: format(endTime, 'HH:mm') };

  const setDayTime = (day: DayOfWeek, edge: 'start' | 'end', value: Date) =>
    setDayTimes((previous) => ({
      ...previous,
      [day]: { ...timeForDay(day), [edge]: format(value, 'HH:mm') },
    }));

  const handleSave = async () => {
    if (!name.trim() || !grade.trim() || selectedDays.length === 0) {
      notify('입력 확인', '이름, 학년, 수업 요일을 모두 입력해 주세요.');
      return;
    }

    // 요일은 선택 순서가 아니라 주간 순서로 저장한다.
    const orderedDays = DAYS.filter((day) => selectedDays.includes(day));
    const parsedFee = Number(fee.replace(/[^0-9]/g, ''));

    // 요일별 시간을 껐으면 저장하지 않는다. 남겨두면 화면에는 안 보이는데
    // 등원 판정만 그 값을 쓰는 상태가 된다.
    const perDayTimes = perDay
      ? orderedDays.reduce<Partial<Record<DayOfWeek, DaySchedule>>>((acc, day) => {
          acc[day] = timeForDay(day);
          return acc;
        }, {})
      : undefined;

    const nextStudent: Student = {
      id: editing?.id ?? createId(),
      name: name.trim(),
      grade: grade.trim(),
      scheduledDays: orderedDays,
      scheduledStartTime: format(startTime, 'HH:mm'),
      scheduledEndTime: format(endTime, 'HH:mm'),
      dayTimes: perDayTimes,
      fee: parsedFee > 0 ? parsedFee : undefined,
    };

    setIsSaving(true);
    try {
      await (isEditing ? updateStudent(nextStudent) : addStudent(nextStudent));
      navigation.goBack();
    } catch (error) {
      logger.error('Failed to save student', error);
      notify('저장 실패', '원생 정보를 저장하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = () => {
    if (!editing) return;

    confirm({
      title: '원생 삭제',
      message: `${editing.name} 학생을 삭제할까요?\n출결 기록과 보충 건도 함께 삭제되며 되돌릴 수 없습니다.`,
      confirmLabel: '삭제',
      destructive: true,
      onConfirm: async () => {
        try {
          await deleteStudent(editing.id);
          navigation.goBack();
        } catch (error) {
          logger.error('Failed to delete student', error);
          notify('삭제 실패', '원생을 삭제하지 못했습니다. 다시 시도해 주세요.');
        }
      },
    });
  };

  /**
   * Android는 피커를 취소해도 onChange가 불린다. event.type을 보지 않으면
   * 취소한 값이 그대로 반영되므로 'dismissed'는 걸러낸다.
   */
  const makeTimeChangeHandler =
    (setTime: (date: Date) => void, setVisible: (visible: boolean) => void) =>
    (event: DateTimePickerEvent, selectedDate?: Date) => {
      if (Platform.OS !== 'ios') setVisible(false);
      if (event.type === 'dismissed' || !selectedDate) return;
      setTime(selectedDate);
    };

  /** 주간 순서로 정렬한 선택 요일. 화면에서도 월→일 순서로 보여야 한다. */
  const orderedSelectedDays = DAYS.filter((day) => selectedDays.includes(day));

  /**
   * 요일별 시간 한 칸. iOS는 compact 피커가 그 자체로 탭 가능한 칩이라 상시
   * 렌더하고, 그 외 플랫폼은 버튼을 눌렀을 때만 피커를 띄운다.
   */
  const renderDayTimeField = (day: DayOfWeek, edge: 'start' | 'end', value: string) => {
    const label = `${DAY_LABEL[day]}요일 ${edge === 'start' ? '시작' : '종료'} 시각`;
    const asDate = timeFrom(value, edge === 'start' ? 16 : 18);
    const isOpen = dayPicker?.day === day && dayPicker.edge === edge;

    const onChange = (event: DateTimePickerEvent, selected?: Date) => {
      if (Platform.OS !== 'ios') setDayPicker(null);
      if (event.type === 'dismissed' || !selected) return;
      setDayTime(day, edge, selected);
    };

    return (
      <TimeField>
        {Platform.OS === 'ios' ? (
          <DateTimePicker
            value={asDate}
            mode="time"
            display="compact"
            onChange={onChange}
            accessibilityLabel={label}
          />
        ) : (
          <>
            <TimePickerButton
              onPress={() => setDayPicker({ day, edge })}
              accessibilityLabel={label}
            >
              <TimePickerText>{format(asDate, 'h:mm a')}</TimePickerText>
            </TimePickerButton>
            {isOpen && (
              <DateTimePicker value={asDate} mode="time" display="default" onChange={onChange} />
            )}
          </>
        )}
      </TimeField>
    );
  };

  const renderTimeField = (
    label: string,
    value: Date,
    setValue: (date: Date) => void,
    isVisible: boolean,
    setVisible: (visible: boolean) => void
  ) => {
    const onChange = makeTimeChangeHandler(setValue, setVisible);

    return (
      <TimeField>
        {/* iOS는 compact 피커 자체가 탭 가능한 칩이라 상시 렌더한다.
            토글 방식이면 피커가 나타날 때 아래 내용이 밀려 레이아웃이 흔들린다. */}
        {Platform.OS === 'ios' ? (
          <DateTimePicker
            value={value}
            mode="time"
            display="compact"
            onChange={onChange}
            accessibilityLabel={label}
          />
        ) : (
          <>
            <TimePickerButton onPress={() => setVisible(true)} accessibilityLabel={label}>
              <TimePickerText>{format(value, 'h:mm a')}</TimePickerText>
            </TimePickerButton>
            {isVisible && (
              <DateTimePicker value={value} mode="time" display="default" onChange={onChange} />
            )}
          </>
        )}
      </TimeField>
    );
  };

  return (
    <Root>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          // flex 없이는 ScrollView가 내용 높이만큼 커져서 시트 밖으로 잘려 나가고,
          // 스크롤 영역이 화면보다 커지므로 스크롤도 먹지 않는다.
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: topInset + 16, paddingBottom: insets.bottom + 32 }}
          keyboardShouldPersistTaps="handled"
        >
          <Form>
            <TitleText>{isEditing ? '원생 정보 수정' : '원생 등록'}</TitleText>

            <Label>이름</Label>
            <StyledTextInput
              value={name}
              onChangeText={setName}
              placeholder="이름"
              returnKeyType="next"
            />

            <Label>학년</Label>
            <StyledTextInput
              value={grade}
              onChangeText={setGrade}
              placeholder="학년"
              returnKeyType="next"
            />

            <Label>수업 요일</Label>
            <ChipContainer>
              {DAYS.map((day) => (
                <Chip
                  key={day}
                  label={day}
                  selected={selectedDays.includes(day)}
                  onPress={() => toggleDay(day)}
                />
              ))}
            </ChipContainer>

            <Label>수업 시간</Label>
            <ToggleRow
              onPress={() => setPerDay((on) => !on)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: perDay }}
              accessibilityLabel="요일마다 시간이 다름"
            >
              <ToggleBox $on={perDay}>
                {perDay && <Ionicons name="checkmark" size={14} color="white" />}
              </ToggleBox>
              <ToggleLabel>요일마다 시간이 다름</ToggleLabel>
            </ToggleRow>

            {perDay ? (
              orderedSelectedDays.length === 0 ? (
                <HintText>수업 요일을 먼저 고르세요.</HintText>
              ) : (
                <>
                  <HintText>요일별로 시작·종료 시각을 정합니다.</HintText>
                  {orderedSelectedDays.map((day) => {
                    const value = timeForDay(day);
                    return (
                      <DayTimeRow key={day}>
                        <DayTimeLabel>{DAY_LABEL[day]}</DayTimeLabel>
                        {renderDayTimeField(day, 'start', value.start)}
                        {renderDayTimeField(day, 'end', value.end)}
                      </DayTimeRow>
                    );
                  })}
                </>
              )
            ) : (
              <TimeRow>
                {renderTimeField(
                  '수업 시작 시각',
                  startTime,
                  setStartTime,
                  showStartTimePicker,
                  setShowStartTimePicker
                )}
                {renderTimeField(
                  '수업 종료 시각',
                  endTime,
                  setEndTime,
                  showEndTimePicker,
                  setShowEndTimePicker
                )}
              </TimeRow>
            )}

            <Label>월 수강료 (선택)</Label>
            <StyledTextInput
              value={fee}
              onChangeText={(text) => setFee(text.replace(/[^0-9]/g, ''))}
              placeholder="월 수강료"
              keyboardType="number-pad"
            />

            <Actions>
              <Button
                title={isSaving ? '저장 중…' : isEditing ? '저장' : '등록'}
                onPress={handleSave}
                disabled={isSaving}
              />
              <View>
                <Button title="취소" variant="secondary" onPress={() => navigation.goBack()} />
              </View>
              {isEditing && (
                <View>
                  <Button title="원생 삭제" variant="danger" onPress={handleDelete} />
                </View>
              )}
            </Actions>
          </Form>
        </ScrollView>
      </KeyboardAvoidingView>
    </Root>
  );
};

export default StudentFormModal;
