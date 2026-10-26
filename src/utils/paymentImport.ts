import Papa from 'papaparse';
import { Payment, PaymentKind, PaymentMethod, Student } from '../types';
import { createId } from './id';
import { readAmount, readDate, readFlag, readMonth } from './sheet';
import { KIND_LABEL, METHOD_LABEL } from './tax';

/**
 * 수납 기록 가져오기.
 *
 * 형식은 앱이 내보내는 수납 장부(utils/tax의 buildPaymentLedgerCsv)와 같다. 그래서
 *   - 엑셀 양식(templates/)의 '수납' 시트를 CSV로 저장해 가져올 수 있고,
 *   - 앱에서 내보낸 장부를 다른 기기나 새로 설치한 앱에 그대로 가져올 수 있다.
 * 장부에만 있는 칸(학년, 신고구분)은 읽지 않는다 — 다른 칸에서 다시 계산되는 값이다.
 *
 * 원생은 이름과 구분(동명이인 꼬리표)으로 찾는다. 이 앱에는 학번이 없어서 그것이 전부다.
 * 같은 이름이 둘인데 구분이 비어 있으면 누구 돈인지 정할 수 없어 건너뛴다.
 *
 * 같은 기록을 두 번 가져와도 두 번 들어가지 않는다. 받은 날·원생·금액·수입구분·결제수단·
 * 수강월이 모두 같은 줄은 이미 있는 것으로 본다. 같은 날 같은 금액을 두 번 받는 일은
 * 드물고, 엑셀에서 고쳐 다시 가져오는 일은 흔하다 — 앞쪽이 틀리는 편이 덜 아프다.
 */
export const PAYMENT_HEADERS = {
  paidOn: '받은날',
  month: '수강월',
  name: '원생',
  note: '구분',
  kind: '수입구분',
  amount: '금액',
  method: '결제수단',
  cashReceipt: '현금영수증',
  preschool: '미취학',
  memo: '메모',
} as const;

/** 엑셀 양식에서 고를 수 있게 둔 말. 앱이 내보내는 말(KIND_LABEL, METHOD_LABEL)도 받는다. */
const KIND_WORDS: Record<string, PaymentKind> = {
  ...Object.fromEntries(Object.entries(KIND_LABEL).map(([k, v]) => [v, k as PaymentKind])),
  수업료: 'tuition',
  교재비: 'materials',
  교재: 'materials',
  모의고사: 'exam',
  특강: 'special',
  입회비: 'admission',
  기타: 'other',
};

const METHOD_WORDS: Record<string, PaymentMethod> = {
  ...Object.fromEntries(Object.entries(METHOD_LABEL).map(([k, v]) => [v, k as PaymentMethod])),
  신용카드: 'card',
  체크카드: 'card',
  이체: 'transfer',
  계좌: 'transfer',
  무통장: 'transfer',
  무통장입금: 'transfer',
};

const squash = (value: string | undefined) => (value ?? '').replace(/\s+/g, '');

export interface PaymentImportResult {
  payments: Payment[];
  /** 이미 있거나 파일 안에서 겹친 줄 수 */
  duplicates: number;
  /** 형식이 맞지 않거나 원생을 찾지 못한 줄. 1-based 행 번호와 사유. */
  skipped: { row: number; reason: string }[];
}

const keyOf = (p: Pick<Payment, 'studentId' | 'paidOn' | 'amount' | 'kind' | 'method' | 'month'>) =>
  [p.studentId, p.paidOn, p.amount, p.kind, p.method, p.month].join('|');

/**
 * @param students 지운 원생은 빼고 넘긴다. 퇴원생은 넣는다 — 다니던 동안의 돈이다.
 * @param existing 이미 기록된 수납 (지운 것 빼고). 겹치는 줄을 거른다.
 */
export const parsePaymentsCsv = (
  text: string,
  students: Student[],
  existing: Payment[]
): PaymentImportResult => {
  const parsed = Papa.parse<Record<string, string | undefined>>(text.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });

  const fields = parsed.meta.fields ?? [];
  const hasPreschoolColumn = fields.includes(PAYMENT_HEADERS.preschool);

  const byName = new Map<string, Student[]>();
  for (const student of students) {
    const key = squash(student.name);
    byName.set(key, [...(byName.get(key) ?? []), student]);
  }

  const seen = new Set(existing.filter((p) => !p.deletedAt).map(keyOf));
  const payments: Payment[] = [];
  const skipped: PaymentImportResult['skipped'] = [];
  let duplicates = 0;

  if (!fields.includes(PAYMENT_HEADERS.paidOn) || !fields.includes(PAYMENT_HEADERS.name)) {
    return {
      payments,
      duplicates,
      skipped: [
        {
          row: 1,
          reason: `머리글에 '${PAYMENT_HEADERS.paidOn}'과 '${PAYMENT_HEADERS.name}'이 있어야 합니다.`,
        },
      ],
    };
  }

  parsed.data.forEach((row, index) => {
    const rowNumber = index + 2;
    const skip = (reason: string) => skipped.push({ row: rowNumber, reason });

    const name = row[PAYMENT_HEADERS.name]?.trim() ?? '';
    // 엑셀 표의 맨 아래 합계 줄처럼 이름 없이 금액만 있는 줄은 조용히 넘긴다.
    if (!name) {
      if (Object.values(row).some((v) => (v ?? '').trim())) skip('원생 이름이 비어 있습니다.');
      return;
    }

    const paidOn = readDate(row[PAYMENT_HEADERS.paidOn]);
    if (!paidOn) return skip(`받은날을 날짜로 읽을 수 없습니다: '${row[PAYMENT_HEADERS.paidOn] ?? ''}'`);

    const amount = readAmount(row[PAYMENT_HEADERS.amount]);
    if (amount === null || amount === 0) return skip('금액이 비어 있거나 숫자가 아닙니다.');

    const methodWord = squash(row[PAYMENT_HEADERS.method]);
    const method = METHOD_WORDS[methodWord];
    if (!method) return skip(`결제수단은 카드·계좌이체·현금 중 하나여야 합니다: '${methodWord}'`);

    const kindWord = squash(row[PAYMENT_HEADERS.kind]);
    const kind: PaymentKind | undefined = kindWord ? KIND_WORDS[kindWord] : 'tuition';
    if (!kind) return skip(`수입구분을 알 수 없습니다: '${kindWord}'`);

    const monthText = row[PAYMENT_HEADERS.month]?.trim();
    const month = monthText ? readMonth(monthText) : paidOn.slice(0, 7);
    if (!month) return skip(`수강월을 읽을 수 없습니다: '${monthText}'`);

    const note = row[PAYMENT_HEADERS.note]?.trim() ?? '';
    const candidates = byName.get(squash(name)) ?? [];
    // 구분이 비어 있으면 구분 없는 원생을 먼저 본다. 양식은 동명이인 중 한 명에게만 구분을
    // 적어도 되게 안내하고, 엑셀의 월별 현황도 같은 방식으로 더한다.
    const noteless = candidates.filter((s) => !s.note?.trim());
    const matches = note
      ? candidates.filter((s) => squash(s.note ?? '') === squash(note))
      : candidates.length > 1 && noteless.length === 1
        ? noteless
        : candidates;
    if (matches.length === 0) {
      return skip(
        candidates.length > 0
          ? `'${name}' 중 구분이 '${note}'인 원생이 없습니다.`
          : `'${name}' 원생이 없습니다. 원생을 먼저 등록하거나 가져오세요.`
      );
    }
    if (matches.length > 1) {
      return skip(`'${name}'이 ${matches.length}명이라 누구인지 정할 수 없습니다. 구분 칸을 채워 주세요.`);
    }
    const student = matches[0];

    const payment: Payment = {
      id: createId(),
      studentId: student.id,
      paidOn,
      month,
      amount,
      kind,
      method,
      // 카드에는 현금영수증이 없다. 장부의 '-'도 여기서 걸러진다.
      cashReceipt: method !== 'card' && readFlag(row[PAYMENT_HEADERS.cashReceipt]),
      // 장부에서 온 파일은 받은 순간의 값을 그대로 쓴다. 칸이 없으면 지금 원생 표시를 따른다.
      preschool: hasPreschoolColumn
        ? readFlag(row[PAYMENT_HEADERS.preschool])
        : Boolean(student.preschool),
      note: row[PAYMENT_HEADERS.memo]?.trim() || null,
    };

    const key = keyOf(payment);
    if (seen.has(key)) {
      duplicates += 1;
      return;
    }
    seen.add(key);
    payments.push(payment);
  });

  return { payments, duplicates, skipped };
};
