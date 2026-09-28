/**
 * 새 레코드용 UUID v4를 만든다.
 *
 * 표준 Web Crypto(crypto.randomUUID)가 있으면 그걸 쓰고, 없으면 expo-crypto로 간다.
 * 브라우저(보안 컨텍스트)와 노드에는 있고, Hermes에는 기본으로 없다 — 그래서 아이패드
 * 앱은 expo-crypto를 탄다. 둘 다 운영체제의 암호학적 난수를 쓴다.
 *
 * 'uuid' 패키지를 쓰지 않는 이유: React Native 번들에서는 uuid의 rng가
 * rng-browser.js로 매핑되는데, 이 구현은 crypto.getRandomValues가 없으면
 * 그대로 throw한다. Hermes에는 기본 제공되지 않으므로 별도 폴리필이 필요하다.
 * expo-crypto는 네이티브 CSPRNG를 직접 호출하므로 폴리필이 필요 없다.
 *
 * expo-crypto를 함수 안에서 부르는 이유: 이 모듈은 데이터 계층 전체가 끌어다 쓰는데,
 * 최상단에서 부르면 SQL과 병합 로직까지 네이티브 모듈에 묶여 React Native 밖에서는
 * 불러올 수조차 없다. 표준 쪽을 먼저 보는 것도 같은 이유다 — 등원·결석·보충을 실제
 * SQLite에 돌려 보는 테스트가 id를 만들 수 있어야 한다.
 */
export const createId = (): string => {
  const standard = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof standard?.randomUUID === 'function') return standard.randomUUID();

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Crypto = require('expo-crypto') as { randomUUID: () => string };
  return Crypto.randomUUID();
};
