import { test } from 'node:test';
import assert from 'node:assert/strict';
import Papa from 'papaparse';
import {
  buildAcademyReviewCsv,
  buildPaymentLedgerCsv,
  buildPreschoolCsv,
  buildRevenueSummaryCsv,
  categoryOf,
  monthlyRevenue,
  needsCashReceipt,
  sumRevenue,
} from '../src/utils/tax';
import type { Payment, Student } from '../src/types';

const p = (id: string, extra: Partial<Payment>): Payment => ({
  id,
  studentId: 's1',
  paidOn: '2026-03-05',
  month: '2026-03',
  amount: 250000,
  kind: 'tuition',
  method: 'card',
  cashReceipt: false,
  preschool: false,
  ...extra,
});

const s = (id: string, name: string, extra: Partial<Student> = {}): Student => ({
  id, name, grade: '7세', scheduledDays: ['Mon'], scheduledStartTime: '16:00', scheduledEndTime: '18:00', ...extra,
});

const parse = (csv: string) => {
  assert.ok(csv.startsWith('﻿'), '엑셀이 한글을 깨지 않게 BOM으로 시작한다');
  return Papa.parse<string[]>(csv.slice(1), { skipEmptyLines: false }).data;
};

test('결제수단이 신고서의 세 칸으로 갈린다', () => {
  assert.equal(categoryOf({ method: 'card', cashReceipt: false }), 'card');
  assert.equal(categoryOf({ method: 'card', cashReceipt: true }), 'card');
  assert.equal(categoryOf({ method: 'transfer', cashReceipt: true }), 'cashReceipt');
  assert.equal(categoryOf({ method: 'cash', cashReceipt: true }), 'cashReceipt');
  assert.equal(categoryOf({ method: 'transfer', cashReceipt: false }), 'other');
  assert.equal(categoryOf({ method: 'cash', cashReceipt: false }), 'other');
});

test('합계는 환불을 빼고, 칸별 합이 전체와 맞는다', () => {
  const t = sumRevenue([
    p('1', { amount: 250000 }),
    p('2', { method: 'transfer', cashReceipt: true, amount: 300000 }),
    p('3', { method: 'transfer', amount: 50000 }),
    p('4', { amount: -125000, note: '중도 퇴원 환불' }),
  ]);
  assert.deepEqual(t, { card: 125000, cashReceipt: 300000, other: 50000, total: 475000, count: 4 });
  assert.equal(t.card + t.cashReceipt + t.other, t.total);
});

test('10만 원 이상 현금·이체에 영수증이 없으면 확인 대상이다', () => {
  assert.equal(needsCashReceipt({ method: 'transfer', cashReceipt: false, amount: 100000 }), true);
  assert.equal(needsCashReceipt({ method: 'transfer', cashReceipt: false, amount: 99999 }), false);
  assert.equal(needsCashReceipt({ method: 'transfer', cashReceipt: true, amount: 300000 }), false);
  assert.equal(needsCashReceipt({ method: 'card', cashReceipt: false, amount: 300000 }), false);
});

test('월별은 받은 날 기준이고 12달을 다 채운다', () => {
  const months = monthlyRevenue(
    [p('1', { paidOn: '2026-01-31', month: '2026-02' }), p('2', { paidOn: '2026-12-01' })],
    2026
  );
  assert.equal(months.length, 12);
  assert.equal(months[0].total, 250000, '2월 수강료를 1월에 받았으면 1월 수입이다');
  assert.equal(months[1].total, 0);
  assert.equal(months[11].total, 250000);
});

test('신고 요약: 그 해에 받은 것만, 신고서 칸 순서대로', () => {
  const rows = parse(
    buildRevenueSummaryCsv(
      [
        p('1', { paidOn: '2025-12-30', month: '2026-01' }), // 작년 수입
        p('2', { paidOn: '2026-01-05' }),
        p('3', { paidOn: '2026-02-05', method: 'transfer', cashReceipt: true, amount: 300000 }),
        p('4', { paidOn: '2026-02-06', method: 'transfer', amount: 150000 }), // 영수증 누락
      ],
      2026
    )
  );
  const value = (label: string) => rows.find((r) => r[0] === label)?.[1];
  assert.equal(value('수입금액 합계'), '700000');
  assert.equal(value('신용카드 매출'), '250000');
  assert.equal(value('현금영수증 매출'), '300000');
  assert.equal(value('기타 매출'), '150000');
  assert.equal(value('확인 필요: 현금영수증 없이 10만 원 이상 받은 건'), '1');
  const feb = rows.find((r) => r[0] === '2월')!;
  assert.deepEqual(feb.slice(1), ['0', '300000', '150000', '450000', '2']);
});

test('수납 장부: 받은 날 순, 지운 원생 이름도 붙는다', () => {
  const rows = parse(
    buildPaymentLedgerCsv(
      [
        p('b', { paidOn: '2026-03-10', studentId: 's2', method: 'cash', cashReceipt: false, amount: 80000 }),
        p('a', { paidOn: '2026-03-02', preschool: true }),
      ],
      [s('s1', '김하윤', { note: '유치반' }), s('s2', '박도윤', { deletedAt: '2026-04-01T00:00:00Z' })]
    )
  );
  assert.deepEqual(rows[0], ['받은날', '수강월', '원생', '학년', '구분', '수입구분', '금액', '결제수단', '현금영수증', '신고구분', '미취학', '메모']);
  assert.deepEqual(rows[1].slice(0, 11), ['2026-03-02', '2026-03', '김하윤', '7세', '유치반', '수강료', '250000', '카드', '-', '신용카드 매출', '예']);
  assert.deepEqual(rows[2].slice(2, 10), ['박도윤', '7세', '', '수강료', '80000', '현금', '미발급', '기타 매출']);
});

test('미취학 교육비: 입학 전에 받은 것만, 원생별 한 해 합계', () => {
  const rows = parse(
    buildPreschoolCsv(
      [
        p('1', { paidOn: '2026-01-05', preschool: true }),
        p('2', { paidOn: '2026-02-05', preschool: true }),
        p('3', { paidOn: '2026-03-05', preschool: false }), // 3월 입학 뒤
        p('4', { paidOn: '2025-12-05', preschool: true }), // 작년
        p('5', { paidOn: '2026-01-07', preschool: false, studentId: 's2' }),
      ],
      [s('s1', '김하윤'), s('s2', '이서연', { grade: '중1' })],
      2026
    )
  );
  const [header, row, blank] = rows;
  assert.equal(blank.join(''), '', '합계 표는 김하윤 한 줄 (이서연은 미취학 아님)');
  const col = (name: string) => row[header.indexOf(name)];
  assert.equal(col('원생'), '김하윤');
  assert.equal(col('납부건수'), '2');
  assert.equal(col('연간납부액'), '500000');
  assert.equal(col('첫납부일'), '2026-01-05');
  assert.equal(col('마지막납부일'), '2026-02-05');
  assert.equal(col('원생 주민등록번호(직접 기입)'), '', '주민등록번호는 앱이 담지 않는다');

  // 아래는 증명서에 옮길 납입 내역 한 줄씩
  const start = rows.findIndex((r) => r[0] === '납입 내역');
  assert.deepEqual(rows.slice(start + 2, start + 4).map((r) => r.slice(0, 2)), [
    ['김하윤', '2026-01-05'],
    ['김하윤', '2026-02-05'],
  ]);
});

test('수입금액검토표: 수입구분별 합계가 신고서 합계와 같고, 교습현황은 단가별 연인원', () => {
  const payments = [
    // 김: 1·2월 25만, 3월은 30만으로 올림
    p('1', { studentId: 'k', month: '2026-01', paidOn: '2026-01-05', amount: 250000 }),
    p('2', { studentId: 'k', month: '2026-02', paidOn: '2026-02-05', amount: 250000 }),
    p('3', { studentId: 'k', month: '2026-03', paidOn: '2026-03-05', amount: 300000 }),
    // 이: 1월 25만을 두 번에 나눠 냄 → 한 사람·한 달
    p('4', { studentId: 'l', month: '2026-01', paidOn: '2026-01-03', amount: 150000, method: 'transfer', cashReceipt: true }),
    p('5', { studentId: 'l', month: '2026-01', paidOn: '2026-01-20', amount: 100000, method: 'transfer', cashReceipt: true }),
    // 이: 2월분을 냈다가 전부 돌려줌 → 인원에 넣지 않음
    p('6', { studentId: 'l', month: '2026-02', paidOn: '2026-02-03', amount: 250000 }),
    p('7', { studentId: 'l', month: '2026-02', paidOn: '2026-02-10', amount: -250000 }),
    // 수강료가 아닌 돈
    p('8', { studentId: 'k', kind: 'materials', paidOn: '2026-03-05', amount: 30000 }),
    p('9', { studentId: 'l', kind: 'special', paidOn: '2026-07-20', amount: 200000 }),
    // 작년
    p('10', { studentId: 'k', month: '2025-12', paidOn: '2025-12-05', amount: 250000 }),
  ];
  const rows = parse(buildAcademyReviewCsv(payments, 2026));
  const find = (label: string, from = 0) => rows.slice(from).find((r) => r[0] === label);

  assert.equal(find('수강료')?.[1], '1050000');
  assert.equal(find('교재대')?.[1], '30000');
  assert.equal(find('특강비')?.[1], '200000');
  assert.equal(find('입학금')?.[1], '0');
  const total = find('합계')?.[1];
  assert.equal(total, '1280000');

  // 같은 해 사업장현황신고서의 수입금액 합계와 같아야 한다
  const summary = parse(buildRevenueSummaryCsv(payments, 2026));
  assert.equal(summary.find((r) => r[0] === '수입금액 합계')?.[1], total);

  const lesson = rows.findIndex((r) => r[0] === '교습현황 (수강료)');
  const units = rows.slice(lesson + 2, lesson + 5).map((r) => r.slice(0, 3));
  assert.deepEqual(units, [
    ['300000', '1', '300000'],
    ['250000', '3', '750000'], // 김 1·2월, 이 1월(분납 합침)
    ['0', '0', '0'], // 이 2월: 냈다가 돌려줌
  ]);
  const lessonTotal = rows.slice(lesson).find((r) => r[0] === '합계')!;
  assert.deepEqual(lessonTotal.slice(0, 3), ['합계', '4', '1050000'], '단가별 합이 수강료 합계와 같다');
});
