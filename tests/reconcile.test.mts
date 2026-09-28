import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile } from '../src/utils/reconcile';

type Row = { id: string; updatedAt?: string | null; name?: string };

const a = { id: 'a', updatedAt: '2026-09-28T01:00:00.000Z', name: '김민준' };
const b = { id: 'b', updatedAt: '2026-09-28T01:00:00.000Z', name: '이서연' };

test('아무것도 바뀌지 않았으면 예전 배열을 그대로 돌려준다', () => {
  // 새로 읽은 행은 내용이 같아도 새 객체다. 그대로 두면 카드가 전부 다시 그려진다.
  const previous: Row[] = [a, b];
  const next: Row[] = [{ ...a }, { ...b }];

  assert.equal(reconcile(previous, next), previous);
});

test('바뀐 행만 새 객체고 나머지는 예전 객체다', () => {
  const previous: Row[] = [a, b];
  const bChanged = { ...b, updatedAt: '2026-09-28T02:00:00.000Z', name: '이서연(수)' };
  const result = reconcile(previous, [{ ...a }, bChanged]);

  assert.notEqual(result, previous, '목록은 바뀌었다');
  assert.equal(result[0], a, '안 바뀐 행은 같은 객체 — 그 카드는 다시 그리지 않는다');
  assert.equal(result[1], bChanged);
});

test('행이 늘거나 줄면 바뀐 것이다', () => {
  const c = { id: 'c', updatedAt: '2026-09-28T03:00:00.000Z' };
  const grown = reconcile<Row>([a], [{ ...a }, c]);
  assert.equal(grown.length, 2);
  assert.equal(grown[0], a);

  const shrunk = reconcile<Row>([a, b], [{ ...a }]);
  assert.deepEqual(shrunk, [a]);
});

test('순서만 바뀌어도 바뀐 것이다', () => {
  // 이름을 고쳐 정렬 순서가 바뀐 경우. 예전 배열을 돌려주면 화면 순서가 틀린다.
  const result = reconcile<Row>([a, b], [{ ...b }, { ...a }]);
  assert.deepEqual(
    result.map((row) => row.id),
    ['b', 'a']
  );
  assert.equal(result[0], b);
});

test('updatedAt이 없는 행은 믿지 않고 새것으로 본다', () => {
  const legacy = { id: 'x', updatedAt: null, name: '옛날' };
  const reread = { id: 'x', updatedAt: null, name: '고친 이름' };
  const result = reconcile<Row>([legacy], [reread]);

  assert.equal(result[0], reread);
});

test('빈 목록끼리는 예전 배열이다', () => {
  const empty: Row[] = [];
  assert.equal(reconcile(empty, []), empty);
});
