import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, STUDENT_HEADERS } from '../src/utils/csv';
import { parsePaymentsCsv, PAYMENT_HEADERS } from '../src/utils/paymentImport';
import { readAmount, readDate, readDays, readMonth, readTime } from '../src/utils/sheet';
import { buildPaymentLedgerCsv } from '../src/utils/tax';
import type { Payment, Student } from '../src/types';
import { openTestDb } from './helpers/db.mts';
import { insertStudent } from '../src/data/students';
import { insertPayments, listPaidBetween, softDeletePayment } from '../src/data/payments';

test('엑셀이 바꿔 놓는 날짜 모양을 받는다', () => {
  for (const text of ['2026-03-05', '2026.3.5', '2026/03/05', '2026. 3. 5.', '2026년 3월 5일']) {
    assert.equal(readDate(text), '2026-03-05', text);
  }
  assert.equal(readDate('2026-02-30'), null, '없는 날짜');
  assert.equal(readDate('3/5'), null, '해가 없으면 모른다');
});

test('수강월은 달만, 날짜로 바뀌어 있어도 달만 뽑는다', () => {
  for (const text of ['2026-03', '2026.3', '2026년 3월', '2026년 3월분', '2026-03-01']) {
    assert.equal(readMonth(text), '2026-03', text);
  }
  assert.equal(readMonth('2026-13'), null);
});

test('시각은 24시간, 오전·오후와 초까지 받는다', () => {
  assert.equal(readTime('16:00'), '16:00');
  assert.equal(readTime('16:00:00'), '16:00');
  assert.equal(readTime('4:00 PM'), '16:00');
  assert.equal(readTime('오후 4:30'), '16:30');
  assert.equal(readTime('12:00 AM'), '00:00');
  assert.equal(readTime('9:5'), null);
});

test('금액은 쉼표·원·괄호 음수를 받는다', () => {
  assert.equal(readAmount('250,000원'), 250000);
  assert.equal(readAmount('₩ 250000'), 250000);
  assert.equal(readAmount('-50,000'), -50000);
  assert.equal(readAmount('(50,000)'), -50000);
  assert.equal(readAmount('이십만'), null);
});

test('요일은 영문과 한글 여러 모양', () => {
  assert.deepEqual(readDays('Mon,Wed'), ['Mon', 'Wed']);
  assert.deepEqual(readDays('월,수,금'), ['Mon', 'Wed', 'Fri']);
  assert.deepEqual(readDays('금월수'), ['Mon', 'Wed', 'Fri'], '월~일 순으로');
  assert.deepEqual(readDays('월요일/화요일'), ['Mon', 'Tue']);
  assert.deepEqual(readDays('월 월'), ['Mon']);
});

test('엑셀 양식의 한글 머리글로 원생을 가져온다', async () => {
  const headers = Object.keys(STUDENT_HEADERS).join(',');
  const csv = `﻿${headers}\n김하늘,7세,"월,수",오후 4:00,17:00:00,,"250,000원",,,예\n`;
  const { students, skipped } = await parseCSV(csv);
  assert.deepEqual(skipped, []);
  assert.equal(students.length, 1);
  const [s] = students;
  assert.deepEqual(
    [s.name, s.grade, s.scheduledDays, s.scheduledStartTime, s.scheduledEndTime, s.fee, s.preschool],
    ['김하늘', '7세', ['Mon', 'Wed'], '16:00', '17:00', 250000, true]
  );
});

const student = (id: string, name: string, extra: Partial<Student> = {}): Student => ({
  id, name, grade: '초3', scheduledDays: ['Mon'], scheduledStartTime: '16:00', scheduledEndTime: '17:00', ...extra,
});
const roster = [
  student('a', '김하늘', { preschool: true }),
  student('b', '이바다'),
  student('c', '박민준', { note: '월수반' }),
  student('d', '박민준', { note: '화목반' }),
];
const H = PAYMENT_HEADERS;
const header = [H.paidOn, H.month, H.name, H.note, H.kind, H.amount, H.method, H.cashReceipt, H.memo].join(',');

test('수납 시트를 읽는다 — 수입구분이 비면 수강료, 수강월이 비면 받은 달', () => {
  const csv = `${header}\n2026.3.5,,김하늘,,,"250,000",카드,,\n2026-03-06,2026-04,이바다,,교재비,30000,이체,발급,4월 교재\n`;
  const { payments, skipped, duplicates } = parsePaymentsCsv(csv, roster, []);
  assert.deepEqual(skipped, []);
  assert.equal(duplicates, 0);
  const [one, two] = payments;
  assert.deepEqual(
    [one.studentId, one.paidOn, one.month, one.kind, one.method, one.amount, one.cashReceipt, one.preschool],
    ['a', '2026-03-05', '2026-03', 'tuition', 'card', 250000, false, true]
  );
  assert.deepEqual(
    [two.studentId, two.month, two.kind, two.method, two.cashReceipt, two.note],
    ['b', '2026-04', 'materials', 'transfer', true, '4월 교재']
  );
});

test('동명이인은 구분으로 가르고, 구분이 없으면 건너뛴다', () => {
  const csv = `${header}\n2026-03-05,,박민준,화목반,,300000,현금,예,\n2026-03-05,,박민준,,,300000,현금,예,\n`;
  const { payments, skipped } = parsePaymentsCsv(csv, roster, []);
  assert.deepEqual(payments.map((p) => p.studentId), ['d']);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].row, 3);
  assert.match(skipped[0].reason, /2명/);
});

test('없는 원생, 이상한 결제수단, 0원은 사유와 함께 건너뛴다', () => {
  const csv = `${header}\n2026-03-05,,최없음,,,1000,카드,,\n2026-03-05,,김하늘,,,1000,상품권,,\n2026-03-05,,김하늘,,,0,카드,,\n`;
  const { payments, skipped } = parsePaymentsCsv(csv, roster, []);
  assert.equal(payments.length, 0);
  assert.deepEqual(skipped.map((s) => s.row), [2, 3, 4]);
});

test('맨 아래 합계 줄처럼 이름 없는 줄은 사유와 함께 건너뛰고, 완전히 빈 줄은 조용히 넘긴다', () => {
  const csv = `${header}\n2026-03-05,,김하늘,,,1000,카드,,\n,,,,,,,,\n,,,,합계,1000,,,\n`;
  const { payments, skipped } = parsePaymentsCsv(csv, roster, []);
  assert.equal(payments.length, 1);
  assert.equal(skipped.length, 1);
});

test('같은 파일을 두 번 가져와도 두 번 들어가지 않는다', () => {
  const csv = `${header}\n2026-03-05,,김하늘,,,250000,카드,,\n2026-03-05,,김하늘,,,250000,카드,,\n`;
  const first = parsePaymentsCsv(csv, roster, []);
  assert.equal(first.payments.length, 1, '파일 안에서 겹친 줄');
  assert.equal(first.duplicates, 1);

  const again = parsePaymentsCsv(csv, roster, first.payments);
  assert.equal(again.payments.length, 0, '이미 있는 기록');
  assert.equal(again.duplicates, 2);
});

test('앱이 내보낸 수납 장부를 그대로 가져오면 같은 기록이 된다', () => {
  const original: Payment[] = [
    { id: 'p1', studentId: 'a', paidOn: '2026-01-05', month: '2026-01', amount: 250000, kind: 'tuition', method: 'transfer', cashReceipt: true, preschool: true, note: '1월' },
    { id: 'p2', studentId: 'c', paidOn: '2026-03-02', month: '2026-03', amount: -50000, kind: 'tuition', method: 'cash', cashReceipt: false, preschool: false, note: null },
    { id: 'p3', studentId: 'b', paidOn: '2026-03-03', month: '2026-03', amount: 30000, kind: 'exam', method: 'card', cashReceipt: false, preschool: false, note: null },
  ];
  // 3월에 입학해 지금은 미취학이 아니어도, 장부에 적힌 받은 순간의 값을 따른다.
  const now = roster.map((s) => ({ ...s, preschool: false }));

  const csv = buildPaymentLedgerCsv(original, now);
  const { payments, skipped } = parsePaymentsCsv(csv, now, []);

  assert.deepEqual(skipped, []);
  const strip = (p: Payment) => ({ ...p, id: '', note: p.note ?? null });
  assert.deepEqual(payments.map(strip), original.map(strip));
});

test('머리글이 다르면 한 줄로 알려 준다', () => {
  const { payments, skipped } = parsePaymentsCsv('name,amount\n김하늘,1000\n', roster, []);
  assert.equal(payments.length, 0);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /받은날/);
});

test('두 기기에서 같은 파일을 가져와도 id가 같아 한 건으로 합쳐진다', () => {
  const csv = `${header}\n2026-03-05,,김하늘,,,150000,카드,,\n`;
  const [onPad] = parsePaymentsCsv(csv, roster, []).payments;
  const [onPhone] = parsePaymentsCsv(csv, roster, []).payments;
  assert.equal(onPad.id, onPhone.id);
  assert.ok(onPad.id.startsWith('import:'));
});

test('저장할 때 이미 살아 있는 것은 건너뛰고, 지운 것은 되살린다', async () => {
  const db = await openTestDb();
  for (const s of roster) await insertStudent(db, s);
  const csv = `${header}\n2026-03-05,,김하늘,,,150000,카드,,\n2026-03-06,,이바다,,,120000,현금,발급,\n`;
  const { payments: rows } = parsePaymentsCsv(csv, roster, []);
  assert.equal(await insertPayments(db, rows), 2);
  assert.equal(await insertPayments(db, rows), 0, '미리 본 뒤 동기화로 같은 것이 들어온 경우');
  await softDeletePayment(db, rows[0].id);
  assert.equal(await insertPayments(db, rows), 1, '지운 것을 다시 가져오면 되살린다');
  const live = await listPaidBetween(db, '2026-01-01', '2026-12-31');
  assert.equal(live.filter((p) => !p.deletedAt).length, 2);
});

test('통화 기호가 부호 앞에 와도, 날짜 뒤에 시각이 붙어도 읽는다', () => {
  assert.equal(readAmount('₩-50,000'), -50000);
  assert.equal(readAmount('- 50,000 원'), -50000);
  assert.equal(readDate('2026-03-05 0:00'), '2026-03-05');
  assert.equal(readDate('2026-03-05 오전 12:00:00'), '2026-03-05');
  assert.equal(readDate('2026-03-05 12:00:00 AM'), '2026-03-05');
  assert.equal(readMonth('2026-03-01 0:00'), '2026-03');
});
