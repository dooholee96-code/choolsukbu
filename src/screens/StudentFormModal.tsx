import React, { useState } from 'react';
import styled from 'styled-components/native';
import { View, ScrollView, Platform, KeyboardAvoidingView } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import { useData } from '../hooks/useData';
import Button from '../components/common/Button';
import Chip from '../components/common/Chip';
import { DayOfWeek, Student } from '../types';
import { createId } from '../utils/id';
import type { RootStackParamList } from '../types/navigation';
import { logger } from '../utils/logger';
import { confirm, notify } from '../utils/dialog';

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
  font-weight: bold;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-bottom: ${({ theme }) => theme.spacing.large}px;
  text-align: center;
`;

const Label = styled.Text`
  font-size: 16px;
  font-weight: bold;
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
  font-size: 16px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Actions = styled.View`
  margin-top: ${({ theme }) => theme.spacing.large}px;
  gap: 12px;
`;

const DAYS: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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
  const [fee, setFee] = useState(editing?.fee != null ? String(editing.fee) : '');
  const [isSaving, setIsSaving] = useState(false);

  const toggleDay = (day: DayOfWeek) => {
    setSelectedDays((previous) =>
      previous.includes(day) ? previous.filter((d) => d !== day) : [...previous, day]
    );
  };

  const handleSave = async () => {
    if (!name.trim() || !grade.trim() || selectedDays.length === 0) {
      notify('입력 확인', '이름, 학년, 수업 요일을 모두 입력해 주세요.');
      return;
    }

    // 요일은 선택 순서가 아니라 주간 순서로 저장한다.
    const orderedDays = DAYS.filter((day) => selectedDays.includes(day));
    const parsedFee = Number(fee.replace(/[^0-9]/g, ''));

    const nextStudent: Student = {
      id: editing?.id ?? createId(),
      name: name.trim(),
      grade: grade.trim(),
      scheduledDays: orderedDays,
      scheduledStartTime: format(startTime, 'HH:mm'),
      scheduledEndTime: format(endTime, 'HH:mm'),
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
          contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }}
          keyboardShouldPersistTaps="handled"
        >
          <Form>
            <TitleText>{isEditing ? '원생 정보 수정' : 'Add New Student'}</TitleText>

            <Label>Name</Label>
            <StyledTextInput
              value={name}
              onChangeText={setName}
              placeholder="이름"
              returnKeyType="next"
            />

            <Label>Grade</Label>
            <StyledTextInput
              value={grade}
              onChangeText={setGrade}
              placeholder="학년"
              returnKeyType="next"
            />

            <Label>Scheduled Days</Label>
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

            <Label>Scheduled Time</Label>
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

            <Label>Monthly Fee (Optional)</Label>
            <StyledTextInput
              value={fee}
              onChangeText={(text) => setFee(text.replace(/[^0-9]/g, ''))}
              placeholder="월 수강료"
              keyboardType="number-pad"
            />

            <Actions>
              <Button
                title={isSaving ? '저장 중…' : isEditing ? '저장' : 'Save Student'}
                onPress={handleSave}
                disabled={isSaving}
              />
              <View>
                <Button title="Cancel" variant="secondary" onPress={() => navigation.goBack()} />
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
