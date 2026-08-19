import React, { useCallback } from 'react';
import styled, { useTheme } from 'styled-components/native';
import { Ionicons } from '@expo/vector-icons';
import Button from './common/Button';
import { MakeUp, Student } from '../types';
import { formatDateLabel } from '../utils/date';
import { studentSubtitle } from '../utils/student';

export interface MakeupEntry {
  makeup: MakeUp;
  student: Student;
}

interface MakeupCardProps {
  entry: MakeupEntry;
  onSchedule: (entry: MakeupEntry) => void;
  onComplete: (entry: MakeupEntry) => void;
  onDelete: (entry: MakeupEntry) => void;
}

const CardContainer = styled.View`
  flex-grow: 1;
  background-color: ${({ theme }) => theme.colors.cardBackground};
  padding: ${({ theme }) => theme.spacing.medium}px;
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  shadow-color: #000;
  shadow-offset: 0px 2px;
  shadow-opacity: 0.1;
  shadow-radius: 4px;
  elevation: 2;
`;

const TopRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const NameText = styled.Text`
  font-size: 17px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme }) => theme.colors.textPrimary};
  flex: 1;
`;

const DeleteAction = styled.TouchableOpacity`
  padding: 4px;
`;

const MetaRow = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
`;

const MetaLabel = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};

  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const MetaValue = styled.Text<{ $pending?: boolean }>`
  font-size: 13px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme, $pending }) =>
    $pending ? theme.colors.secondaryStrong : theme.colors.textPrimary};
`;

const Actions = styled.View`
  flex-direction: row;
  gap: 8px;
  margin-top: ${({ theme }) => theme.spacing.medium}px;
`;

const ActionSlot = styled.View`
  flex: 1;
`;

const MakeupCard: React.FC<MakeupCardProps> = ({ entry, onSchedule, onComplete, onDelete }) => {
  const theme = useTheme();
  const handleSchedule = useCallback(() => onSchedule(entry), [onSchedule, entry]);
  const handleComplete = useCallback(() => onComplete(entry), [onComplete, entry]);
  const handleDelete = useCallback(() => onDelete(entry), [onDelete, entry]);

  const { makeup, student } = entry;
  const isScheduled = Boolean(makeup.makeUpDate);

  return (
    <CardContainer>
      <TopRow>
        <NameText numberOfLines={1}>
          {student.name}
          <MetaLabel>{`  ${studentSubtitle(student)}`}</MetaLabel>
        </NameText>
        <DeleteAction
          onPress={handleDelete}
          accessibilityRole="button"
          accessibilityLabel={`${student.name} 보충 삭제`}
        >
          <Ionicons name="trash-outline" size={18} color={theme.colors.textSecondary} />
        </DeleteAction>
      </TopRow>

      <MetaRow>
        <MetaLabel>결석일</MetaLabel>
        <MetaValue>{formatDateLabel(makeup.originalDate)}</MetaValue>
      </MetaRow>
      <MetaRow>
        <MetaLabel>보충일</MetaLabel>
        <MetaValue $pending={!isScheduled}>
          {isScheduled ? formatDateLabel(makeup.makeUpDate!) : '미정'}
        </MetaValue>
      </MetaRow>

      <Actions>
        <ActionSlot>
          <Button
            title={isScheduled ? '날짜 변경' : '날짜 지정'}
            variant="secondary"
            size="compact"
            onPress={handleSchedule}
          />
        </ActionSlot>
        <ActionSlot>
          <Button title="완료" size="compact" onPress={handleComplete} />
        </ActionSlot>
      </Actions>
    </CardContainer>
  );
};

export default React.memo(MakeupCard);
