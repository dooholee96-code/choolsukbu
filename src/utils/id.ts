import * as Crypto from 'expo-crypto';

/**
 * 새 레코드용 UUID v4를 만든다.
 *
 * 'uuid' 패키지를 쓰지 않는 이유: React Native 번들에서는 uuid의 rng가
 * rng-browser.js로 매핑되는데, 이 구현은 crypto.getRandomValues가 없으면
 * 그대로 throw한다. Hermes에는 기본 제공되지 않으므로 별도 폴리필이 필요하다.
 * expo-crypto는 네이티브 CSPRNG를 직접 호출하므로 폴리필이 필요 없다.
 */
export const createId = (): string => Crypto.randomUUID();
