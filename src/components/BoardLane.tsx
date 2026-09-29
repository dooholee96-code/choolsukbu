import React from 'react';
import { ScrollView } from 'react-native';
import styled, { DefaultTheme } from 'styled-components/native';

export type LaneTone = 'pending' | 'present' | 'done';

const Lane = styled.View`
  flex: 1;
  min-width: 0;
  background-color: rgba(255, 253, 251, 0.55);
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  overflow: hidden;
`;

const LaneHeader = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding-vertical: 12px;
  padding-horizontal: 14px;
`;

const Title = styled.Text`
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 16px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const toneColor = (theme: DefaultTheme, tone: LaneTone) =>
  tone === 'pending'
    ? theme.colors.primaryStrong
    : tone === 'present'
      ? theme.colors.successStrong
      : theme.colors.textSecondary;

const CountBadge = styled.View<{ $tone: LaneTone }>`
  min-width: 32px;
  align-items: center;
  padding-vertical: 3px;
  padding-horizontal: 10px;
  border-radius: 12px;
  background-color: ${({ theme, $tone }) => toneColor(theme, $tone)}1F;
`;

const CountText = styled.Text<{ $tone: LaneTone }>`
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 15px;
  color: ${({ theme, $tone }) => toneColor(theme, $tone)};
`;

/** 한 칸 안에서 무리를 나눌 때 (예: 좁은 보드에서 '하원·결석'을 등원 칸 아래에). */
export const LaneGroupTitle = styled.Text`
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: ${({ theme }) => theme.spacing.medium}px;
  margin-bottom: ${({ theme }) => theme.spacing.small}px;
`;

export const LaneEmpty = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 14px;
  line-height: 21px;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-align: center;
  margin-vertical: ${({ theme }) => theme.spacing.large}px;
`;

/** 카드 사이 간격. 카드마다 여백을 주면 마지막 카드 아래에도 남는다. */
export const LaneGap = styled.View`
  gap: 8px;
`;

interface BoardLaneProps {
  title: string;
  count: number;
  tone: LaneTone;
  children: React.ReactNode;
}

/**
 * 큰 화면 보드의 한 칸. 제목과 인원은 제자리에 두고 명단만 따로 스크롤한다.
 *
 * FlatList가 아니라 ScrollView인 까닭: 한 칸에 많아야 수십 명이고 카드는 memo라,
 * 전부 그려 두는 편이 등원을 찍어 카드가 칸을 옮길 때 빈 자리 없이 바로 보인다.
 */
const BoardLane: React.FC<BoardLaneProps> = ({ title, count, tone, children }) => (
  <Lane>
    <LaneHeader accessibilityRole="header">
      <Title>{title}</Title>
      <CountBadge $tone={tone}>
        <CountText $tone={tone}>{count}</CountText>
      </CountBadge>
    </LaneHeader>
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 16 }}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  </Lane>
);

export default BoardLane;
