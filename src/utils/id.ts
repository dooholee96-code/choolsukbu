/**
 * 새 레코드용 UUID v4를 만든다.
 *
 * 'uuid' 패키지를 쓰지 않는 이유: React Native 번들에서는 uuid의 rng가
 * rng-browser.js로 매핑되는데, 이 구현은 crypto.getRandomValues가 없으면
 * 그대로 throw한다. Hermes에는 기본 제공되지 않으므로 별도 폴리필이 필요하다.
 * expo-crypto는 네이티브 CSPRNG를 직접 호출하므로 폴리필이 필요 없다.
 *
 * import를 함수 안으로 미룬 이유: 이 모듈은 데이터 계층 전체가 끌어다 쓰는데,
 * 최상단에서 expo-crypto를 부르면 SQL과 병합 로직까지 네이티브 모듈에 묶여
 * React Native 밖에서는 불러올 수조차 없다. 그러면 스키마와 병합을 실제
 * SQLite에 돌려 검증하는 길이 막힌다.
 */
export const createId = (): string => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Crypto = require('expo-crypto') as { randomUUID: () => string };
  return Crypto.randomUUID();
};
