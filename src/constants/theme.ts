export const theme = {
  colors: {
    primary: '#007AFF', // 블루
    secondary: '#FF9500', // 오렌지 (보충/예외)
    success: '#34C759', // 그린 (완료/정상)
    danger: '#FF3B30', // 레드 (결석)
    background: '#F2F2F7', // 배경색
    cardBackground: '#FFFFFF', // 카드 배경색
    textPrimary: '#1C1C1E', // 기본 텍스트
    textSecondary: '#8E8E93', // 보조 텍스트
    border: '#C7C7CC', // 테두리
    modalBackground: 'rgba(0, 0, 0, 0.5)', // 모달 배경
  },
  fonts: {
    regular: 'System',
    bold: 'System-Bold',
  },
  spacing: {
    small: 8,
    medium: 16,
    large: 24,
  },
  borderRadius: {
    small: 8,
    medium: 12,
    large: 20,
  },
};

export type Theme = typeof theme;

/**
 * 화면 폭(pt) 기준 브레이크포인트.
 *
 * 기기 종류(Platform.isPad 등)가 아니라 "현재 창의 폭"으로 판정한다.
 * iPad는 Stage Manager와 Split View에서 창 크기가 임의로 바뀌기 때문에,
 * 기기로 판정하면 분할 화면에서 iPhone만 한 폭에 3열이 들어가는 문제가 생긴다.
 *
 * 참고 실측값 (pt)
 *   iPhone SE            375 x 667
 *   iPhone 16            393 x 852
 *   iPhone 16 Pro Max    440 x 956
 *   iPad Slide Over      320 (폭 고정)
 *   iPad Split View      507 / 678 / 1032 등 가변
 *   iPad Pro 13" 세로   1032 x 1376
 *   iPad Pro 13" 가로   1376 x 1032
 */
export const breakpoints = {
  /** 이 폭 미만은 1열 (모든 iPhone, iPad Slide Over) */
  medium: 700,
  /** 이 폭 이상은 3열 (iPad 11"/13" 가로) */
  expanded: 1100,
} as const;

export type SizeClass = 'compact' | 'medium' | 'expanded';

/** 사이즈 클래스별 레이아웃 토큰. useResponsive()가 이 표를 참조한다. */
export const layoutBySizeClass: Record<
  SizeClass,
  { columns: number; maxContentWidth: number; horizontalPadding: number }
> = {
  compact: { columns: 1, maxContentWidth: 560, horizontalPadding: 16 },
  medium: { columns: 2, maxContentWidth: 900, horizontalPadding: 24 },
  expanded: { columns: 3, maxContentWidth: 1400, horizontalPadding: 32 },
};
