import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { logger } from '../utils/logger';

/**
 * 앱 잠금.
 *
 * 막으려는 것은 침입자가 아니라 **수업 중에 아이패드를 만지는 아이들**이다.
 * 원생 이름·학년·수강료가 한 화면에 있어서, 잠깐 건네줬을 때 그대로 보이면 곤란하다.
 *
 * 그래서 DB를 암호화하지 않는다. 화면 앞을 막는 것으로 충분하고, 암호화는
 * 키를 잃는 순간 기록도 함께 잃는 위험을 새로 만든다 — 이 앱에는 서버가 없다.
 */

/**
 * 이 플랫폼에서 잠금을 쓸 수 있는가.
 *
 * 키체인이 없으면 PIN을 안전하게 둘 곳이 없다. 그럴 때는 잠금을 켤 수 있는 것처럼
 * 보여 놓고 조용히 실패하는 대신, 쓸 수 없다고 말한다.
 */
export const isLockSupported = async (): Promise<boolean> => {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
};

const PIN_KEY = 'lock.pin';
const SALT_KEY = 'lock.salt';

/**
 * 소금 길이를 앞에 붙여 경계를 못 박는다.
 *
 * `${salt}:${pin}` 만 쓰면 소금이 'x:123'이고 PIN이 '4'인 경우와 소금이 'x'이고
 * PIN이 '123:4'인 경우가 같은 값이 된다. 지금은 소금이 UUID라 부딪히지 않지만,
 * 형식이 바뀌는 날 조용히 깨진다.
 */
const hash = (pin: string, salt: string) =>
  Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${salt.length}:${salt}:${pin}`
  );

/** 잠금이 켜져 있는가. PIN이 저장돼 있으면 켜진 것이다. */
export const isLockEnabled = async (): Promise<boolean> => {
  try {
    return (await SecureStore.getItemAsync(PIN_KEY)) !== null;
  } catch (error) {
    logger.error('Failed to read lock state', error);
    return false;
  }
};

/**
 * PIN을 정한다. 원문은 저장하지 않는다.
 *
 * 키체인에 있어도 평문으로 두지 않는 이유는, 백업이나 기기 이전으로 키체인이
 * 옮겨 다니기 때문이다. 소금을 따로 두어 같은 PIN이라도 기기마다 다른 값이 된다.
 */
export const setPin = async (pin: string): Promise<void> => {
  const salt = Crypto.randomUUID();
  await SecureStore.setItemAsync(SALT_KEY, salt);
  await SecureStore.setItemAsync(PIN_KEY, await hash(pin, salt));
};

export const clearPin = async (): Promise<void> => {
  await SecureStore.deleteItemAsync(PIN_KEY);
  await SecureStore.deleteItemAsync(SALT_KEY);
};

export const verifyPin = async (pin: string): Promise<boolean> => {
  try {
    const [stored, salt] = await Promise.all([
      SecureStore.getItemAsync(PIN_KEY),
      SecureStore.getItemAsync(SALT_KEY),
    ]);
    if (!stored || !salt) return false;
    return (await hash(pin, salt)) === stored;
  } catch (error) {
    logger.error('Failed to verify pin', error);
    return false;
  }
};

/** 이 기기에 등록된 얼굴·지문이 있는가. 없으면 PIN만 쓴다. */
export const hasBiometrics = async (): Promise<boolean> => {
  try {
    return (await LocalAuthentication.hasHardwareAsync()) &&
      (await LocalAuthentication.isEnrolledAsync());
  } catch (error) {
    logger.error('Failed to query biometrics', error);
    return false;
  }
};

/**
 * Face ID / Touch ID로 연다.
 *
 * 기기 암호 대체를 막지 않는다(disableDeviceFallback: false). 얼굴 인식이
 * 실패하고 PIN까지 잊었을 때 들어갈 길이 하나는 남아 있어야 한다 — 이 앱은
 * 기기 안에만 저장하므로 잠기면 그것으로 기록이 끝이다.
 */
export const authenticateWithBiometrics = async (): Promise<boolean> => {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: '출석부 잠금 해제',
      cancelLabel: 'PIN 입력',
      disableDeviceFallback: false,
    });
    return result.success;
  } catch (error) {
    logger.error('Biometric authentication failed', error);
    return false;
  }
};
