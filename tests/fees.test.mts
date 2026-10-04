import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeFeeRule, gradeNumber, matchFeeRule } from '../src/utils/fees';
import type { FeeRule } from '../src/types';

const rule = (id: string, fee: number, extra: Partial<FeeRule> = {}): FeeRule => ({
  id, fee, perWeek: null, gradeFrom: null, gradeTo: null, ...extra,
});
const kid = (grade: string, days: number) => ({
  grade,
  scheduledDays: (['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const).slice(0, days) as never,
});

test('학년 글자를 숫자로', () => {
  assert.equal(gradeNumber('초3'), 3);
  assert.equal(gradeNumber('3'), 3);
  assert.equal(gradeNumber('3학년'), 3);
  assert.equal(gradeNumber('중1'), 7);
  assert.equal(gradeNumber('고2'), 11);
  assert.equal(gradeNumber('7세'), null);
  assert.equal(gradeNumber('유치부'), null);
});

test('조건을 더 많이 채운 줄이 이긴다', () => {
  // 출석부 메모: 저학년 25만, 4학년 이상 40만, 그리고 주 2회는 따로
  const rules = [
    rule('base', 250000),
    rule('upper', 400000, { gradeFrom: 4 }),
    rule('twice', 200000, { perWeek: 2 }),
    rule('upper-twice', 300000, { perWeek: 2, gradeFrom: 4 }),
  ];
  assert.equal(matchFeeRule(rules, kid('초2', 3))?.id, 'base');
  assert.equal(matchFeeRule(rules, kid('초5', 3))?.id, 'upper');
  assert.equal(matchFeeRule(rules, kid('초2', 2))?.id, 'twice');
  assert.equal(matchFeeRule(rules, kid('초5', 2))?.id, 'upper-twice');
});

test('맞는 줄이 없거나 기준표가 비면 null', () => {
  assert.equal(matchFeeRule([], kid('초2', 2)), null);
  assert.equal(matchFeeRule(undefined, kid('초2', 2)), null);
  assert.equal(matchFeeRule([rule('a', 300000, { perWeek: 3 })], kid('초2', 2)), null);
  assert.equal(matchFeeRule([rule('a', 300000, { gradeFrom: 1, gradeTo: 3 })], kid('7세', 2)), null, '나이는 학년이 아니다');
  assert.equal(matchFeeRule([rule('a', 0)], kid('초2', 2)), null, '금액 0인 줄은 쓰지 않는다');
});

test('같은 조건 수면 위에 있는 줄', () => {
  const rules = [rule('first', 1, { perWeek: 2 }), rule('second', 2, { gradeTo: 3 })];
  assert.equal(matchFeeRule(rules, kid('초1', 2))?.id, 'first');
});

test('기준 줄을 사람 말로', () => {
  assert.equal(describeFeeRule(rule('a', 1)), '모든 원생');
  assert.equal(describeFeeRule(rule('a', 1, { perWeek: 3, gradeFrom: 1, gradeTo: 3 })), '주 3회 · 1학년~3학년');
  assert.equal(describeFeeRule(rule('a', 1, { gradeFrom: 4 })), '4학년 이상');
  assert.equal(describeFeeRule(rule('a', 1, { gradeFrom: 7, gradeTo: 9 })), '중1~중3');
});
