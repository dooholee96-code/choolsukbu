/**
 * DB 쓰기를 한 줄로 세운다.
 *
 * expo-sqlite의 withTransactionAsync는 BEGIN과 COMMIT 사이에서 await하는 동안 **같은
 * 연결의 다른 질의를 막지 않는다** (라이브러리 주석에도 순서를 보장하지 않는다고
 * 적혀 있다). 그래서 두 가지 일이 실제로 생긴다.
 *
 *   - 동기화가 병합 트랜잭션을 연 사이 등원을 누르면, 그 등원이 동기화 트랜잭션
 *     **안에서** 실행된다. 병합이 실패해 되돌려지면 화면에 찍혔던 등원도 사라진다.
 *   - 트랜잭션 둘이 겹치면 나중 것의 BEGIN이 실패하고, 그 실패를 수습하는 ROLLBACK이
 *     **앞 것의 작업까지** 되돌린다.
 *
 * 그래서 DB를 바꾸는 일은 전부 여기를 지난다 — 화면의 쓰기(useData의 write),
 * 가져오기·복원, 동기화의 병합. 줄을 서는 것은 가장 바깥 입구 한 곳뿐이어야 한다.
 * 줄 안에서 또 줄을 서면 앞사람이 끝나기를 영원히 기다린다.
 *
 * 읽기는 세우지 않는다. 같은 연결에서는 진행 중인 쓰기가 보일 뿐이고, 되돌려지면
 * 다음 읽기가 바로잡는다. 네트워크(iCloud) 기다림도 줄 밖에서 한다 — 몇 초씩 막으면
 * 그동안 누른 등원이 전부 밀린다.
 */
let tail: Promise<unknown> = Promise.resolve();

export const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
  const run = tail.then(task);
  // 앞사람이 실패해도 줄은 계속 간다.
  tail = run.catch(() => undefined);
  return run;
};
