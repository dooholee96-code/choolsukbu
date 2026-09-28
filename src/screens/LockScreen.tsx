import React, { useCallback, useEffect, useState } from 'react';
import { Animated } from 'react-native';
import styled from 'styled-components/native';
import { Ionicons } from '@expo/vector-icons';
import { authenticateWithBiometrics, hasBiometrics, verifyPin } from '../security/lock';
import ForestBackground from '../components/common/ForestBackground';
import PressableScale from '../components/common/PressableScale';
import { usePopOnRise, useShake } from '../hooks/useMotion';
import { haptic } from '../utils/haptics';

export const PIN_LENGTH = 4;

const Root = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
  align-items: center;
  justify-content: center;
  padding: ${({ theme }) => theme.spacing.large}px;
`;

const Title = styled.Text`
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 22px;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-top: ${({ theme }) => theme.spacing.medium}px;
`;

const Hint = styled.Text<{ $error: boolean }>`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 14px;
  color: ${({ theme, $error }) =>
    $error ? theme.colors.dangerStrong : theme.colors.textSecondary};
  margin-top: 8px;
  height: 20px;
`;

const Dots = styled.View`
  flex-direction: row;
  gap: 16px;
  margin: ${({ theme }) => theme.spacing.large}px 0;
`;

const Dot = styled.View<{ $filled: boolean }>`
  width: 14px;
  height: 14px;
  border-radius: 7px;
  border-width: 1.5px;
  border-color: ${({ theme }) => theme.colors.primaryStrong};
  background-color: ${({ theme, $filled }) =>
    $filled ? theme.colors.primaryStrong : 'transparent'};
`;

const Pad = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  width: 260px;
  justify-content: center;
  gap: 12px;
`;

/* 숫자판. 전화기 키패드처럼 누를 때마다 쑥 들어가야 몇 번 눌렀는지 손이 안다. */
const Key = styled(PressableScale).attrs({ pressScale: 0.88, haptic: 'tap' as const })`
  width: 74px;
  height: 62px;
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  background-color: ${({ theme }) => theme.colors.cardBackground};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  align-items: center;
  justify-content: center;
`;

const KeyText = styled.Text`
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 22px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const BiometricButton = styled(PressableScale).attrs({ pressScale: 0.95 })`
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin-top: ${({ theme }) => theme.spacing.large}px;
  padding: 12px 20px;
`;

const BiometricLabel = styled.Text`
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 15px;
  color: ${({ theme }) => theme.colors.primaryStrong};
`;

/** 빈 칸. 0을 가운데 두려고 자리만 차지한다. 누를 것이 아니므로 버튼이 아니다. */
const KeySpacer = styled.View`
  width: 74px;
  height: 62px;
`;

/**
 * 점 하나. 채워지는 순간 톡 튀어나온다 — 화면을 보지 않고 쳐도 몇 자리 들어갔는지
 * 곁눈으로 잡힌다.
 */
const PinDot: React.FC<{ filled: boolean }> = ({ filled }) => {
  const scale = usePopOnRise(filled, 0.4);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Dot $filled={filled} />
    </Animated.View>
  );
};

interface Props {
  onUnlock: () => void;
  /**
   * 손으로 잠근 것이면 얼굴 인식을 자동으로 띄우지 않는다. 화면 앞에 있던
   * 원장선생님 얼굴로 그대로 열려서, 건네주기 직전에 잠근 의미가 사라진다.
   */
  autoPrompt: boolean;
}

const LockScreen: React.FC<Props> = ({ onUnlock, autoPrompt }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [biometricsReady, setBiometricsReady] = useState(false);
  // 틀리면 점 줄이 고개를 젓는다. 글자만 바뀌면 PIN을 치느라 숫자판을 보고 있던
  // 눈에는 안 들어온다.
  const [shakeX, shake] = useShake();

  const tryBiometrics = useCallback(async () => {
    if (await authenticateWithBiometrics()) {
      haptic('success');
      onUnlock();
    }
  }, [onUnlock]);

  // 앱을 열거나 자리를 비웠다 돌아온 경우에만 자동으로 물어본다.
  useEffect(() => {
    (async () => {
      const available = await hasBiometrics();
      setBiometricsReady(available);
      if (available && autoPrompt) await tryBiometrics();
    })();
    // 마운트 때 한 번만. autoPrompt는 이 화면이 사는 동안 바뀌지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const press = useCallback(
    async (digit: string) => {
      // 확인 중에 또 누르면 낡은 pin 위에 자리가 붙어 엉뚱한 값이 올라간다.
      if (checking || pin.length >= PIN_LENGTH) return;

      setError(false);
      const next = pin + digit;
      // 마지막 자리도 먼저 채운다. 확인이 끝난 뒤에 넣으면 네 번째 점이 아예 안 찬다.
      setPin(next);
      if (next.length < PIN_LENGTH) return;

      setChecking(true);
      try {
        if (await verifyPin(next)) {
          haptic('success');
          setPin('');
          onUnlock();
          return;
        }
        // 틀리면 즉시 비운다. 지우고 다시 치게 하면 손이 한 번 더 간다.
        haptic('error');
        shake();
        setPin('');
        setError(true);
      } finally {
        setChecking(false);
      }
    },
    [pin, checking, onUnlock, shake]
  );

  const back = useCallback(() => {
    if (checking) return;
    setError(false);
    setPin((current) => current.slice(0, -1));
  }, [checking]);

  return (
    <Root>
      <ForestBackground />
      <Ionicons name="lock-closed-outline" size={40} />
      <Title>출석부</Title>
      <Hint $error={error}>{error ? 'PIN이 맞지 않습니다' : 'PIN을 입력하세요'}</Hint>

      <Animated.View style={{ transform: [{ translateX: shakeX }] }}>
        <Dots>
          {Array.from({ length: PIN_LENGTH }, (_, index) => (
            <PinDot key={index} filled={index < pin.length} />
          ))}
        </Dots>
      </Animated.View>

      <Pad>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <Key
            key={digit}
            onPress={() => press(digit)}
            accessibilityRole="button"
            accessibilityLabel={digit}
          >
            <KeyText>{digit}</KeyText>
          </Key>
        ))}
        <KeySpacer />
        <Key onPress={() => press('0')} accessibilityRole="button" accessibilityLabel="0">
          <KeyText>0</KeyText>
        </Key>
        <Key onPress={back} accessibilityRole="button" accessibilityLabel="지우기">
          <Ionicons name="backspace-outline" size={22} />
        </Key>
      </Pad>

      {biometricsReady && (
        <BiometricButton
          onPress={tryBiometrics}
          accessibilityRole="button"
          accessibilityLabel="생체 인증으로 열기"
        >
          <Ionicons name="scan-outline" size={18} />
          <BiometricLabel>Face ID / Touch ID로 열기</BiometricLabel>
        </BiometricButton>
      )}
    </Root>
  );
};

export default LockScreen;
