import { Payment, PaymentMethod, Student } from '../types';

/**
 * 수납 화면의 한 달치 장부. 원생마다 받을 돈, 받은 돈, 그래서 무엇이 남았는지.
 *
 * 화면이 아니라 여기서 계산하는 이유: 미납 판정이 틀리면 받은 돈을 또 달라고 하거나
 * 못 받은 돈을 놓친다. 둘 다 학원에 실제로 일어나는 일이라 테스트로 붙잡아 둔다.
 */

export type LedgerStatus = 'unpaid' | 'partial' | 'paid' | 'noFee';

export interface LedgerEntry {
  student: Student;
  /** 받을 돈 (원생의 월 수강료). 정하지 않았으면 0. */
  expected: number;
  /**
   * 그 달 수강료로 받은 돈의 합. 환불은 빼고 더한다. 교재비·특강비 같은 다른 돈은
   * 넣지 않는다 — 교재비를 받았다고 수강료가 완납으로 보이면 안 된다.
   */
  paid: number;
  payments: Payment[];
  status: LedgerStatus;
}

/** 'YYYY-MM' 달을 delta만큼 옮긴다. */
export const shiftMonth = (month: string, delta: number): string => {
  const [year, m] = month.split('-').map(Number);
  const date = new Date(year, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

export const monthOf = (dateKey: string) => dateKey.slice(0, 7);

export const monthLabel = (month: string) => {
  const [year, m] = month.split('-').map(Number);
  return `${year}년 ${m}월`;
};

const statusOf = (expected: number, paid: number): LedgerStatus => {
  if (expected <= 0) return paid > 0 ? 'paid' : 'noFee';
  if (paid >= expected) return 'paid';
  return paid > 0 ? 'partial' : 'unpaid';
};

/** 손이 먼저 가야 할 순서: 안 낸 사람, 덜 낸 사람, 금액을 안 정한 사람, 다 낸 사람. */
const ORDER: Record<LedgerStatus, number> = { unpaid: 0, partial: 1, noFee: 2, paid: 3 };

/**
 * 그 달 장부에 올라갈 원생: 그 달 1일에 아직 다니던 원생, 그리고 퇴원했어도 그 달
 * 수강료를 받은 기록이 있는 원생. 1일 전에 퇴원한 학생까지 미납으로 띄우면 안 낼 돈을
 * 달라고 하게 된다.
 */
export const buildMonthLedger = (
  students: Student[],
  payments: Payment[],
  month: string
): LedgerEntry[] => {
  const firstDay = `${month}-01`;
  const byStudent = new Map<string, Payment[]>();
  for (const p of payments) {
    if (p.month !== month) continue;
    byStudent.set(p.studentId, [...(byStudent.get(p.studentId) ?? []), p]);
  }

  return students
    .filter(
      (student) =>
        !student.withdrawnAt || student.withdrawnAt > firstDay || byStudent.has(student.id)
    )
    .map((student) => {
      const list = byStudent.get(student.id) ?? [];
      const expected = student.fee ?? 0;
      const paid = list
        .filter((p) => p.kind === 'tuition')
        .reduce((sum, p) => sum + p.amount, 0);
      return { student, expected, paid, payments: list, status: statusOf(expected, paid) };
    })
    .sort(
      (a, b) =>
        ORDER[a.status] - ORDER[b.status] || a.student.name.localeCompare(b.student.name, 'ko')
    );
};

export interface LedgerSummary {
  expected: number;
  /** 수강료로 받은 돈. */
  paid: number;
  /** 수강료 말고 받은 돈 (교재비·특강비 등). */
  otherIncome: number;
  /** 아직 다 받지 못한 원생 수 (미납 + 일부). */
  outstanding: number;
  byMethod: Record<PaymentMethod, number>;
}

export const summarizeLedger = (entries: LedgerEntry[]): LedgerSummary => {
  const summary: LedgerSummary = {
    expected: 0,
    paid: 0,
    otherIncome: 0,
    outstanding: 0,
    byMethod: { card: 0, transfer: 0, cash: 0 },
  };
  for (const entry of entries) {
    summary.expected += entry.expected;
    summary.paid += entry.paid;
    if (entry.status === 'unpaid' || entry.status === 'partial') summary.outstanding += 1;
    for (const p of entry.payments) {
      summary.byMethod[p.method] += p.amount;
      if (p.kind !== 'tuition') summary.otherIncome += p.amount;
    }
  }
  return summary;
};

/** 1,250,000원 */
export const formatWon = (amount: number) => `${amount.toLocaleString('ko-KR')}원`;
