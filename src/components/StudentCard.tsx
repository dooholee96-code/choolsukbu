import React, { useCallback } from 'react';
import styled, { useTheme } from 'styled-components/native';
import { Student, Attendance } from '../types';
import Button from './common/Button';
import { arrivalOffsetLabel, formatTimeLabel } from '../utils/date';
import { Ionicons } from '@expo/vector-icons';

type Status = Attendance['status'];

interface StudentCardProps {
  student: Student;
  attendance?: Attendance;
  /**
   * 학생을 인자로 받는다. 부모가 () => handleCheckIn(student) 로 감싸면
   * 매 렌더 새 함수가 만들어져 React.memo가 항상 miss 난다.
   */
  onCheckIn?: (student: Student) => void;
  /** 결석 처리. 넘기면 Check In 아래에 결석 버튼이 붙는다. */
  onMarkAbsent?: (student: Student) => void;
  /** 이미 기록된 카드에서 오늘 기록을 되돌린다. */
  onUndo?: (student: Student) => void;
  /** 카드 자체를 눌렀을 때. 원생 정보 수정 진입에 쓴다. */
  onPress?: (student: Student) => void;
  showFee?: boolean; // 금액 표시 여부 제어
  /**
   * 그 날만 적용되는 수업 시간. 특강처럼 정규와 다를 때 부모가 넘긴다.
   * 비우면 원생의 정규 시간을 그대로 쓴다.
   */
  startTime?: string;
  endTime?: string;
  /** 정규 수업이 아니라 그 날만 추가된 자리인지 */
  isExtra?: boolean;
  /** 기록된 등원 시각 교정. 넘기면 시각이 눌리는 버튼이 된다. */
  onEditTime?: (student: Student, attendance: Attendance) => void;
}

/*
 * flex-grow만 준다. 'flex: 1'은 flex-basis까지 0으로 만드는데,
 * 부모 Cell의 높이가 콘텐츠에서 결정되는 구조라 basis 0이면
 * 카드 높이가 0으로 무너지고 내용이 밖으로 넘친다.
 * flex-basis를 auto로 남겨야 자연 높이를 잡은 뒤 한 행에서 높이가 맞춰진다.
 */
const CardContainer = styled.View`
  flex-grow: 1;
  background-color: ${({ theme }) => theme.colors.cardBackground};
  padding: ${({ theme }) => theme.spacing.medium}px;
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  shadow-color: #000;
  shadow-offset: 0px 2px;
  shadow-opacity: 0.1;
  shadow-radius: 4px;
  elevation: 2;
`;

const InfoContainer = styled.View`
  flex-direction: row;
  align-items: center;
  flex: 1;
`;

/*
 * 주의: 이 템플릿 안에서는 // 주석을 쓰면 안 된다.
 * styled-components 네이티브 파서는 블록 주석만 제거하고 // 는 그대로 두는데,
 * 값 파싱이 다음 ':' 까지 이어지면서 바로 다음 선언 한 줄을 통째로 삼킨다.
 * (실제로 여기 있던 '// 20% opacity' 가 align-items: center 를 먹고 있었다.)
 * 아래 primary + '20' 은 8자리 hex(#RRGGBBAA)로 불투명도 약 12.5%다.
 */
const Avatar = styled.View`
  width: 48px;
  height: 48px;
  border-radius: 24px;
  background-color: ${({ theme }) => theme.colors.primary}20;
  align-items: center;
  justify-content: center;
  margin-right: ${({ theme }) => theme.spacing.medium}px;
`;

const AvatarText = styled.Text`
  color: ${({ theme }) => theme.colors.primaryStrong};
  font-size: 18px;
  font-family: ${({ theme }) => theme.fonts.bold};`;

const TextContainer = styled.View`
  flex: 1;
`;

const NameText = styled.Text`
  font-size: 17px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const SubText = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};

  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: 4px;
`;

const StatusContainer = styled.View`
  align-items: flex-end;
  margin-left: ${({ theme }) => theme.spacing.small}px;
`;

const ActionStack = styled.View`
  align-items: flex-end;
  gap: 6px;
`;

const TextAction = styled.TouchableOpacity`
  padding-vertical: 4px;
  padding-horizontal: 6px;
`;

const TextActionLabel = styled.Text<{ $tone: 'danger' | 'muted' }>`
  font-size: 13px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme, $tone }) =>
    $tone === 'danger' ? theme.colors.dangerStrong : theme.colors.textSecondary};
`;

/** 태그 배경 틴트용 원색 */
const statusColor = (theme: ReturnType<typeof useTheme>, status: Status) => {
  switch (status) {
    case 'scheduled':
      return theme.colors.success;
    case 'unexpected':
      return theme.colors.secondary;
    case 'absent':
      return theme.colors.danger;
    default:
      return theme.colors.textPrimary;
  }
};

/** 태그 글씨용. 파스텔 원색은 카드 위에서 2:1 수준이라 읽히지 않는다. */
const statusTextColor = (theme: ReturnType<typeof useTheme>, status: Status) => {
  switch (status) {
    case 'scheduled':
      return theme.colors.successStrong;
    case 'unexpected':
      return theme.colors.secondaryStrong;
    case 'absent':
      return theme.colors.dangerStrong;
    default:
      return theme.colors.textPrimary;
  }
};

const StatusTag = styled.View<{ $status: Status }>`
  background-color: ${({ theme, $status }) => statusColor(theme, $status)}20;
  padding-vertical: 4px;
  padding-horizontal: 8px;
  border-radius: 12px;
  margin-bottom: 4px;
`;

const StatusText = styled.Text<{ $status: Status }>`
  color: ${({ theme, $status }) => statusTextColor(theme, $status)};
  font-size: 12px;
  font-family: ${({ theme }) => theme.fonts.bold};`;

const STATUS_LABEL: Record<Status, string> = {
  scheduled: '출석',
  unexpected: '예외',
  absent: '결석',
};

const ExtraTag = styled.View`
  align-self: flex-start;
  background-color: ${({ theme }) => theme.colors.secondary}20;
  padding-vertical: 2px;
  padding-horizontal: 7px;
  border-radius: 10px;
  margin-top: 4px;
`;

const ExtraTagText = styled.Text`
  color: ${({ theme }) => theme.colors.secondaryStrong};
  font-size: 11px;
  font-family: ${({ theme }) => theme.fonts.bold};`;

/** 지각·조기 도착 표시. 정시면 색을 죽여 눈에 걸리지 않게 둔다. */
const OffsetText = styled.Text`
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 11px;
  color: ${({ theme }) => theme.colors.secondaryStrong};
  margin-top: 2px;
`;

const TimeButton = styled.TouchableOpacity`
  padding-vertical: 2px;
`;

const getInitials = (name: string) => {
  const names = name.trim().split(/\s+/).filter(Boolean);
  if (names.length === 0) return '?';

  let initials = names[0].substring(0, 1).toUpperCase();
  if (names.length > 1) {
    initials += names[names.length - 1].substring(0, 1).toUpperCase();
  }
  return initials;
};

const PressableCard = styled.TouchableOpacity`
  flex-grow: 1;
`;

const StudentCard: React.FC<StudentCardProps> = ({
  student,
  attendance,
  onCheckIn,
  onMarkAbsent,
  onUndo,
  onPress,
  showFee = false,
  startTime,
  endTime,
  isExtra = false,
  onEditTime,
}) => {
  const handleCheckIn = useCallback(() => onCheckIn?.(student), [onCheckIn, student]);
  const handleMarkAbsent = useCallback(() => onMarkAbsent?.(student), [onMarkAbsent, student]);
  const handleUndo = useCallback(() => onUndo?.(student), [onUndo, student]);
  const handlePress = useCallback(() => onPress?.(student), [onPress, student]);
  const handleEditTime = useCallback(
    () => attendance && onEditTime?.(student, attendance),
    [onEditTime, student, attendance]
  );

  const effectiveStart = startTime ?? student.scheduledStartTime;
  const effectiveEnd = endTime ?? student.scheduledEndTime;

  // 결석에는 도착 시각이 없으므로 지각을 따질 것도 없다.
  const offset =
    attendance && attendance.status !== 'absent'
      ? arrivalOffsetLabel(attendance.time, effectiveStart)
      : null;

  // 이 색은 styled 템플릿 밖(JSX prop)에서 쓰이므로 훅으로 직접 꺼내야 한다.
  // 이전 코드는 import 없이 전역 theme을 참조해서 이 카드가 그려지는 순간
  // ReferenceError로 화면이 통째로 죽었다.
  const theme = useTheme();

  const card = (
    <CardContainer>
      <InfoContainer>
        <Avatar>
          <AvatarText>{getInitials(student.name)}</AvatarText>
        </Avatar>
        <TextContainer>
          <NameText numberOfLines={1}>{student.name}</NameText>
          <SubText numberOfLines={1}>{student.grade}</SubText>
          <SubText numberOfLines={1}>
            {formatTimeLabel(effectiveStart)} – {formatTimeLabel(effectiveEnd)}
          </SubText>
          {isExtra && (
            <ExtraTag>
              <ExtraTagText>추가 일정</ExtraTagText>
            </ExtraTag>
          )}
          {showFee && student.fee != null && (
            <SubText numberOfLines={1}>₩{student.fee.toLocaleString()}/월</SubText>
          )}
        </TextContainer>
      </InfoContainer>
      <StatusContainer>
        {attendance ? (
          <>
            <StatusTag $status={attendance.status}>
              <StatusText $status={attendance.status}>
                {STATUS_LABEL[attendance.status]}
              </StatusText>
            </StatusTag>
            {onEditTime ? (
              <TimeButton
                onPress={handleEditTime}
                accessibilityRole="button"
                accessibilityLabel={`${student.name} 등원 시각 수정`}
              >
                <SubText>{formatTimeLabel(attendance.time)}</SubText>
              </TimeButton>
            ) : (
              <SubText>{formatTimeLabel(attendance.time)}</SubText>
            )}
            {offset && <OffsetText>{offset}</OffsetText>}
            {onUndo ? (
              <TextAction
                onPress={handleUndo}
                accessibilityRole="button"
                accessibilityLabel={`${student.name} 기록 취소`}
              >
                <TextActionLabel $tone="muted">취소</TextActionLabel>
              </TextAction>
            ) : (
              attendance.status !== 'absent' && (
                <Ionicons
                  name="checkmark-circle"
                  size={22}
                  color={theme.colors.successStrong}
                  style={{ marginTop: 4 }}
                />
              )
            )}
          </>
        ) : (
          <ActionStack>
            {onCheckIn && <Button title="등원" size="compact" onPress={handleCheckIn} />}
            {onMarkAbsent && (
              <TextAction
                onPress={handleMarkAbsent}
                accessibilityRole="button"
                accessibilityLabel={`${student.name} 결석 처리`}
              >
                <TextActionLabel $tone="danger">결석</TextActionLabel>
              </TextAction>
            )}
          </ActionStack>
        )}
      </StatusContainer>
    </CardContainer>
  );

  if (!onPress) return card;

  return (
    <PressableCard
      onPress={handlePress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${student.name} 정보 수정`}
    >
      {card}
    </PressableCard>
  );
};

/**
 * 원생 수가 늘면 컨텍스트가 한 번 바뀔 때마다 모든 카드가 다시 그려진다.
 * 카드는 props가 그대로면 결과도 같으므로 memo로 끊는다.
 */
export default React.memo(StudentCard);
