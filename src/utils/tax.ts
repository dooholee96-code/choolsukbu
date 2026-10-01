import Papa from 'papaparse';
import { Payment, PaymentKind, PaymentMethod, Student } from '../types';

/**
 * 받은 돈을 신고서가 묻는 모양으로 묶는다.
 *
 * 학원 수강료는 부가가치세 면세라, 학원은 해마다 2월 10일까지 지난해 수입금액을
 * '사업장현황신고'로 낸다. 학원은 이때 '학원사업자 수입금액검토표'(소득세법 시행규칙
 * 별지 제19호의5서식)를 함께 내야 한다. 이 파일이 두 서류의 숫자를 만든다.
 *
 * 1. 사업장현황신고서 — 수입금액 구성명세 (결제수단별)
 *      계산서 발행금액  이 앱에서는 다루지 않는다 (기업 위탁교육 등)
 *      신용카드 매출    카드로 받은 것
 *      현금영수증 매출  계좌이체·현금 중 현금영수증을 발급한 것
 *      기타 매출        현금영수증 없이 받은 계좌이체·현금
 *
 * 2. 학원사업자 수입금액검토표
 *      총수입금액 명세  수강료·특강비·입학금·교재대·모의고사비·기타 (PaymentKind)
 *      교습현황         수강단가(월 수강료)별 수강연인원과 총수강료
 *    검토표의 합계는 사업장현황신고서의 수입금액 합계와 같아야 한다. 같은 수납 기록에서
 *    나오므로 같다.
 *
 * 시설·직원·경비처럼 수납 기록에 없는 칸은 직접 채운다.
 *
 * 기간은 '받은 날'(paidOn)로 가른다. 12월 말에 받은 1월 수강료는 그 해 수입이다.
 *
 * 이 앱은 신고서를 대신 내지 않는다. 홈택스에 옮겨 적을 숫자와 그 근거(장부)를
 * 만든다. 정확한 항목과 첨부 서류는 해마다 홈택스 안내나 세무사에게 확인한다.
 */

export type RevenueCategory = 'card' | 'cashReceipt' | 'other';

export const categoryOf = (payment: Pick<Payment, 'method' | 'cashReceipt'>): RevenueCategory =>
  payment.method === 'card' ? 'card' : payment.cashReceipt ? 'cashReceipt' : 'other';

export const CATEGORY_LABEL: Record<RevenueCategory, string> = {
  card: '신용카드 매출',
  cashReceipt: '현금영수증 매출',
  other: '기타 매출',
};

/** 학원사업자 수입금액검토표 '총수입금액 명세'의 칸 이름 그대로. */
export const KIND_LABEL: Record<PaymentKind, string> = {
  tuition: '수강료',
  special: '특강비',
  admission: '입학금',
  materials: '교재대',
  exam: '모의고사비',
  other: '기타수입',
};

export const KINDS: PaymentKind[] = ['tuition', 'special', 'admission', 'materials', 'exam', 'other'];

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  card: '카드',
  transfer: '계좌이체',
  cash: '현금',
};

/**
 * 학원은 현금영수증 의무발행업종이다. 건당 10만 원 이상을 현금(계좌이체 포함)으로
 * 받으면 손님이 요청하지 않아도 발급해야 한다. 화면과 요약이 이 금액을 기준으로 알린다.
 */
export const CASH_RECEIPT_REQUIRED_FROM = 100_000;

export const needsCashReceipt = (payment: Pick<Payment, 'method' | 'cashReceipt' | 'amount'>) =>
  payment.method !== 'card' && !payment.cashReceipt && payment.amount >= CASH_RECEIPT_REQUIRED_FROM;

export interface RevenueTotals {
  card: number;
  cashReceipt: number;
  other: number;
  total: number;
  count: number;
}

export const emptyTotals = (): RevenueTotals => ({
  card: 0,
  cashReceipt: 0,
  other: 0,
  total: 0,
  count: 0,
});

/** 환불(음수)도 그대로 더한다. 돌려준 돈은 수입에서 빠져야 한다. */
export const sumRevenue = (payments: Payment[]): RevenueTotals =>
  payments.reduce((acc, payment) => {
    acc[categoryOf(payment)] += payment.amount;
    acc.total += payment.amount;
    acc.count += 1;
    return acc;
  }, emptyTotals());

const inYear = (payment: Payment, year: number) => payment.paidOn.startsWith(`${year}-`);

/** 1월부터 12월까지, 받은 날 기준. 받은 것이 없는 달도 0으로 채운다. */
export const monthlyRevenue = (payments: Payment[], year: number) =>
  Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, '0')}`;
    return { month, ...sumRevenue(payments.filter((p) => p.paidOn.startsWith(`${month}-`))) };
  });

/** CSV 앞에 붙이는 BOM. 없으면 엑셀이 한글을 깨서 연다. */
const BOM = '﻿';

const won = (amount: number) => String(Math.round(amount));

const nameOf = (byId: Map<string, Student>, studentId: string) =>
  byId.get(studentId)?.name ?? '(알 수 없는 원생)';

/**
 * 사업장현황신고용 요약. 홈택스의 수입금액 칸에 옮겨 적을 숫자다.
 *
 * 표가 둘이다 — 위는 연간 합계(신고서에 들어가는 숫자), 아래는 월별(맞는지
 * 확인할 때 카드사·통장 내역과 대조하는 숫자).
 */
export const buildRevenueSummaryCsv = (payments: Payment[], year: number): string => {
  const rows = payments.filter((p) => inYear(p, year));
  const totals = sumRevenue(rows);
  const missingReceipts = rows.filter(needsCashReceipt);

  const lines: (string | number)[][] = [
    [`${year}년 수입금액 (받은 날 기준 ${year}-01-01 ~ ${year}-12-31)`],
    ['항목', '금액(원)', '설명'],
    ['수입금액 합계', won(totals.total), `${totals.count}건 · 학원사업자 수입금액검토표 합계와 같아야 합니다`],
    ['계산서 발행금액', '0', '이 앱에서는 다루지 않습니다. 계산서를 발행한 수입이 있으면 직접 더하세요'],
    [CATEGORY_LABEL.card, won(totals.card), '카드 단말기로 받은 것'],
    [CATEGORY_LABEL.cashReceipt, won(totals.cashReceipt), '계좌이체·현금 중 현금영수증을 발급한 것'],
    [CATEGORY_LABEL.other, won(totals.other), '현금영수증 없이 받은 계좌이체·현금'],
    [],
    [
      '확인 필요: 현금영수증 없이 10만 원 이상 받은 건',
      missingReceipts.length,
      missingReceipts.length
        ? '학원은 현금영수증 의무발행업종입니다. 수납 장부에서 확인하세요.'
        : '없음',
    ],
    [],
    ['월', CATEGORY_LABEL.card, CATEGORY_LABEL.cashReceipt, CATEGORY_LABEL.other, '합계', '건수'],
    ...monthlyRevenue(rows, year).map((m) => [
      `${Number(m.month.slice(5))}월`,
      won(m.card),
      won(m.cashReceipt),
      won(m.other),
      won(m.total),
      m.count,
    ]),
    ['합계', won(totals.card), won(totals.cashReceipt), won(totals.other), won(totals.total), totals.count],
  ];

  return BOM + Papa.unparse(lines);
};

/**
 * 수납 장부. 받은 돈 한 건이 한 줄이다. 종합소득세 신고의 수입 근거이고, 요약의
 * 숫자가 어디서 왔는지 한 줄씩 따라갈 수 있다.
 *
 * students에는 삭제한 원생도 넘긴다. 지운 원생에게서 받은 돈도 그 해 수입이다.
 */
export const buildPaymentLedgerCsv = (payments: Payment[], students: Student[]): string => {
  const byId = new Map(students.map((s) => [s.id, s]));
  const sorted = [...payments].sort(
    (a, b) => a.paidOn.localeCompare(b.paidOn) || (a.updatedAt ?? '').localeCompare(b.updatedAt ?? '')
  );

  return (
    BOM +
    Papa.unparse(
      sorted.map((p) => ({
        받은날: p.paidOn,
        수강월: p.month,
        원생: nameOf(byId, p.studentId),
        학년: byId.get(p.studentId)?.grade ?? '',
        구분: byId.get(p.studentId)?.note ?? '',
        수입구분: KIND_LABEL[p.kind],
        금액: won(p.amount),
        결제수단: METHOD_LABEL[p.method],
        현금영수증: p.method === 'card' ? '-' : p.cashReceipt ? '발급' : '미발급',
        신고구분: CATEGORY_LABEL[categoryOf(p)],
        미취학: p.preschool ? '예' : '',
        메모: p.note ?? '',
      })),
      {
        columns: [
          '받은날',
          '수강월',
          '원생',
          '학년',
          '구분',
          '수입구분',
          '금액',
          '결제수단',
          '현금영수증',
          '신고구분',
          '미취학',
          '메모',
        ],
      }
    )
  );
};

/**
 * 미취학 아동 교육비. 초등학교 입학 전 아이의 학원비는 보호자가 교육비 세액공제를
 * 받는데, 연말정산 간소화에 나오지 않는다. 그래서 보호자가 학원에 '교육비납입증명서'를
 * 받아 회사에 낸다. 이 파일은 그 증명서를 채울 자료다 — 위는 원생별 한 해 합계,
 * 아래는 납입일·금액 한 줄씩.
 *
 * 주민등록번호·주소 칸은 비워 둔다. 이 앱은 그런 정보를 받지도 담지도 않는다.
 * 증명서를 쓸 때 보호자에게 받아 직접 채운다.
 *
 * '미취학'은 받은 순간의 표시(Payment.preschool)를 따른다. 3월에 입학한 아이의
 * 1·2월 납부액만 들어간다.
 */
export const buildPreschoolCsv = (payments: Payment[], students: Student[], year: number): string => {
  const byId = new Map(students.map((s) => [s.id, s]));
  const grouped = new Map<string, Payment[]>();
  for (const p of payments) {
    if (!p.preschool || !inYear(p, year)) continue;
    grouped.set(p.studentId, [...(grouped.get(p.studentId) ?? []), p]);
  }

  const rows = [...grouped.entries()]
    .map(([studentId, list]) => {
      const dates = list.map((p) => p.paidOn).sort();
      return {
        원생: nameOf(byId, studentId),
        학년: byId.get(studentId)?.grade ?? '',
        구분: byId.get(studentId)?.note ?? '',
        납부건수: list.length,
        연간납부액: won(list.reduce((sum, p) => sum + p.amount, 0)),
        첫납부일: dates[0],
        마지막납부일: dates[dates.length - 1],
        '원생 주민등록번호(직접 기입)': '',
        '납부자(보호자) 성명(직접 기입)': '',
        '납부자 주민등록번호(직접 기입)': '',
      };
    })
    .sort((a, b) => a.원생.localeCompare(b.원생, 'ko'));

  const summary = Papa.unparse(rows, {
    columns: [
      '원생',
      '학년',
      '구분',
      '납부건수',
      '연간납부액',
      '첫납부일',
      '마지막납부일',
      '원생 주민등록번호(직접 기입)',
      '납부자(보호자) 성명(직접 기입)',
      '납부자 주민등록번호(직접 기입)',
    ],
  });

  const details = [...grouped.values()]
    .flat()
    .sort(
      (a, b) =>
        nameOf(byId, a.studentId).localeCompare(nameOf(byId, b.studentId), 'ko') ||
        a.paidOn.localeCompare(b.paidOn)
    )
    .map((p) => [nameOf(byId, p.studentId), p.paidOn, p.month, KIND_LABEL[p.kind], won(p.amount)]);

  return (
    BOM +
    summary +
    '\r\n\r\n' +
    Papa.unparse([['납입 내역'], ['원생', '납입일', '수강월', '수입구분', '금액'], ...details])
  );
};

/**
 * 학원사업자 수입금액검토표에 옮길 숫자. 사업장현황신고 때 함께 낸다.
 *
 * - 총수입금액 명세: 그 해(받은 날 기준) 수입을 수입구분별로.
 * - 교습현황: 수강료만. 수강연인원은 '매월 실제 수강인원의 합계'이고, 수강단가는 월
 *   수강료가 다르면 단가별로 나눠 적는다. 그래서 (원생, 수강월)마다 받은 수강료를
 *   더해 그것을 그 달의 단가로 보고, 같은 단가끼리 몇 명·달이었는지 센다.
 *   단가별 총수강료를 더하면 총수입금액 명세의 수강료와 같다.
 *
 * 과목명·개강횟수·정원, 직원현황, 시설, 주요 경비는 수납 기록에 없어서 비워 둔다.
 */
export const buildAcademyReviewCsv = (payments: Payment[], year: number): string => {
  const rows = payments.filter((p) => inYear(p, year));
  const total = rows.reduce((sum, p) => sum + p.amount, 0);
  const byKind = (kind: PaymentKind) =>
    rows.filter((p) => p.kind === kind).reduce((sum, p) => sum + p.amount, 0);

  // (원생, 수강월)마다 그 달 수강료. 분납은 합쳐서 한 달 한 사람이다.
  const perStudentMonth = new Map<string, number>();
  for (const p of rows) {
    if (p.kind !== 'tuition') continue;
    const key = `${p.studentId}|${p.month}`;
    perStudentMonth.set(key, (perStudentMonth.get(key) ?? 0) + p.amount);
  }
  const byUnit = new Map<number, { headcount: number; sum: number }>();
  for (const amount of perStudentMonth.values()) {
    const current = byUnit.get(amount) ?? { headcount: 0, sum: 0 };
    // 다 돌려준 달(0 이하)은 수강한 달이 아니다. 금액은 맞추되 사람은 세지 않는다.
    byUnit.set(amount, {
      headcount: current.headcount + (amount > 0 ? 1 : 0),
      sum: current.sum + amount,
    });
  }
  const units = [...byUnit.entries()].sort((a, b) => b[0] - a[0]);
  const headcount = units.reduce((sum, [, u]) => sum + u.headcount, 0);

  const lines: (string | number)[][] = [
    [`${year}년 학원사업자 수입금액검토표 자료 (받은 날 기준 ${year}-01-01 ~ ${year}-12-31)`],
    [],
    ['총수입금액 명세'],
    ['구분', '금액(원)', '설명'],
    ...KINDS.map((kind) => [KIND_LABEL[kind], won(byKind(kind)), '']),
    ['고용보험 기금 등 지원금액', '0', '이 앱에서는 다루지 않습니다. 받은 지원금이 있으면 직접 더하세요'],
    ['합계', won(total), '사업장현황신고서의 수입금액 합계와 같아야 합니다'],
    [],
    ['교습현황 (수강료)'],
    ['수강단가(월)', '수강연인원', '총수강료(원)', '설명'],
    ...units.map(([unit, u]) => [
      won(unit),
      u.headcount,
      won(u.sum),
      unit > 0 ? '' : '환불로 0원 이하가 된 달 — 인원에서 뺐습니다',
    ]),
    ['합계', headcount, won(byKind('tuition')), '수강연인원은 매월 실제 수강인원의 합계입니다'],
    [],
    ['직접 채울 칸', '', '', '과목명(과정명)·개강횟수·정원, 직원현황, 사업장 시설, 주요 기본경비'],
  ];

  return BOM + Papa.unparse(lines);
};
