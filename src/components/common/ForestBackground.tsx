import React from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { useResponsive } from '../../hooks/useResponsive';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/**
 * Screen 콘텐츠 뒤에 깔리는 숲·호수 배경.
 *
 * pointerEvents="none"이 중요하다. 화면 전체를 덮는 레이어라 이게 없으면
 * 아래 카드의 탭이 전부 배경에 먹힌다.
 *
 * 세로 기준(390x844)으로 그리고 slice로 채운다. iPad 가로(1376x1032)에서는
 * 폭에 맞추느라 3.5배가 확대되어 세로가 크게 잘리는데, 기본값인 YMid로 두면
 * 잘려 나가는 쪽이 하필 그림이 전부 몰려 있는 아래쪽이라 하늘 그라데이션만
 * 남는다. YMax로 아래를 앵커해 호수와 언덕이 어느 비율에서든 화면에 남게 한다.
 */
const ForestBackground: React.FC = () => {
  const { width, height } = useWindowDimensions();
  const { sizeClass } = useResponsive();

  /*
   * 시안은 폰 화면(390pt) 기준이라 요소들이 작게 들어간다. iPad 가로에서는
   * 폭에 맞추느라 3.5배로 커지면서 같은 불투명도가 훨씬 무겁게 읽히고
   * 카드보다 배경이 눈에 먼저 들어온다. 넓은 창에서만 톤을 낮춘다.
   */
  const decorOpacity = sizeClass === 'compact' ? 1 : 0.5;

  return (
    <Svg
      style={[StyleSheet.absoluteFill, { opacity: decorOpacity }]}
      pointerEvents="none"
      width={width}
      height={height}
      viewBox="0 0 390 844"
      preserveAspectRatio="xMidYMax slice"
    >
      <Defs>
        <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#EDF3F1" />
          <Stop offset="0.45" stopColor="#F6F2EC" />
          <Stop offset="1" stopColor="#F1F5F1" />
        </LinearGradient>
      </Defs>
      <Rect width={390} height={844} fill="url(#sky)" />
      <Circle cx={330} cy={70} r={16} fill="#FBEFCB" />
      <Path d="M0 700 Q110 656 214 694 T390 668 L390 844 L0 844 Z" fill="#DEEEDC" />
      <Ellipse cx={195} cy={790} rx={185} ry={48} fill="#CCE4EE" />
      <Ellipse cx={195} cy={782} rx={132} ry={26} fill="#E0F0F6" />
      <Circle cx={34} cy={606} r={44} fill="#EDCEDF" opacity={0.8} />
      <Circle cx={80} cy={632} r={28} fill="#EDCEDF" opacity={0.8} />
      <Circle cx={358} cy={592} r={38} fill="#D9D0EE" opacity={0.8} />
      <Circle cx={322} cy={618} r={24} fill="#D9D0EE" opacity={0.8} />
    </Svg>
  );
};

export default ForestBackground;
