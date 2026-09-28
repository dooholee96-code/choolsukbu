import { useCallback, useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Platform } from 'react-native';

/**
 * 화면이 손가락에 답하는 방식.
 *
 * 아이패드에는 진동이 없어서(utils/haptics 참고) '눌렸다'는 확인은 전부 여기서
 * 나온다. 그래서 규칙은 하나다 — **누른 순간 바로, 손을 떼면 살짝 튕기며 돌아온다.**
 * 기록이 끝나기를 기다렸다 움직이면 그 몇십 밀리초가 그대로 굼뜸으로 느껴진다.
 */

/**
 * 네이티브에서는 UI 스레드에서 돈다. 목록을 그리느라 JS가 바쁜 순간에도 누름이
 * 끊기지 않는 이유다. 웹에는 그 모듈이 없어서 켜 두면 경고만 쌓인다.
 */
export const NATIVE_DRIVER = Platform.OS !== 'web';

/**
 * 스프링 값. ζ(감쇠비) = damping / (2·√(stiffness·mass)).
 *
 *   press   ζ≈0.79  눌림은 빠르고 거의 넘치지 않는다. 손가락을 바로 따라와야 한다.
 *   release ζ≈0.45  놓으면 목표를 20% 남짓 넘었다 돌아온다. '쫀득'한 것은 이 되튐이다.
 *   pop     ζ≈0.40  자리를 옮겨 온 카드, 바뀐 숫자. 조금 더 탄다.
 *
 * 되튐까지 딱 멈추면 딱딱하고, 눌림까지 출렁이면 흐물거린다.
 */
export const SPRING = {
  press: { stiffness: 700, damping: 42, mass: 1 },
  release: { stiffness: 320, damping: 16, mass: 1 },
  pop: { stiffness: 260, damping: 13, mass: 1 },
} as const;

/**
 * iOS의 '동작 줄이기'. 켜 둔 사람에게는 튕김·흔들기·튀어나오기를 하지 않는다.
 * 누름은 남긴다 — 눌렸다는 확인까지 없애면 그건 접근성이 아니라 고장이다.
 *
 * 애니메이션을 시작할 때마다 물어볼 수는 없으므로(비동기다) 값을 들고 있는다.
 */
let reduceMotion = false;

try {
  AccessibilityInfo.isReduceMotionEnabled().then(
    (enabled) => {
      reduceMotion = enabled;
    },
    () => {}
  );
  AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
    reduceMotion = enabled;
  });
} catch {
  // 지원하지 않는 환경이면 보통 동작으로 둔다.
}

export const motionReduced = () => reduceMotion;

/**
 * 렌더가 몇 번이 돌든 같은 Animated.Value.
 *
 * react-native의 useAnimatedValue를 쓰지 않는 이유: react-native-web 0.21에는
 * 그 export가 없어서 웹 미리보기에서 undefined를 부르다 죽는다. useRef(new ...)는
 * 렌더마다 버릴 값을 새로 만든다.
 */
export const useAnimatedNumber = (initial: number): Animated.Value => {
  const ref = useRef<Animated.Value | null>(null);
  if (ref.current === null) ref.current = new Animated.Value(initial);
  return ref.current;
};

/** from에서 1로 튕기며 돌아온다. 동작 줄이기가 켜져 있으면 제자리에 둔다. */
export const popFrom = (value: Animated.Value, from: number) => {
  if (reduceMotion) {
    value.setValue(1);
    return;
  }
  value.setValue(from);
  Animated.spring(value, { toValue: 1, useNativeDriver: NATIVE_DRIVER, ...SPRING.pop }).start();
};

/**
 * pulse가 바뀔 때마다 한 번 톡 튄다. 등원·결석·하원처럼 방금 손댄 카드에 쓴다.
 *
 * 처음 그려질 때도 pulse가 있으면 튄다. 등원을 찍으면 카드가 '등원 예정'에서
 * '등원 완료'로 옮겨 가며 **새로 그려지기** 때문이다. 이때 1에서 시작했다가 줄어들면
 * 한 프레임 번쩍이므로, 시작 값부터 줄어든 채로 만든다.
 */
export const usePop = (pulse: number | undefined, from = 0.94): Animated.Value => {
  const scale = useAnimatedNumber(pulse && !reduceMotion ? from : 1);
  const seen = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!pulse || seen.current === pulse) return;
    seen.current = pulse;

    popFrom(scale, from);
  }, [pulse, from, scale]);

  return scale;
};

/**
 * 값이 바뀌면 살짝 부풀었다 돌아온다. 오늘 등원 수 같은 숫자에 쓴다.
 * 처음 그릴 때는 가만히 있다 — 화면을 열 때마다 숫자가 튀면 아무것도 알려주지 않는다.
 */
export const useBump = (value: unknown, to = 1.12): Animated.Value => {
  const scale = useAnimatedNumber(1);
  const previous = useRef(value);

  useEffect(() => {
    if (Object.is(previous.current, value)) return;
    previous.current = value;
    popFrom(scale, to);
  }, [value, to, scale]);

  return scale;
};

/**
 * 좌우로 짧게 흔든다. 틀렸다는 뜻이다 (PIN 오류).
 * 스프링이 아니라 정해진 순서로 움직인다 — 몇 번, 얼마나 흔들릴지가 매번 같아야 한다.
 */
export const useShake = (): [Animated.Value, () => void] => {
  const x = useAnimatedNumber(0);

  const shake = useCallback(() => {
    if (reduceMotion) return;

    const step = (toValue: number, duration: number) =>
      Animated.timing(x, { toValue, duration, useNativeDriver: NATIVE_DRIVER });

    x.setValue(0);
    Animated.sequence([
      step(-10, 45),
      step(10, 70),
      step(-7, 60),
      step(7, 55),
      step(-3, 45),
      step(0, 40),
    ]).start();
  }, [x]);

  return [x, shake];
};
