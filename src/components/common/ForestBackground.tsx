import React, { useCallback, useEffect, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  StyleProp,
  StyleSheet,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useResponsive } from '../../hooks/useResponsive';
import { NATIVE_DRIVER, motionReduced, useAnimatedNumber } from '../../hooks/useMotion';

/**
 * Screen 콘텐츠 뒤에 깔리는 숲·호수 배경 + 호숫가 토끼 세 마리.
 *
 * pointerEvents="none"이 중요하다. 화면 전체를 덮는 레이어라 이게 없으면
 * 아래 카드의 탭이 전부 배경에 먹힌다.
 *
 * 세로 기준(390x844)으로 그리고 slice로 채운다. YMax로 아래를 앵커해 호수와
 * 언덕이 어느 비율에서든 화면에 남게 한다.
 *
 * 토끼는 배경 Svg와 따로 Animated.View로 얹는다. transform은 네이티브 드라이버로
 * UI 스레드에서 돌아 목록을 그리느라 JS가 바빠도 끊기지 않는다. 배경 전체를
 * View scale로 키우면 iPad에서 SVG가 래스터로 늘어나 흐려지므로, 각 조각을
 * 배율(s)만큼 직접 키워 그린다.
 *
 * 호수 파문만 rx/ry를 바꿔야 해서 JS 드라이버다. 3.2초에 한 번, 가벼운 타원 하나다.
 * '동작 줄이기'가 켜져 있으면 전부 멈춘 채로 둔다.
 *
 * 탭 네 개가 저마다 이 배경을 들고 있고, 한 번 연 탭은 뒤에서도 살아 있다. 그래서
 * **보이는 탭의 토끼만 움직인다.** 안 보이는 탭까지 돌리면 파문 넷이 매 프레임 JS를
 * 깨워, 등원을 누르는 손끝과 같은 스레드를 나눠 쓴다.
 *
 * 크기는 창이 아니라 이 배경이 실제로 깔린 자리(onLayout)로 잡는다. 탭 화면은 창에서
 * 탭바만큼 짧은데, 창 크기로 계산하면 Svg와 토끼 조각이 서로 다른 높이를 기준으로
 * 놓여 토끼가 언덕에서 뜬다.
 */

const VB_W = 390;
const VB_H = 844;

const C = {
  white: '#FFFDFB',
  lavender: '#E4DAEC',
  peach: '#F2DCC3',
  blush: '#EDCEDF',
  eye: '#4B3B53',
  shadow: '#CFE0CD',
};

type Box = { minX: number; minY: number; w: number; h: number };
type Frame = { s: number; offX: number; offY: number };

/* 원점(발밑)을 가로 가운데에 둔 박스. scaleX -1로 뒤집어도 제자리에서 돈다. */
const SIT_BOX: Box = { minX: -20, minY: -44, w: 40, h: 48 };
const HOP_BOX: Box = { minX: -26, minY: -28, w: 52, h: 38 };

const SitRabbit = ({ color, shadow = true }: { color: string; shadow?: boolean }) => (
  <>
    {shadow && <Ellipse cx={3} cy={0} rx={13} ry={2.4} fill={C.shadow} />}
    <Ellipse cx={0} cy={-10} rx={12} ry={10} fill={color} />
    <Circle cx={-11} cy={-9} r={4} fill={C.white} />
    <Ellipse cx={6} cy={-33} rx={2.8} ry={8.5} transform="rotate(-12 6 -33)" fill={color} />
    <Ellipse cx={11.5} cy={-32} rx={2.8} ry={8.5} transform="rotate(12 11.5 -32)" fill={color} />
    <Ellipse cx={11.5} cy={-32} rx={1.2} ry={5.5} transform="rotate(12 11.5 -32)" fill={C.blush} />
    <Circle cx={9} cy={-20} r={7.5} fill={color} />
    <Circle cx={12.5} cy={-21} r={1.1} fill={C.eye} />
    <Circle cx={13.5} cy={-17} r={1.7} fill={C.blush} />
    <Ellipse cx={6} cy={-1.5} rx={5} ry={2} fill={color} />
  </>
);

const HopRabbit = ({ color }: { color: string }) => (
  <>
    <Ellipse cx={-13} cy={4} rx={7.5} ry={2.6} transform="rotate(25 -13 4)" fill={color} />
    <Ellipse cx={0} cy={0} rx={14} ry={8.5} transform="rotate(-18)" fill={color} />
    <Circle cx={-13} cy={1} r={4} fill={C.white} />
    <Ellipse cx={12} cy={6} rx={4.5} ry={2} transform="rotate(-30 12 6)" fill={color} />
    <Ellipse cx={3} cy={-17} rx={2.8} ry={8.5} transform="rotate(-62 3 -17)" fill={color} />
    <Ellipse cx={6} cy={-13} rx={2.8} ry={8} transform="rotate(-72 6 -13)" fill={color} />
    <Ellipse cx={6} cy={-13} rx={1.2} ry={5} transform="rotate(-72 6 -13)" fill={C.blush} />
    <Circle cx={13} cy={-9} r={7.5} fill={color} />
    <Circle cx={16.5} cy={-10} r={1.1} fill={C.eye} />
    <Circle cx={17.5} cy={-6} r={1.7} fill={C.blush} />
  </>
);

/** 장면 좌표 (ox, oy)에 배율 k로 놓이는 작은 Svg 조각. */
const Sprite: React.FC<{
  frame: Frame;
  ox: number;
  oy: number;
  k?: number;
  box: Box;
  style?: Animated.WithAnimatedValue<StyleProp<ViewStyle>>;
  children: React.ReactNode;
}> = ({ frame, ox, oy, k = 1, box, style, children }) => {
  const { s, offX, offY } = frame;
  const w = box.w * k * s;
  const h = box.h * k * s;
  return (
    <Animated.View
      style={[
        { position: 'absolute', left: offX + (ox + box.minX * k) * s, top: offY + (oy + box.minY * k) * s, width: w, height: h },
        style,
      ]}
    >
      <Svg width={w} height={h} viewBox={`${box.minX} ${box.minY} ${box.w} ${box.h}`}>
        {children}
      </Svg>
    </Animated.View>
  );
};

const shadowBox = (rx: number, ry: number): Box => ({ minX: -rx, minY: -ry, w: rx * 2, h: ry * 2 });

/** 0→1을 duration마다 반복. 키프레임은 interpolate로 이 값에 건다. */
const useLoop = (duration: number, active: boolean, native = NATIVE_DRIVER) => {
  const t = useAnimatedNumber(0);
  useEffect(() => {
    // 멈출 때는 그 자리에 선다. 0으로 되돌리면 탭을 오갈 때마다 토끼가 순간이동한다.
    if (!active || motionReduced()) return;
    const anim = Animated.loop(
      Animated.timing(t, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: native })
    );
    anim.start();
    return () => anim.stop();
  }, [t, duration, active, native]);
  return t;
};

const at = (t: Animated.Value, inputRange: number[], outputRange: number[]) =>
  t.interpolate({ inputRange, outputRange });

/* 살구 토끼 — 9초. 오른쪽으로 네 번 깡충, 쉬고, 돌아서 네 번, 쉰다. */
const HOP_K = [0, 0.04, 0.08, 0.1, 0.14, 0.18, 0.2, 0.24, 0.28, 0.3, 0.34, 0.38, 0.5, 0.54, 0.58, 0.6, 0.64, 0.68, 0.7, 0.74, 0.78, 0.8, 0.84, 0.88, 1];
const HOP_X = [0, 12.5, 25, 25, 37.5, 50, 50, 62.5, 75, 75, 87.5, 100, 100, 87.5, 75, 75, 62.5, 50, 50, 37.5, 25, 25, 12.5, 0, 0];
const IS_APEX = HOP_K.map((_, i) => i % 3 === 1 && i < 24);

/* 흰 토끼 — 7초. 제자리에서 두 번 깡충. */
const WHITE_K = [0, 0.55, 0.61, 0.67, 0.7, 0.76, 0.82, 1];
const WHITE_Y = [0, 0, -12, 0, 0, -12, 0, 0];

/* 보라 토끼 — 8초. 두 번 들썩이고, 그 사이 잠깐 뒤돌아본다. */
const LAV_K = [0, 0.2, 0.24, 0.28, 0.6, 0.64, 0.68, 1];
const LAV_Y = [0, 0, -2, 0, 0, -2, 0, 0];

const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);

const ForestBackground: React.FC = () => {
  const window = useWindowDimensions();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const { width, height } = size ?? window;
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width: w, height: h } = event.nativeEvent.layout;
    setSize((prev) => (prev && prev.width === w && prev.height === h ? prev : { width: w, height: h }));
  }, []);

  const { sizeClass } = useResponsive();
  const active = useIsFocused();

  /*
   * 시안은 폰 화면(390pt) 기준이라 요소들이 작게 들어간다. iPad 가로에서는
   * 폭에 맞추느라 3.5배로 커지면서 같은 불투명도가 훨씬 무겁게 읽히고
   * 카드보다 배경이 눈에 먼저 들어온다. 넓은 창에서만 톤을 낮춘다.
   */
  const decorOpacity = sizeClass === 'compact' ? 1 : 0.5;

  /* xMidYMax slice와 같은 계산. 조각들을 배경과 같은 자리에 놓기 위해 직접 구한다. */
  const s = Math.max(width / VB_W, height / VB_H);
  const frame: Frame = { s, offX: (width - VB_W * s) / 2, offY: height - VB_H * s };

  const hop = useLoop(9000, active);
  const white = useLoop(7000, active);
  const lav = useLoop(8000, active);
  const ripple = useLoop(3200, active, false);

  const hopX = at(hop, HOP_K, HOP_X.map((x) => x * s));
  const hopY = at(hop, HOP_K, IS_APEX.map((a) => (a ? -22 * s : 0)));
  const hopShadow = at(hop, HOP_K, IS_APEX.map((a) => (a ? 7 / 11 : 1)));
  const hopFlip = at(hop, [0, 0.4999, 0.5, 1], [1, 1, -1, -1]);

  const whiteY = at(white, WHITE_K, WHITE_Y.map((y) => y * s));
  const whiteShadow = at(white, WHITE_K, WHITE_Y.map((y) => (y ? 9 / 14 : 1)));

  const lavY = at(lav, LAV_K, LAV_Y.map((y) => y * s));
  const lavFlip = at(lav, [0, 0.3999, 0.4, 0.5999, 0.6, 1], [-1, -1, 1, 1, -1, -1]);

  return (
    <View
      style={[StyleSheet.absoluteFill, { opacity: decorOpacity }]}
      pointerEvents="none"
      onLayout={onLayout}
    >
      <Svg
        style={StyleSheet.absoluteFill}
        width={width}
        height={height}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMax slice"
      >
        <Defs>
          <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#EDF3F1" />
            <Stop offset="0.45" stopColor="#F6F2EC" />
            <Stop offset="1" stopColor="#F1F5F1" />
          </LinearGradient>
        </Defs>
        <Rect width={VB_W} height={VB_H} fill="url(#sky)" />
        <Circle cx={330} cy={70} r={16} fill="#FBEFCB" />
        <Path d="M0 700 Q110 656 214 694 T390 668 L390 844 L0 844 Z" fill="#DEEEDC" />
        <Ellipse cx={195} cy={790} rx={185} ry={48} fill="#CCE4EE" />
        <Ellipse cx={195} cy={782} rx={132} ry={26} fill="#E0F0F6" />
        <Circle cx={34} cy={606} r={44} fill="#EDCEDF" opacity={0.8} />
        <Circle cx={80} cy={632} r={28} fill="#EDCEDF" opacity={0.8} />
        <Circle cx={358} cy={592} r={38} fill="#D9D0EE" opacity={0.8} />
        <Circle cx={322} cy={618} r={24} fill="#D9D0EE" opacity={0.8} />
        <AnimatedEllipse
          cx={195}
          cy={788}
          rx={at(ripple, [0, 1], [10, 60])}
          ry={at(ripple, [0, 1], [2.5, 12])}
          opacity={at(ripple, [0, 1], [0.9, 0])}
          fill="none"
          stroke={C.white}
          strokeWidth={1}
        />
      </Svg>

      {/* 흰 토끼 — 그림자는 땅에 남고 몸만 뜬다 */}
      <Sprite frame={frame} ox={61.3} oy={744} box={shadowBox(14, 2.6)} style={{ transform: [{ scaleX: whiteShadow }] }}>
        <Ellipse cx={0} cy={0} rx={14} ry={2.6} fill={C.shadow} />
      </Sprite>
      <Sprite frame={frame} ox={58} oy={744} k={1.1} box={SIT_BOX} style={{ transform: [{ translateY: whiteY }] }}>
        <SitRabbit color={C.white} shadow={false} />
      </Sprite>

      {/* 보라 토끼 — 기본은 왼쪽을 본다 */}
      <Sprite frame={frame} ox={336} oy={734} k={1.05} box={SIT_BOX} style={{ transform: [{ translateY: lavY }, { scaleX: lavFlip }] }}>
        <SitRabbit color={C.lavender} />
      </Sprite>

      {/* 살구 토끼 — 언덕 왕복 */}
      <Sprite frame={frame} ox={149} oy={716} box={shadowBox(11, 2)} style={{ transform: [{ translateX: hopX }, { scaleX: hopShadow }] }}>
        <Ellipse cx={0} cy={0} rx={11} ry={2} fill={C.shadow} />
      </Sprite>
      <Sprite
        frame={frame}
        ox={145}
        oy={706}
        k={1.1}
        box={HOP_BOX}
        style={{ transform: [{ translateX: hopX }, { translateY: hopY }, { scaleX: hopFlip }] }}
      >
        <HopRabbit color={C.peach} />
      </Sprite>
    </View>
  );
};

/**
 * 받는 값이 없으니 크기나 탭 포커스가 바뀔 때만 다시 그리면 된다. 애니메이션은
 * Animated 값이 직접 움직이므로 리렌더를 일으키지 않는다.
 */
export default React.memo(ForestBackground);
