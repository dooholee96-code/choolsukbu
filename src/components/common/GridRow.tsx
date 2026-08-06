import React from 'react';
import styled from 'styled-components/native';

const Row = styled.View<{ $gap: number }>`
  flex-direction: row;
  align-items: stretch;
  gap: ${({ $gap }) => $gap}px;
  margin-bottom: ${({ $gap }) => $gap}px;
`;

const Cell = styled.View`
  flex: 1;
`;

interface GridRowProps<T> {
  items: T[];
  /** 한 행의 칸 수. 마지막 행이 모자라면 빈 칸으로 채워 폭을 맞춘다. */
  columns: number;
  gap?: number;
  renderItem: (item: T) => React.ReactNode;
  keyExtractor: (item: T) => string;
}

/**
 * 카드 한 행을 그린다.
 *
 * FlatList의 numColumns를 쓰지 않는 이유가 두 가지 있다.
 * 1. SectionList는 numColumns를 아예 지원하지 않는다.
 * 2. numColumns는 값이 바뀔 때 FlatList의 key까지 바꿔주지 않으면 런타임 경고가
 *    나는데, 회전이나 Stage Manager 리사이즈로 열 수가 수시로 바뀌는 이 앱에서는
 *    직접 행을 만드는 편이 예측 가능하다.
 */
function GridRow<T>({ items, columns, gap = 12, renderItem, keyExtractor }: GridRowProps<T>) {
  const blanks = Math.max(0, columns - items.length);

  return (
    <Row $gap={gap}>
      {items.map((item) => (
        <Cell key={keyExtractor(item)}>{renderItem(item)}</Cell>
      ))}
      {Array.from({ length: blanks }, (_, index) => (
        <Cell key={`blank-${index}`} />
      ))}
    </Row>
  );
}

export default GridRow;
