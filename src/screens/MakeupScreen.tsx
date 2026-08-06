import React from 'react';
import styled, { useTheme } from 'styled-components/native';
import { Ionicons } from '@expo/vector-icons';
import Screen from '../components/common/Screen';

const Centered = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
  padding-bottom: ${({ theme }) => theme.spacing.large}px;
`;

const TitleText = styled.Text`
  font-size: 22px;
  font-weight: bold;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-top: ${({ theme }) => theme.spacing.medium}px;
`;

const SubText = styled.Text`
  font-size: 15px;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-align: center;
  margin-top: ${({ theme }) => theme.spacing.small}px;
`;

const MakeupScreen: React.FC = () => {
  const theme = useTheme();

  return (
    <Screen>
      <Centered>
        <Ionicons name="book-outline" size={56} color={theme.colors.border} />
        <TitleText>보충 수업</TitleText>
        <SubText>아직 준비 중인 기능입니다.</SubText>
      </Centered>
    </Screen>
  );
};

export default MakeupScreen;
