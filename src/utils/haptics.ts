import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * 손끝에 오는 확인.
 *
 * **아이패드에는 진동 모터(Taptic Engine)가 없다.** UIKit의 피드백 생성기를 불러도
 * 아무 일도 일어나지 않고, 에러도 나지 않는다. 그래서 아이패드에서의 조작감은 전부
 * 화면의 움직임(PressableScale, hooks/useMotion)이 맡고, 이 파일은 아이폰에서만
 * 보탬이 된다. 부르는 쪽은 기기를 가리지 않고 불러도 된다.
 *
 * 무엇에 쓰는가:
 *   select  — 고르는 것이 바뀜 (탭, 요일 칩, 세그먼트, 달 넘기기)
 *   tap     — 가벼운 누름 (PIN 숫자)
 *   success — 기록이 남음 (등원, 하원, 잠금 해제)
 *   warning — 되돌리기 번거로운 기록이 남음 (결석)
 *   error   — 실패 (PIN 틀림, 저장 실패)
 *
 * 모든 누름에 붙이지 않는다. 다 떨리면 아무것도 전하지 못한다.
 */
export type HapticKind = 'select' | 'tap' | 'success' | 'warning' | 'error';

/**
 * 안드로이드는 Vibrator 대신 시스템 햅틱 상수를 쓴다. 패키지 문서가 권하는
 * 쪽이고, 모터를 직접 돌리는 것보다 기기마다 고르게 느껴진다.
 */
const ANDROID: Record<HapticKind, Haptics.AndroidHaptics> = {
  select: Haptics.AndroidHaptics.Segment_Tick,
  tap: Haptics.AndroidHaptics.Virtual_Key,
  success: Haptics.AndroidHaptics.Confirm,
  warning: Haptics.AndroidHaptics.Long_Press,
  error: Haptics.AndroidHaptics.Reject,
};

const fire = (kind: HapticKind): Promise<void> => {
  if (Platform.OS === 'android') return Haptics.performAndroidHapticsAsync(ANDROID[kind]);

  switch (kind) {
    case 'select':
      return Haptics.selectionAsync();
    case 'tap':
      return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    case 'success':
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    case 'warning':
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    case 'error':
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }
};

/**
 * 기다리지 않는다. 누름 처리 도중에 불리므로, 진동이 끝나기를 기다리거나 실패가
 * 새어 나가면 정작 기록하는 일이 늦어지거나 멈춘다.
 *
 * 웹은 건너뛴다. 이 앱의 웹은 미리보기 도구일 뿐이고, 패키지의 웹 구현은 iOS
 * 사파리에서 문서에 숨은 스위치를 만들어 눌러 보는 우회로라 굳이 태울 이유가 없다.
 */
export const haptic = (kind: HapticKind): void => {
  if (Platform.OS === 'web') return;
  fire(kind).catch(() => {});
};
