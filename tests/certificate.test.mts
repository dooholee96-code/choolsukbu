import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCertificateHtml, certificatePayments, escapeHtml, summarizeCertificate } from '../src/utils/certificate';
import type { Payment, Student } from '../src/types';

const student: Student = {
  id: 's1', name: '김하윤', grade: '7세', scheduledDays: ['Mon'], scheduledStartTime: '16:00', scheduledEndTime: '17:00',
};
const p = (id: string, extra: Partial<Payment>): Payment => ({
  id, studentId: 's1', paidOn: '2026-01-05', month: '2026-01', amount: 250000, kind: 'tuition',
  method: 'card', cashReceipt: false, preschool: false, ...extra,
});
const academy = {
  name: '숲속영어', owner: '이두호', bizNumber: '123-45-67890', address: '서울시 어딘가 1', phone: '02-123-4567', subject: '영어',
};

const payments = [
  p('3', { paidOn: '2026-03-05', month: '2026-03' }), // 입학 뒤
  p('1', { paidOn: '2026-01-05', preschool: true }),
  p('2', { paidOn: '2026-02-05', month: '2026-02', preschool: true }),
  p('x', { paidOn: '2025-12-05', month: '2025-12', preschool: true }), // 작년
  p('y', { studentId: 's2' }), // 다른 원생
  p('z', { paidOn: '2026-04-05', deletedAt: '2026-04-06T00:00:00Z' }), // 지운 기록
  p('4', { paidOn: '2026-04-10', month: '2026-04', amount: -50000, note: '중도 환불' }),
];

test('그 원생·그 해·지우지 않은 것만, 받은 날 순으로', () => {
  assert.deepEqual(certificatePayments(payments, 's1', 2026).map((x) => x.id), ['1', '2', '3', '4']);
});

test('합계는 환불을 빼고, 미취학 금액은 받는 순간 미취학이었던 것만', () => {
  assert.deepEqual(summarizeCertificate(certificatePayments(payments, 's1', 2026)), {
    total: 700000,
    preschool: 500000,
  });
});

test('증명서에 학원 칸, 납입 내역, 합계, 미취학 금액이 들어간다', () => {
  const html = buildCertificateHtml({ academy, student, payments, year: 2026, issuedOn: '2027-01-10', applicant: '김엄마' });
  for (const text of ['교육비 납입 증명서', '김하윤', '김엄마', '숲속영어', '123-45-67890', '02-123-4567', '영어',
    '2026. 1. 5.', '2월분', '700,000원', '취학 전 아동 교육비', '500,000원', '(환불)', '2027. 1. 10.', '대표 이두호']) {
    assert.ok(html.includes(text), `빠짐: ${text}`);
  }
  assert.ok(!html.includes('2025. 12. 5.'), '작년 것은 없다');
});

test('학원 정보와 신청인이 없으면 빈 칸으로 뽑는다', () => {
  const html = buildCertificateHtml({ academy: null, student, payments: [], year: 2026, issuedOn: '2027-01-10' });
  assert.ok(html.includes('이 기간에 납입한 내역이 없습니다'));
  assert.ok(html.includes('<span class="blank"></span>'));
  assert.ok(!html.includes('취학 전 아동 교육비'), '미취학 금액이 없으면 그 줄도 없다');
});

test('이름에 꺾쇠가 있어도 HTML이 깨지지 않는다', () => {
  assert.equal(escapeHtml('<b>&"'), '&lt;b&gt;&amp;&quot;');
  const html = buildCertificateHtml({
    academy, student: { ...student, name: '<script>x</script>' }, payments: [], year: 2026, issuedOn: '2027-01-10',
  });
  assert.ok(!html.includes('<script>x'));
});
