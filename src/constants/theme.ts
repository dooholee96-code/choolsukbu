export const theme = {
  colors: {
    /* 숲속 테마 시안 지정값. 면(surface)과 틴트에 쓴다. */
    primary: '#6FAEC6', // 호수 블루
    secondary: '#E8B27A', // 예외 등원
    success: '#7FBFA1', // 출석
    danger: '#D98A96', // 결석
    background: '#F6F2EC', // 크림
    cardBackground: '#FFFDFB',
    textPrimary: '#4B3B53',
    textSecondary: '#9B8AA3',
    border: '#E7DEE6',
    modalBackground: 'rgba(75, 59, 83, 0.45)',

    /*
     * 글씨가 얹히는 자리 전용. 색조는 위와 같고 명도만 낮췄다.
     *
     * 파스텔 원색 위의 흰 글씨는 WCAG AA(4.5:1)에 크게 못 미친다.
     * 측정값: primary 2.46:1, secondary 1.90:1, success 2.10:1.
     * 버튼 라벨과 상태 태그 글씨가 이 조합이라 그대로 두면 읽기 어렵다.
     * 아래 값은 흰 글씨 기준 4.5:1 이상, 카드 배경 위 글씨로도 4.45:1 이상이다.
     */
    primaryStrong: '#4F7C8D',
    secondaryStrong: '#92704D',
    successStrong: '#547E6A',
    dangerStrong: '#A1666F',
  },
  fonts: {
    regular: 'GowunDodum',
    bold: 'GowunBatang-Bold',
  },
  spacing: {
    small: 8,
    medium: 16,
    large: 24,
  },
  borderRadius: {
    small: 14,
    medium: 20,
    large: 28,
  },
};

export type Theme = typeof theme;

/**
 * 폰트 로딩이 실패했을 때 쓰는 대체 테마.
 *
 * styled 템플릿이 theme.fonts.regular를 font-family로 그대로 넘기므로,
 * 로드되지 않은 이름이 남아 있으면 네이티브에서 글꼴을 찾지 못한다.
 * 실패 시 시스템 글꼴로 갈아끼워 최소한 글자는 보이게 한다.
 */
export const systemFontTheme: Theme = {
  ...theme,
  fonts: { regular: 'System', bold: 'System' },
};

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
