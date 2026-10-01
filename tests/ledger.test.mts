import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMonthLedger, shiftMonth, summarizeLedger } from '../src/utils/ledger';
import type { Payment, Student } from '../src/types';

const s = (id: string, name: string, extra: Partial<Student> = {}): Student => ({
  id, name, grade: '중1', scheduledDays: ['Mon'], scheduledStartTime: '16:00', scheduledEndTime: '18:00',
  fee: 200000, ...extra,
});
const p = (id: string, studentId: string, amount: number, extra: Partial<Payment> = {}): Payment => ({
  id, studentId, amount, kind: 'tuition', paidOn: '2026-10-05', month: '2026-10', method: 'card', cashReceipt: false, preschool: false, ...extra,
});

test('달 옮기기는 해를 넘긴다', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-10', 0), '2026-10');
});

test('미납·일부·완납·금액 미정을 가르고, 손이 갈 순서로 놓는다', () => {
  const ledger = buildMonthLedger(
    [s('a', '가'), s('b', '나'), s('c', '다'), s('d', '라', { fee: undefined }), s('e', '마')],
    [
      p('1', 'b', 100000),
      p('2', 'c', 120000),
      p('3', 'c', 80000, { method: 'transfer' }), // 분납으로 완납
      p('4', 'e', 200000, { month: '2026-11' }), // 다음 달 선납은 이 달과 무관
    ],
    '2026-10'
  );
  assert.deepEqual(
    ledger.map((e) => [e.student.name, e.status]),
    [['가', 'unpaid'], ['마', 'unpaid'], ['나', 'partial'], ['라', 'noFee'], ['다', 'paid']]
  );
  const summary = summarizeLedger(ledger);
  assert.equal(summary.expected, 800000);
  assert.equal(summary.paid, 300000);
  assert.equal(summary.outstanding, 3);
  assert.deepEqual(summary.byMethod, { card: 220000, transfer: 80000, cash: 0 });
});

test('환불하면 다시 미납으로 돌아간다', () => {
  const [entry] = buildMonthLedger([s('a', '가')], [p('1', 'a', 200000), p('2', 'a', -200000)], '2026-10');
  assert.equal(entry.paid, 0);
  assert.equal(entry.status, 'unpaid');
});

test('그 달 1일 전에 퇴원한 원생은 빠지고, 그 달에 퇴원했거나 낸 기록이 있으면 남는다', () => {
  const ledger = buildMonthLedger(
    [
      s('a', '9월퇴원', { withdrawnAt: '2026-09-20' }),
      s('b', '10월1일퇴원', { withdrawnAt: '2026-10-01' }),
      s('c', '10월중순퇴원', { withdrawnAt: '2026-10-15' }),
      s('d', '9월퇴원_10월납부', { withdrawnAt: '2026-09-20' }),
    ],
    [p('1', 'd', 100000)],
    '2026-10'
  );
  assert.deepEqual(ledger.map((e) => e.student.id).sort(), ['c', 'd']);
});

test('교재비는 받은 돈이지만 수강료 완납에는 들어가지 않는다', () => {
  const [entry] = buildMonthLedger(
    [s('a', '가')],
    [p('1', 'a', 200000, { kind: 'materials' })],
    '2026-10'
  );
  assert.equal(entry.status, 'unpaid');
  assert.equal(entry.payments.length, 1, '목록에는 보인다');
  const summary = summarizeLedger([entry]);
  assert.equal(summary.paid, 0);
  assert.equal(summary.otherIncome, 200000);
  assert.equal(summary.byMethod.card, 200000);
});
