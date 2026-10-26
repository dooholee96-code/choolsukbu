import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCertificatesHtml,
  certificateTargets,
} from '../src/utils/certificate';
import { deadlineLabel, deadlineTaxYear, upcomingDeadlines } from '../src/utils/deadlines';
import type { Payment, Student } from '../src/types';

const s = (id: string, name: string): Student => ({
  id, name, grade: '7세', scheduledDays: ['Mon'], scheduledStartTime: '16:00', scheduledEndTime: '17:00',
});
const p = (id: string, studentId: string, extra: Partial<Payment> = {}): Payment => ({
  id, studentId, paidOn: '2026-03-05', month: '2026-03', amount: 250000, kind: 'tuition',
  method: 'card', cashReceipt: false, preschool: false, ...extra,
});

const students = [s('a', '하윤'), s('b', '가온'), s('c', '다솜'), s('d', '라온')];
const payments = [
  p('1', 'a', { preschool: true }),
  p('2', 'b'),
  p('3', 'c', { paidOn: '2025-12-05' }), // 다른 해
  p('4', 'd', { preschool: true, deletedAt: '2026-03-06T00:00:00Z' }), // 지운 기록
];

test('일괄 발급 대상: 그 해 받은 돈이 있는 원생, 이름순', () => {
  assert.deepEqual(certificateTargets(students, payments, 2026, false).map((x) => x.id), ['b', 'a']);
});

test('미취학만 고르면 미취학으로 받은 돈이 있는 원생만', () => {
  assert.deepEqual(certificateTargets(students, payments, 2026, true).map((x) => x.id), ['a']);
});

test('일괄 증명서는 한 문서에 원생마다 한 쪽씩', () => {
  const html = buildCertificatesHtml(
    ['a', 'b'].map((id) => ({
      academy: null,
      student: students.find((x) => x.id === id) as Student,
      payments,
      year: 2026,
      issuedOn: '2027-01-10',
    })),
    2026
  );
  assert.equal(html.match(/<section class="page">/g)?.length, 2);
  assert.equal(html.match(/<!doctype html>/g)?.length, 1);
  assert.match(html, /page-break-before: always/);
  assert.ok(html.includes('하윤') && html.includes('가온'));
});

test('여름에는 다가오는 신고 일정이 없다', () => {
  assert.deepEqual(upcomingDeadlines('2026-07-15'), []);
});

test('새해 첫날에는 증명서와 사업장현황신고가 보인다 — 신고가 먼저', () => {
  const list = upcomingDeadlines('2027-01-01');
  assert.deepEqual(list.map((d) => d.title), ['사업장현황신고', '교육비 납입 증명서']);
  assert.equal(list[0].daysLeft, 40);
  assert.equal(deadlineLabel(list[0]), '2월 10일까지 · D-40');
  assert.equal(deadlineLabel(list[1]), '2월 말까지', '법정 기한이 아닌 것은 D-day로 몰지 않는다');
  assert.equal(deadlineTaxYear(list[0]), 2026, '지난해 것을 낸다');
});

test('12월 말부터 다음 해 신고가 보인다', () => {
  assert.deepEqual(upcomingDeadlines('2026-12-28').map((d) => d.key), ['bizstatus-2027']);
});

test('기한 당일은 오늘, 다음 날은 사라진다', () => {
  assert.equal(deadlineLabel(upcomingDeadlines('2027-02-10')[0]), '2월 10일까지 · 오늘');
  assert.ok(!upcomingDeadlines('2027-02-11').some((d) => d.key === 'bizstatus-2027'));
});

test('종합소득세는 4월 중순부터 5월 말까지', () => {
  assert.deepEqual(upcomingDeadlines('2027-04-10').map((d) => d.key), []);
  assert.deepEqual(upcomingDeadlines('2027-04-20').map((d) => d.key), ['incometax-2027']);
  assert.deepEqual(upcomingDeadlines('2027-05-31').map((d) => d.daysLeft), [0]);
});
