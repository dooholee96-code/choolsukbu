/**
 * 새로 읽은 목록에서, 바뀌지 않은 행은 예전 객체를 그대로 쓴다.
 *
 * 쓰기 한 번마다 화면 데이터를 DB에서 다시 읽는다. 그때 모든 행이 새 객체가 되면
 * 한 명을 등원시켰을 뿐인데 카드 전부가 '바뀐 것'으로 보여 다시 그려진다 —
 * React.memo는 내용이 아니라 참조로 비교한다.
 *
 * id와 updatedAt이 같으면 같은 행이다. 모든 쓰기가 stamp()로 updatedAt을 올리고,
 * 동기화도 상대 기기의 updatedAt을 그대로 가져오기 때문이다. updatedAt이 없는 행은
 * 믿을 근거가 없으므로 늘 새것으로 본다.
 *
 * 하나도 바뀌지 않았으면 **예전 배열 자체**를 돌려준다. 그러면 React가 상태 갱신을
 * 건너뛰고, 그 배열에 기대는 계산(오늘 명단 등)도 다시 하지 않는다.
 */
export const reconcile = <T extends { id: string; updatedAt?: string | null }>(
  previous: T[],
  next: T[]
): T[] => {
  const byId = new Map(previous.map((row) => [row.id, row]));
  let changed = previous.length !== next.length;

  const merged = next.map((row, index) => {
    const old = byId.get(row.id);
    if (old && row.updatedAt && old.updatedAt === row.updatedAt) {
      // 같은 행이어도 자리가 바뀌었으면 목록은 바뀐 것이다 (이름순 정렬 등).
      if (previous[index] !== old) changed = true;
      return old;
    }
    changed = true;
    return row;
  });

  return changed ? merged : previous;
};
