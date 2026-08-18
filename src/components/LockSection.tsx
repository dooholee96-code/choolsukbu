import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components/native';
import { View } from 'react-native';
import Button from './common/Button';
import { PIN_LENGTH } from '../screens/LockScreen';
import {
  clearPin,
  hasBiometrics,
  isLockEnabled,
  isLockSupported,
  setPin,
} from '../security/lock';
import { confirm, notify } from '../utils/dialog';
import { logger } from '../utils/logger';

const SectionTitle = styled.Text`
  font-size: 15px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-top: ${({ theme }) => theme.spacing.large}px;
  margin-bottom: 6px;
`;

const Note = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 13px;
  line-height: 19px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: ${({ theme }) => theme.spacing.small}px;
`;

const PinInput = styled.TextInput`
  background-color: ${({ theme }) => theme.colors.cardBackground};
  padding: ${({ theme }) => theme.spacing.medium}px;
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 20px;
  letter-spacing: 8px;
  text-align: center;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-bottom: 10px;
`;

interface Props {
  /** 잠금 설정이 바뀌었을 때. App이 상태를 다시 읽는다. */
  onChanged: () => void;
}

/**
 * 앱 잠금 설정.
 *
 * 막으려는 것은 침입자가 아니라 수업 중에 아이패드를 만지는 아이들이다.
 * 그래서 PIN은 네 자리면 충분하고, 얼굴 인식이 되는 기기에서는 그쪽이 먼저 뜬다.
 */
const LockSection: React.FC<Props> = ({ onChanged }) => {
  const [supported, setSupported] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [biometrics, setBiometrics] = useState(false);
  const [entering, setEntering] = useState(false);
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const usable = await isLockSupported();
    setSupported(usable);
    if (!usable) return;

    setEnabled(await isLockEnabled());
    setBiometrics(await hasBiometrics());
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const cancel = useCallback(() => {
    setEntering(false);
    setFirst('');
    setSecond('');
  }, []);

  const save = useCallback(async () => {
    if (first.length !== PIN_LENGTH) {
      notify('PIN 확인', `숫자 ${PIN_LENGTH}자리로 정해 주세요.`);
      return;
    }
    if (first !== second) {
      notify('PIN 확인', '두 번 입력한 값이 다릅니다.');
      return;
    }

    setBusy(true);
    try {
      await setPin(first);
      cancel();
      await reload();
      onChanged();
      notify('잠금을 켰습니다', '앱을 다시 열거나 [오늘] 화면의 자물쇠를 누르면 잠깁니다.');
    } catch (error) {
      logger.error('Failed to set pin', error);
      notify('설정 실패', 'PIN을 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }, [first, second, cancel, reload, onChanged]);

  const disable = useCallback(() => {
    confirm({
      title: '잠금 끄기',
      message: '앱을 열 때 PIN을 묻지 않습니다.',
      confirmLabel: '끄기',
      destructive: true,
      onConfirm: async () => {
        try {
          await clearPin();
          await reload();
          onChanged();
        } catch (error) {
          logger.error('Failed to clear pin', error);
          notify('해제 실패', '잠금을 끄지 못했습니다.');
        }
      },
    });
  }, [reload, onChanged]);

  return (
    <>
      <SectionTitle>앱 잠금</SectionTitle>

      {!supported ? (
        <Note>앱 잠금은 iPhone·iPad에서만 쓸 수 있습니다.</Note>
      ) : enabled ? (
        <>
          <Note>
            켜져 있습니다.
            {biometrics ? ' Face ID · Touch ID로도 열 수 있습니다.' : ''}
            {'\n'}수업용으로 아이패드를 건네주기 전에는 [오늘] 화면의 자물쇠를 누르세요.
          </Note>
          <Button title="잠금 끄기" variant="secondary" onPress={disable} disabled={busy} />
        </>
      ) : entering ? (
        <>
          <Note>숫자 {PIN_LENGTH}자리를 두 번 입력하세요.</Note>
          <PinInput
            value={first}
            onChangeText={(text) => setFirst(text.replace(/[^0-9]/g, '').slice(0, PIN_LENGTH))}
            placeholder="● ● ● ●"
            keyboardType="number-pad"
            secureTextEntry
            accessibilityLabel="새 PIN"
          />
          <PinInput
            value={second}
            onChangeText={(text) => setSecond(text.replace(/[^0-9]/g, '').slice(0, PIN_LENGTH))}
            placeholder="다시 한 번"
            keyboardType="number-pad"
            secureTextEntry
            accessibilityLabel="새 PIN 확인"
          />
          <Button title="저장" onPress={save} disabled={busy} />
          <View style={{ marginTop: 8 }}>
            <Button title="취소" variant="secondary" onPress={cancel} disabled={busy} />
          </View>
        </>
      ) : (
        <>
          <Note>
            원생 이름·학년·수강료가 한 화면에 있습니다. 수업용으로 같이 쓰는 기기라면
            켜 두세요.
            {'\n'}
            {biometrics
              ? '이 기기는 Face ID · Touch ID를 쓸 수 있습니다. PIN은 그것이 안 될 때를 위한 것입니다.'
              : '이 기기에 등록된 얼굴·지문이 없어 PIN으로만 엽니다.'}
          </Note>
          <Button title="잠금 켜기" variant="secondary" onPress={() => setEntering(true)} />
        </>
      )}
    </>
  );
};

export default LockSection;
