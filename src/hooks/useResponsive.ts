import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { breakpoints, layoutBySizeClass, SizeClass } from '../constants/theme';

export interface Responsive {
  width: number;
  height: number;
  isLandscape: boolean;
  sizeClass: SizeClass;
  /** 카드 그리드 열 수 */
  columns: number;
  /** 콘텐츠 영역 최대 폭 (pt). 초광폭에서 줄 길이가 늘어지는 것을 막는다. */
  maxContentWidth: number;
  horizontalPadding: number;
}

/**
 * 현재 "창" 크기에 따른 레이아웃 값을 돌려준다.
 *
 * Dimensions.get()이 아니라 useWindowDimensions()를 쓰는 이유:
 * 전자는 값을 한 번 읽고 끝이라 회전이나 Stage Manager / Split View 리사이즈에
 * 반응하지 못한다. 후자는 창 크기가 바뀔 때마다 리렌더를 유발한다.
 */
export const useResponsive = (): Responsive => {
  const { width, height } = useWindowDimensions();

  return useMemo(() => {
    const sizeClass: SizeClass =
      width >= breakpoints.expanded
        ? 'expanded'
        : width >= breakpoints.medium
          ? 'medium'
          : 'compact';

    return {
      width,
      height,
      isLandscape: width > height,
      sizeClass,
      ...layoutBySizeClass[sizeClass],
    };
  }, [width, height]);
};
