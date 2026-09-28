import React, { forwardRef, useCallback, useMemo } from 'react';
import {
  Animated,
  GestureResponderEvent,
  Pressable,
  PressableProps,
  StyleProp,
  View,
  ViewStyle,
} from 'react-native';
import { haptic as fireHaptic, HapticKind } from '../../utils/haptics';
import { motionReduced, NATIVE_DRIVER, SPRING, useAnimatedNumber } from '../../hooks/useMotion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressableScaleProps extends Omit<PressableProps, 'style' | 'children'> {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  /**
   * 눌렀을 때 줄어드는 비율. 넓은 카드는 조금만(0.98), 작은 버튼은 많이(0.9).
   * 같은 비율이면 큰 것이 훨씬 많은 픽셀을 움직여서, 크기에 반비례해야 똑같이 느껴진다.
   */
  pressScale?: number;
  /**
   * 눌렀을 때 함께 흐려지는 정도. 기본은 흐려지지 않는다.
   * 글자뿐인 작은 동작(결석·취소·하원)은 줄어드는 것만으로는 잘 안 보여서 쓴다.
   */
  pressOpacity?: number;
  /**
   * 손을 뗄 때 낼 햅틱. 기록이 성공했는지에 따라 달라지는 것(등원 성공, 저장 실패)은
   * 여기서 내면 안 된다 — 결과를 모르는 채로 성공이라고 알리게 된다.
   */
  haptic?: HapticKind;
}

/**
 * 누르면 쫀득하게 들어갔다 튕겨 나오는 버튼 껍데기.
 *
 * TouchableOpacity를 대신한다. 그쪽은 눌리면 흐려지기만 해서 화면이 손가락에 답하는
 * 느낌이 없다 — 특히 진동이 없는 아이패드에서는 그게 유일한 확인인데.
 *
 * 스타일과 크기 변화가 **한 뷰**에 붙는다. 바깥에 Pressable, 안에 Animated.View를
 * 따로 두면 flex·margin 같은 배치 속성을 둘 중 어디에 줄지 매번 갈라야 하고, 틀리면
 * 카드 높이가 무너진다(StudentCard의 flex-grow 참고). styled(PressableScale)로
 * 쓰면 styled-components가 준 style이 그대로 이 뷰에 붙는다.
 */
const PressableScale = forwardRef<View, PressableScaleProps>(function PressableScale(
  {
    style,
    children,
    pressScale = 0.96,
    pressOpacity = 1,
    haptic,
    onPressIn,
    onPressOut,
    onPress,
    ...rest
  },
  ref
) {
  const scale = useAnimatedNumber(1);

  // 흐려짐은 크기에서 뽑는다. 값이 하나라 둘이 어긋날 수 없고, 되튐으로 1을 넘을
  // 때는 clamp가 불투명도를 1에 묶어 둔다.
  //
  // 흐려지지 않는 버튼에는 opacity를 아예 넣지 않는다. 넣으면 부르는 쪽이 준
  // opacity(예: 숨겨 둔 자리)를 1로 덮어써 버린다.
  const motion = useMemo(
    () =>
      pressOpacity >= 1
        ? { transform: [{ scale }] }
        : {
            transform: [{ scale }],
            opacity: scale.interpolate({
              inputRange: [pressScale, 1],
              outputRange: [pressOpacity, 1],
              extrapolate: 'clamp',
            }),
          },
    [scale, pressScale, pressOpacity]
  );

  const handlePressIn = useCallback(
    (event: GestureResponderEvent) => {
      Animated.spring(scale, {
        toValue: pressScale,
        useNativeDriver: NATIVE_DRIVER,
        ...SPRING.press,
      }).start();
      onPressIn?.(event);
    },
    [scale, pressScale, onPressIn]
  );

  const handlePressOut = useCallback(
    (event: GestureResponderEvent) => {
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: NATIVE_DRIVER,
        // 동작 줄이기가 켜져 있으면 튕기지 않고 그냥 돌아온다.
        ...(motionReduced() ? SPRING.press : SPRING.release),
      }).start();
      onPressOut?.(event);
    },
    [scale, onPressOut]
  );

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      if (haptic) fireHaptic(haptic);
      onPress?.(event);
    },
    [haptic, onPress]
  );

  return (
    <AnimatedPressable
      ref={ref}
      {...rest}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      style={[style, motion]}
    >
      {children}
    </AnimatedPressable>
  );
});

export default PressableScale;
