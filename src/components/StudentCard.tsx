import React from 'react';
import styled from 'styled-components/native';
import { View } from 'react-native';
import { Student, Attendance } from '../types';
import Button from './common/Button';
import { format } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';

interface StudentCardProps {
  student: Student;
  attendance?: Attendance;
  onCheckIn?: () => void;
  showFee?: boolean; // 금액 표시 여부 제어
}

const CardContainer = styled.View`
  background-color: ${({ theme }) => theme.colors.cardBackground};
  padding: ${({ theme }) => theme.spacing.medium}px;
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  margin-bottom: ${({ theme }) => theme.spacing.small}px;
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

const Avatar = styled.View`
  width: 50px;
  height: 50px;
  border-radius: 25px;
  background-color: ${({ theme }) => theme.colors.primary}20; // 20% opacity
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
  font-size: 18px;
  font-weight: bold;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const SubText = styled.Text`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: 4px;
`;

const StatusContainer = styled.View`
  align-items: flex-end;
`;

const StatusTag = styled.View<{ status: 'scheduled' | 'unexpected' | 'absent' }>`
  background-color: ${({ theme, status }) => {
    switch (status) {
      case 'scheduled':
        return theme.colors.success + '20';
      case 'unexpected':
        return theme.colors.secondary + '20';
      case 'absent':
        return theme.colors.danger + '20';
      default:
        return theme.colors.background;
    }
  }};
  padding: 4px 8px;
  border-radius: 12px;
  margin-bottom: 4px;
`;

const StatusText = styled.Text<{ status: 'scheduled' | 'unexpected' | 'absent' }>`
  color: ${({ theme, status }) => {
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
  }};
  font-size: 12px;
  font-weight: bold;
`;

const StudentCard: React.FC<StudentCardProps> = ({
  student,
  attendance,
  onCheckIn,
  showFee = false,
}) => {
  const getInitials = (name: string) => {
    const names = name.split(' ');
    let initials = names[0].substring(0, 1).toUpperCase();
    if (names.length > 1) {
      initials += names[names.length - 1].substring(0, 1).toUpperCase();
    }
    return initials;
  };

  const formatTime = (time: string) => {
    const date = new Date(`2000-01-01T${time}`);
    return format(date, 'h:mm a');
  };

  return (
    <CardContainer>
      <InfoContainer>
        <Avatar>
          <AvatarText>{getInitials(student.name)}</AvatarText>
        </Avatar>
        <TextContainer>
          <NameText>{student.name}</NameText>
          <SubText>{student.grade}</SubText>
          <SubText>
            {formatTime(student.scheduledStartTime)} - {formatTime(student.scheduledEndTime)}
          </SubText>
          {showFee && student.fee && <SubText>₩{student.fee.toLocaleString()}/월</SubText>}
        </TextContainer>
      </InfoContainer>
      <StatusContainer>
        {attendance ? (
          <>
            <StatusTag status={attendance.status}>
              <StatusText status={attendance.status}>
                {attendance.status === 'scheduled' ? '출석' : '예외'}
              </StatusText>
            </StatusTag>
            <SubText>{formatTime(attendance.time)}</SubText>
            <Ionicons
              name="checkmark-circle"
              size={24}
              color={theme.colors.success}
              style={{ marginTop: 4 }}
            />
          </>
        ) : (
          <Button title="Check In" onPress={onCheckIn} />
        )}
      </StatusContainer>
    </CardContainer>
  );
};

export default StudentCard;
