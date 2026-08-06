import React from 'react';
import styled from 'styled-components/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsive } from '../../hooks/useResponsive';

const Root = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const Inner = styled.View<{ $maxWidth: number; $paddingH: number; $paddingTop: number }>`
  flex: 1;
  width: 100%;
  max-width: ${({ $maxWidth }) => $maxWidth}px;
  align-self: center;
  padding-top: ${({ $paddingTop }) => $paddingTop}px;
  padding-left: ${({ $paddingH }) => $paddingH}px;
  padding-right: ${({ $paddingH }) => $paddingH}px;
`;

/**
 * 모든 탭 화면이 공유하는 셸.
 *
 * - 콘텐츠를 화면 가운데 정렬하고 최대 폭을 제한한다. iPad Pro 13" 가로처럼
 *   폭이 1376pt인 화면에서 한 줄이 지나치게 길어지는 것을 막는다.
 * - 좌우 패딩은 사이즈 클래스 값과 세이프에어리어 중 큰 쪽을 쓴다.
 */
const Screen: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const insets = useSafeAreaInsets();
  const { maxContentWidth, horizontalPadding } = useResponsive();

  return (
    <Root>
      <Inner
        $maxWidth={maxContentWidth}
        $paddingH={Math.max(horizontalPadding, insets.left, insets.right)}
        $paddingTop={insets.top + 16}
      >
        {children}
      </Inner>
    </Root>
  );
};

export default Screen;
