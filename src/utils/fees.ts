import { FeeRule, Student } from '../types';

/**
 * 학년 글자를 숫자로. 초등은 1~6, 중학생은 7~9, 고등학생은 10~12.
 * '초3', '3', '3학년' → 3 · '중1' → 7 · '고2' → 11. 숫자가 없으면(예: '7세') null.
 *
 * 'N세'는 미취학 나이라 학년이 아니다. 학년 조건이 있는 줄에는 맞지 않는다.
 */
export const gradeNumber = (grade: string): number | null => {
  const text = grade.trim();
  if (/세/.test(text)) return null;
  const match = /(\d+)/.exec(text);
  if (!match) return null;
  const n = Number(match[1]);
  if (text.startsWith('중')) return n + 6;
  if (text.startsWith('고')) return n + 9;
  return n;
};

const conditions = (rule: FeeRule) =>
  (rule.perWeek != null ? 1 : 0) + (rule.gradeFrom != null ? 1 : 0) + (rule.gradeTo != null ? 1 : 0);

/**
 * 원생에게 맞는 기준 줄. 맞는 줄이 여럿이면 조건을 더 많이 채운 줄, 그것도 같으면 위에
 * 있는 줄. 맞는 줄이 없으면 null — 그때는 수강료를 비워 두고 사람이 적는다.
 */
export const matchFeeRule = (
  rules: FeeRule[] | undefined,
  student: Pick<Student, 'grade' | 'scheduledDays'>
): FeeRule | null => {
  if (!rules?.length) return null;
  const perWeek = student.scheduledDays.length;
  const grade = gradeNumber(student.grade);

  let best: FeeRule | null = null;
  for (const rule of rules) {
    if (!(rule.fee > 0)) continue;
    if (rule.perWeek != null && rule.perWeek !== perWeek) continue;
    if (rule.gradeFrom != null && (grade == null || grade < rule.gradeFrom)) continue;
    if (rule.gradeTo != null && (grade == null || grade > rule.gradeTo)) continue;
    if (!best || conditions(rule) > conditions(best)) best = rule;
  }
  return best;
};

const gradeLabel = (n: number) => (n > 9 ? `고${n - 9}` : n > 6 ? `중${n - 6}` : `${n}학년`);

/** '주 3회 · 1~3학년' 처럼. 조건이 없으면 '모든 원생'. */
export const describeFeeRule = (rule: FeeRule): string => {
  const parts: string[] = [];
  if (rule.perWeek != null) parts.push(`주 ${rule.perWeek}회`);
  if (rule.gradeFrom != null && rule.gradeTo != null) {
    parts.push(
      rule.gradeFrom === rule.gradeTo
        ? gradeLabel(rule.gradeFrom)
        : `${gradeLabel(rule.gradeFrom)}~${gradeLabel(rule.gradeTo)}`
    );
  } else if (rule.gradeFrom != null) {
    parts.push(`${gradeLabel(rule.gradeFrom)} 이상`);
  } else if (rule.gradeTo != null) {
    parts.push(`${gradeLabel(rule.gradeTo)} 이하`);
  }
  return parts.length ? parts.join(' · ') : '모든 원생';
};

export const DEFAULT_CLASS_MINUTES = 60;
