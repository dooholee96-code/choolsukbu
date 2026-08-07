import React, { useCallback } from 'react';
import styled, { useTheme } from 'styled-components/native';
import { Student, Attendance } from '../types';
import Button from './common/Button';
import { formatTimeLabel } from '../utils/date';
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
  showFee?: boolean; // 금액 표시 여부 제어
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
  color: ${({ theme }) => theme.colors.primary};
  font-size: 18px;
  font-weight: bold;
`;

const TextContainer = styled.View`
  flex: 1;
`;

const NameText = styled.Text`
  font-size: 17px;
  font-weight: bold;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const SubText = styled.Text`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: 4px;
`;

const StatusContainer = styled.View`
  align-items: flex-end;
  margin-left: ${({ theme }) => theme.spacing.small}px;
`;

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

const StatusTag = styled.View<{ $status: Status }>`
  background-color: ${({ theme, $status }) => statusColor(theme, $status)}20;
  padding-vertical: 4px;
  padding-horizontal: 8px;
  border-radius: 12px;
  margin-bottom: 4px;
`;

const StatusText = styled.Text<{ $status: Status }>`
  color: ${({ theme, $status }) => statusColor(theme, $status)};
  font-size: 12px;
  font-weight: bold;
`;

const STATUS_LABEL: Record<Status, string> = {
  scheduled: '출석',
  unexpected: '예외',
  absent: '결석',
};

const getInitials = (name: string) => {
  const names = name.trim().split(/\s+/).filter(Boolean);
  if (names.length === 0) return '?';

  let initials = names[0].substring(0, 1).toUpperCase();
  if (names.length > 1) {
    initials += names[names.length - 1].substring(0, 1).toUpperCase();
  }
  return initials;
};

const StudentCard: React.FC<StudentCardProps> = ({
  student,
  attendance,
  onCheckIn,
  showFee = false,
}) => {
  const handleCheckIn = useCallback(() => onCheckIn?.(student), [onCheckIn, student]);

  // 이 색은 styled 템플릿 밖(JSX prop)에서 쓰이므로 훅으로 직접 꺼내야 한다.
  // 이전 코드는 import 없이 전역 theme을 참조해서 이 카드가 그려지는 순간
  // ReferenceError로 화면이 통째로 죽었다.
  const theme = useTheme();

  return (
    <CardContainer>
      <InfoContainer>
        <Avatar>
          <AvatarText>{getInitials(student.name)}</AvatarText>
        </Avatar>
        <TextContainer>
          <NameText numberOfLines={1}>{student.name}</NameText>
          <SubText numberOfLines={1}>{student.grade}</SubText>
          <SubText numberOfLines={1}>
            {formatTimeLabel(student.scheduledStartTime)} –{' '}
            {formatTimeLabel(student.scheduledEndTime)}
          </SubText>
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
            <SubText>{formatTimeLabel(attendance.time)}</SubText>
            <Ionicons
              name="checkmark-circle"
              size={22}
              color={theme.colors.success}
              style={{ marginTop: 4 }}
            />
          </>
        ) : (
          onCheckIn && <Button title="Check In" size="compact" onPress={handleCheckIn} />
        )}
      </StatusContainer>
    </CardContainer>
  );
};

/**
 * 원생 수가 늘면 컨텍스트가 한 번 바뀔 때마다 모든 카드가 다시 그려진다.
 * 카드는 props가 그대로면 결과도 같으므로 memo로 끊는다.
 */
export default React.memo(StudentCard);
