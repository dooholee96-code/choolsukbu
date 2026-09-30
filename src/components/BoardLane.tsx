import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import {
  Animated,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  View,
} from 'react-native';
import { useBump } from '../hooks/useMotion';
import { Ionicons } from '@expo/vector-icons';
import styled, { DefaultTheme, useTheme } from 'styled-components/native';

export type LaneTone = 'pending' | 'present' | 'done';

/**
 * 칸마다 색 하나씩. 신호등처럼 한눈에 갈리도록 서로 먼 색을 골랐다.
 * 아이의 하루가 왼쪽에서 오른쪽으로 흐른다.
 *
 *   등원 예정  해 노랑    — 아직 오지 않은, 눈길이 먼저 가야 하는 칸
 *   수업 중    풀빛 초록  — '출석' 표시와 같은 색이라 카드와 칸이 한 덩어리로 읽힌다
 *   하원       호수 블루  — 하루를 마치고 집에 간 칸
 *   결석       빨강       — 하원 칸 안에서 따로 묶는다 (TintGroup)
 *
 * 원색은 칸의 옅은 바탕과 테두리·아이콘에만 쓴다. 글씨는 원색 위에서 읽히지 않으므로
 * 제목은 본문 색 그대로 두고, 숫자 뱃지만 진한 색 위의 흰 글씨로 쓴다.
 */
export const laneColors = (theme: DefaultTheme, tone: LaneTone) =>
  tone === 'pending'
    ? { base: theme.colors.sun, strong: theme.colors.sunStrong }
    : tone === 'present'
      ? { base: theme.colors.success, strong: theme.colors.successStrong }
      : { base: theme.colors.primary, strong: theme.colors.primaryStrong };

const LANE_ICON: Record<LaneTone, keyof typeof Ionicons.glyphMap> = {
  pending: 'time-outline',
  present: 'book-outline',
  done: 'home-outline',
};

/*
 * 바탕은 원색을 옅게. 뒤의 숲 그림이 살짝 비치도록 불투명하게 칠하지 않는다.
 * hex 뒤 두 자리는 불투명도다 (33 = 20%, 80 = 50%).
 */
const Lane = styled.View<{ $tone: LaneTone }>`
  flex: 1;
  min-width: 0;
  background-color: ${({ theme, $tone }) => laneColors(theme, $tone).base}33;
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  border-width: 1px;
  border-color: ${({ theme, $tone }) => laneColors(theme, $tone).base}80;
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
  margin-top: ${({ theme }) => theme.spacing.small}px;
  margin-bottom: ${({ theme }) => theme.spacing.small}px;
`;

/**
 * color를 base 위에 amount만큼 섞은 불투명한 색. '#RRGGBB'만 받는다.
 *
 * 칸 안의 묶음을 반투명하게 칠하면 칸의 바탕색과 겹쳐 탁해진다 — 초록 칸 위의
 * 옅은 빨강은 갈색이 된다. 묶음은 바탕을 가리고 제 색만 보여야 한다.
 */
const mix = (color: string, base: string, amount: number) => {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const parts = [0, 1, 2].map((i) =>
    Math.round(channel(color, i) * amount + channel(base, i) * (1 - amount))
  );
  return `rgb(${parts.join(', ')})`;
};

/**
 * 칸 안의 다른 색 묶음. 결석은 하원 칸 안에서 빨간 바탕으로, 좁은 보드에서 수업 중 칸
 * 아래에 붙는 하원은 파란 바탕으로 따로 보인다. $color는 원색이다.
 */
export const TintGroup = styled.View<{ $color: string }>`
  margin-top: ${({ theme }) => theme.spacing.medium}px;
  padding: 8px;
  padding-top: 0px;
  border-radius: ${({ theme }) => theme.borderRadius.small}px;
  background-color: ${({ theme, $color }) => mix($color, theme.colors.cardBackground, 0.24)};
  border-width: 1px;
  border-color: ${({ $color }) => $color}80;
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
 * 칸 안의 카드가 '나를 보여 줘'라고 부르는 통로. 칸마다 따로 스크롤하므로, 명단이 긴
 * 칸에서는 방금 옮겨 온 카드가 화면 밖(아래)에 떨어질 수 있다. 빛나고 튀어도 보이지
 * 않으면 소용이 없다.
 */
const RevealContext = createContext<((target: View) => void) | null>(null);

/**
 * 칸 안의 카드 한 장을 감싼다. focus가 바뀌면(방금 기록한 카드) 칸이 그 카드까지 스크롤한다.
 * 이미 보이는 카드면 움직이지 않는다 — 눈앞의 명단이 괜히 흔들리면 누르던 자리를 잃는다.
 */
export const LaneItem: React.FC<{ focus?: number; children: React.ReactNode }> = ({
  focus,
  children,
}) => {
  const reveal = useContext(RevealContext);
  const ref = useRef<View>(null);

  useEffect(() => {
    if (!focus || !reveal) return;
    // 칸을 옮겨 막 그려진 참이면 아직 자리가 없다. 한 프레임 뒤에 잰다.
    const frame = requestAnimationFrame(() => {
      if (ref.current) reveal(ref.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [focus, reveal]);

  return <View ref={ref}>{children}</View>;
};

/** 스크롤해 보여 줄 때 카드 위아래에 남길 틈. 칸 가장자리에 딱 붙으면 잘려 보인다. */
const REVEAL_MARGIN = 12;

/**
 * 큰 화면 보드의 한 칸. 제목과 인원은 제자리에 두고 명단만 따로 스크롤한다.
 *
 * FlatList가 아니라 ScrollView인 까닭: 한 칸에 많아야 수십 명이고 카드는 memo라,
 * 전부 그려 두는 편이 등원을 찍어 카드가 칸을 옮길 때 빈 자리 없이 바로 보인다.
 *
 * 인원 뱃지는 수가 바뀌면 살짝 부푼다. 카드가 떠난 칸과 도착한 칸이 동시에 움찔해서
 * 어디서 어디로 갔는지가 한 번에 읽힌다.
 */
const BoardLane: React.FC<BoardLaneProps> = ({ title, count, tone, children }) => {
  const theme = useTheme();
  const badgeScale = useBump(count, 1.25);

  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  const scrollY = useRef(0);
  const viewportH = useRef(0);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = event.nativeEvent.contentOffset.y;
  }, []);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    viewportH.current = event.nativeEvent.layout.height;
  }, []);

  const reveal = useCallback((target: View) => {
    const content = contentRef.current;
    if (!content) return;
    target.measureLayout(
      content,
      (_x, y, _w, h) => {
        const top = scrollY.current;
        const bottom = top + viewportH.current;
        if (y - REVEAL_MARGIN < top) {
          scrollRef.current?.scrollTo({ y: Math.max(0, y - REVEAL_MARGIN), animated: true });
        } else if (y + h + REVEAL_MARGIN > bottom) {
          scrollRef.current?.scrollTo({
            y: y + h + REVEAL_MARGIN - viewportH.current,
            animated: true,
          });
        }
      },
      () => {}
    );
  }, []);

  return (
    <Lane $tone={tone}>
      <Accent $tone={tone} />
      <LaneHeader accessibilityRole="header">
        <TitleRow>
          <Ionicons name={LANE_ICON[tone]} size={18} color={laneColors(theme, tone).strong} />
          <Title>{title}</Title>
        </TitleRow>
        <Animated.View style={{ transform: [{ scale: badgeScale }] }}>
          <CountBadge $tone={tone}>
            <CountText>{count}</CountText>
          </CountBadge>
        </Animated.View>
      </LaneHeader>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={32}
        onLayout={onLayout}
      >
        <RevealContext.Provider value={reveal}>
          <View ref={contentRef}>{children}</View>
        </RevealContext.Provider>
      </ScrollView>
    </Lane>
  );
};

export default BoardLane;
