import { Alert, Platform } from 'react-native';

/**
 * 확인/알림 대화상자.
 *
 * react-native-web의 Alert는 `static alert() {}` 인 빈 스텁이라,
 * 웹에서는 Alert.alert로 감싼 동작이 아무 반응 없이 사라진다.
 * 웹을 미리보기 수단으로 쓰는 이상 그쪽도 실제로 동작해야 하므로
 * 플랫폼별로 갈라 준다.
 */

interface ConfirmOptions {
  title: string;
  message?: string;
  /** 확인 버튼 문구 */
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}

export const confirm = ({
  title,
  message,
  confirmLabel = '확인',
  destructive = false,
  onConfirm,
}: ConfirmOptions) => {
  if (Platform.OS === 'web') {
    const text = message ? `${title}\n\n${message}` : title;
    // eslint-disable-next-line no-alert
    if (typeof window !== 'undefined' && window.confirm(text)) onConfirm();
    return;
  }

  Alert.alert(title, message, [
    { text: '취소', style: 'cancel' },
    { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
};

export const notify = (title: string, message?: string) => {
  if (Platform.OS === 'web') {
    const text = message ? `${title}\n\n${message}` : title;
    // eslint-disable-next-line no-alert
    if (typeof window !== 'undefined') window.alert(text);
    return;
  }

  Alert.alert(title, message);
};
