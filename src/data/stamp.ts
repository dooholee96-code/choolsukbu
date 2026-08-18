/**
 * 동기화 비교의 유일한 근거. 기기 시계 기준 ISO 8601(UTC).
 *
 * 반드시 앞서 준 값보다 늦은 값을 준다. 밀리초 해상도라 한 트랜잭션 안에서
 * 두 번 부르면 같은 값이 나오기 쉬운데, 묘비와 그 자리를 대신할 새 행이 같은
 * 시각을 달면 병합이 승자를 가리지 못하고 id 추첨으로 넘어간다. 그러면 절반의
 * 확률로 방금 만든 행이 지고 다음 동기화에서 지워진다.
 */
let last = 0;

export const stamp = (): string => {
  last = Math.max(Date.now(), last + 1);
  return new Date(last).toISOString();
};
