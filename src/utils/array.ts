/**
 * 배열을 size개씩 끊어 2차원 배열로 만든다.
 *
 * SectionList는 FlatList와 달리 numColumns를 지원하지 않으므로,
 * 그리드를 만들려면 "한 행"을 하나의 아이템으로 넘겨야 한다.
 */
export const chunk = <T>(items: T[], size: number): T[][] => {
  if (size <= 1) return items.map((item) => [item]);

  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
};
