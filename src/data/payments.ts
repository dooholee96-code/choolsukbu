import type { SQLiteDatabase } from 'expo-sqlite';
import { Payment, PaymentKind, PaymentMethod } from '../types';
import { stamp } from './stamp';

const METHODS: PaymentMethod[] = ['card', 'transfer', 'cash'];
const KINDS: PaymentKind[] = ['tuition', 'special', 'admission', 'materials', 'exam', 'other'];

type Row = Omit<Payment, 'cashReceipt' | 'preschool' | 'method' | 'kind'> & {
  method: string;
  kind: string | null;
  cashReceipt: number | null;
  preschool: number | null;
};

/**
 * SQLite에는 boolean이 없어 0/1로 돌아온다. 모르는 결제수단은 '현금'으로 본다 —
 * 신고에서 가장 보수적인 쪽('기타 매출')으로 떨어지게 하려는 것이다.
 */
const toPayment = (row: Row): Payment => ({
  ...row,
  method: METHODS.includes(row.method as PaymentMethod) ? (row.method as PaymentMethod) : 'cash',
  kind: KINDS.includes(row.kind as PaymentKind) ? (row.kind as PaymentKind) : 'tuition',
  cashReceipt: Boolean(row.cashReceipt),
  preschool: Boolean(row.preschool),
  note: row.note ?? null,
});

/** 수납 화면: 그 달 수강료로 받은 것들 (month 기준). */
export const listForMonth = async (db: SQLiteDatabase, month: string): Promise<Payment[]> => {
  const rows = await db.getAllAsync<Row>(
    'SELECT * FROM payment WHERE month = ? AND deletedAt IS NULL ORDER BY paidOn, updatedAt;',
    month
  );
  return rows.map(toPayment);
};

/** 신고 자료: 받은 날이 그 기간 안인 것들 (paidOn 기준). 양 끝을 포함한다. */
export const listPaidBetween = async (
  db: SQLiteDatabase,
  fromDate: string,
  toDate: string
): Promise<Payment[]> => {
  const rows = await db.getAllAsync<Row>(
    'SELECT * FROM payment WHERE paidOn >= ? AND paidOn <= ? AND deletedAt IS NULL ORDER BY paidOn, updatedAt;',
    fromDate,
    toDate
  );
  return rows.map(toPayment);
};

/**
 * 그 원생이 마지막으로 낸 결제수단. 한 집은 대개 매달 같은 방법으로 낸다.
 * 앱 전체에서 마지막으로 쓴 방법을 기본값으로 두면, 방금 다른 집에서 현금을 받은
 * 탓에 카드로 내는 집이 현금으로 잘못 적힌다 — 그대로 신고 자료가 된다.
 */
export const lastMethodFor = async (
  db: SQLiteDatabase,
  studentId: string
): Promise<PaymentMethod | null> => {
  const row = await db.getFirstAsync<{ method: string }>(
    // 수강료만 본다. 교재비를 현금으로 한 번 냈다고 수강료 기본값이 현금이 되면 안 된다.
    `SELECT method FROM payment WHERE studentId = ? AND deletedAt IS NULL AND (kind IS NULL OR kind = 'tuition')
     ORDER BY paidOn DESC, updatedAt DESC LIMIT 1;`,
    studentId
  );
  return row && METHODS.includes(row.method as PaymentMethod) ? (row.method as PaymentMethod) : null;
};

/** 동기화 전용. 묘비까지 전부. */
export const listPaymentsIncludingDeleted = async (db: SQLiteDatabase): Promise<Payment[]> => {
  const rows = await db.getAllAsync<Row>('SELECT * FROM payment;');
  return rows.map((row) => ({ ...toPayment(row), deletedAt: row.deletedAt ?? null }));
};

/** 카드에는 현금영수증이 없다. 화면이 잘못 넘겨도 신고 분류가 꼬이지 않게 여기서 끈다. */
const receiptFor = (payment: Pick<Payment, 'method' | 'cashReceipt'>) =>
  payment.method !== 'card' && payment.cashReceipt ? 1 : 0;

export const insertPayment = (db: SQLiteDatabase, payment: Payment) =>
  db.runAsync(
    `INSERT INTO payment (id, studentId, paidOn, month, amount, kind, method, cashReceipt, preschool, note, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    payment.id,
    payment.studentId,
    payment.paidOn,
    payment.month,
    Math.round(payment.amount),
    payment.kind,
    payment.method,
    receiptFor(payment),
    payment.preschool ? 1 : 0,
    payment.note?.trim() || null,
    stamp()
  );

/**
 * 고치기. 원생(studentId)과 미취학 표시는 바꾸지 않는다 — 미취학은 받은 순간의 사실이라
 * 나중에 원생 정보를 고쳐도 따라 바뀌면 안 된다.
 */
export const updatePaymentRow = (db: SQLiteDatabase, payment: Payment) =>
  db.runAsync(
    'UPDATE payment SET paidOn = ?, month = ?, amount = ?, kind = ?, method = ?, cashReceipt = ?, note = ?, updatedAt = ? WHERE id = ?;',
    payment.paidOn,
    payment.month,
    Math.round(payment.amount),
    payment.kind,
    payment.method,
    receiptFor(payment),
    payment.note?.trim() || null,
    stamp(),
    payment.id
  );

export const softDeletePayment = (db: SQLiteDatabase, paymentId: string) => {
  const now = stamp();
  return db.runAsync(
    'UPDATE payment SET deletedAt = ?, updatedAt = ? WHERE id = ?;',
    now,
    now,
    paymentId
  );
};
