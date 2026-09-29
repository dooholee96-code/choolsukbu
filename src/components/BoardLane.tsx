import React from 'react';
import { ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import styled, { DefaultTheme, useTheme } from 'styled-components/native';

export type LaneTone = 'pending' | 'present' | 'done';

/**
 * 칸마다 숲 배경에 이미 있는 색 하나씩. 아이의 하루가 왼쪽에서 오른쪽으로 흐른다.
 *
 *   등원 예정  호수 블루 — 아직 오지 않은, 기다리는 칸
 *   수업 중    풀빛 초록 — '출석' 표시와 같은 색이라 카드와 칸이 한 덩어리로 읽힌다
 *   하원·결석  라벤더    — 하루를 마친 칸
 *
 * 원색은 칸의 옅은 바탕과 테두리·아이콘에만 쓴다. 글씨는 원색 위에서 읽히지 않으므로
 * 제목은 본문 색 그대로 두고, 숫자 뱃지만 진한 색 위의 흰 글씨로 쓴다.
 */
export const laneColors = (theme: DefaultTheme, tone: LaneTone) =>
  tone === 'pending'
    ? { base: theme.colors.primary, strong: theme.colors.primaryStrong }
    : tone === 'present'
      ? { base: theme.colors.success, strong: theme.colors.successStrong }
      : { base: theme.colors.lavender, strong: theme.colors.lavenderStrong };

const LANE_ICON: Record<LaneTone, keyof typeof Ionicons.glyphMap> = {
  pending: 'time-outline',
  present: 'book-outline',
  done: 'home-outline',
};

/*
 * 바탕은 원색을 옅게. 뒤의 숲 그림이 살짝 비치도록 불투명하게 칠하지 않는다.
 * hex 뒤 두 자리는 불투명도다 (24 ≈ 14%, 66 ≈ 40%).
 */
const Lane = styled.View<{ $tone: LaneTone }>`
  flex: 1;
  min-width: 0;
  background-color: ${({ theme, $tone }) => laneColors(theme, $tone).base}24;
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  border-width: 1px;
  border-color: ${({ theme, $tone }) => laneColors(theme, $tone).base}66;
  overflow: hidden;
`;

/* 윗변의 색 띠. 칸이 길어 바탕색이 옅게 느껴질 때도 어느 칸인지 한눈에 갈린다. */
const Accent = styled.View<{ $tone: LaneTone }>`
  height: 4px;
  background-color: ${({ theme, $tone }) => laneColors(theme, $tone).base};
`;

const LaneHeader = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding-vertical: 12px;
  padding-horizontal: 14px;
`;

const TitleRow = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 8px;
`;

const Title = styled.Text`
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 16px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const CountBadge = styled.View<{ $tone: LaneTone }>`
  min-width: 32px;
  align-items: center;
  padding-vertical: 3px;
  padding-horizontal: 10px;
  border-radius: 12px;
  background-color: ${({ theme, $tone }) => laneColors(theme, $tone).strong};
`;

const CountText = styled.Text`
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 15px;
  color: #ffffff;
`;

/** 한 칸 안에서 무리를 나눌 때 (예: 좁은 보드에서 '하원·결석'을 등원 칸 아래에). */
export const LaneGroupTitle = styled.Text<{ $color?: string }>`
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 13px;
  color: ${({ theme, $color }) => $color ?? theme.colors.textSecondary};
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
const BoardLane: React.FC<BoardLaneProps> = ({ title, count, tone, children }) => {
  const theme = useTheme();
  return (
    <Lane $tone={tone}>
      <Accent $tone={tone} />
      <LaneHeader accessibilityRole="header">
        <TitleRow>
          <Ionicons name={LANE_ICON[tone]} size={18} color={laneColors(theme, tone).strong} />
          <Title>{title}</Title>
        </TitleRow>
        <CountBadge $tone={tone}>
          <CountText>{count}</CountText>
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
};

export default BoardLane;
