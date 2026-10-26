import { addDays, subDays } from 'date-fns';
import { Attendance, ScheduleException, Student } from '../types';
import { fromDateKey, toDateKey } from './date';
import { buildRoster } from './roster';

/**
 * '결석만 표시' 출석의 계산. 화면도 DB도 모르는 순수 함수만 둔다 (DB 쪽은 data/presence).
 *
 * 이 방식에서는 원장이 빠진 아이만 누른다. 누르지 않은 아이는 그 날 수업에 온 것이다.
 * 그 사실을 날이 지난 뒤에 '시각 없는 정상 출석'으로 남겨, 이력·CSV·출석 수가 등원을
 * 하나씩 누르던 때와 같은 모양으로 읽히게 한다.
 *
 * 오늘은 채우지 않는다. 오늘은 아직 결석이 생길 수 있는 날이다.
 */

/** 이만큼 지난 날까지만 채운다. 앱을 오래 안 열었을 때 한 번에 너무 많이 쓰지 않게. */
export const PRESENCE_LOOKBACK_DAYS = 92;

/**
 * 자동 출석의 id. 학생과 날짜로 정해진다.
 *
 * 두 기기가 같은 날을 각자 채워도 같은 행이 되어 병합에서 하나로 합쳐진다. 그리고 한 번
 * 지운 자동 출석(이력에서 지움)은 묘비가 이 id를 차지하고 있어서 다시 채워지지 않는다.
 */
export const autoPresenceId = (studentId: string, date: string) => `auto:${studentId}:${date}`;

export const isAutoPresence = (row: Pick<Attendance, 'id'>) => row.id.startsWith('auto:');

/**
 * 자동 출석의 updatedAt. 그 날이 시작되기 전 시각(전날 0시 UTC)으로 둔다.
 *
 * 병합은 늦은 쪽이 이긴다. 자동 출석을 채운 시각(다음 날 아침)으로 두면, 다른 기기에서
 * 그 날 낮에 누른 결석이 아직 넘어오지 않은 사이에 채운 자동 출석이 결석을 이긴다 —
 * 빠진 아이가 출석으로 남는다. 그 날 사람이 남긴 기록은 언제나 이보다 늦으므로 늘 이긴다.
 * 어느 기기에서 채워도 같은 값이라 두 기기의 행이 글자 하나까지 같다.
 */
export const autoPresenceStamp = (date: string) =>
  `${toDateKey(subDays(fromDateKey(date), 1))}T00:00:00.000Z`;

/** 채울 날짜 범위. 채울 날이 없으면 null. */
export const presenceRange = (
  since: string | null | undefined,
  today: string
): { from: string; to: string } | null => {
  if (!since) return null;
  const to = toDateKey(subDays(fromDateKey(today), 1));
  const floor = toDateKey(subDays(fromDateKey(today), PRESENCE_LOOKBACK_DAYS));
  const from = since > floor ? since : floor;
  return from <= to ? { from, to } : null;
};

/** from부터 to까지 하루씩 ('YYYY-MM-DD'). */
export const datesBetween = (from: string, to: string): string[] => {
  const dates: string[] = [];
  for (let day = fromDateKey(from); toDateKey(day) <= to; day = addDays(day, 1)) {
    dates.push(toDateKey(day));
  }
  return dates;
};

const later = (iso: string) => new Date(new Date(iso).getTime() + 1).toISOString();

export interface PresencePlanInput {
  /** 지운 원생은 빼고, 퇴원생은 넣는다 (퇴원일 전 명단에는 있어야 한다). */
  students: Student[];
  /** 범위 안의 일정 예외 (지운 것 빼고). */
  exceptions: ScheduleException[];
  /** 범위 안의 정규 출결(checkIn) 행. **지운 것까지** 넣는다. */
  existing: Attendance[];
  dates: string[];
}

/**
 * 채워 넣을 자동 출석 행들.
 *
 * 그 날 그 학생의 살아 있는 기록(등원·예외 등원·결석)이 있으면 손대지 않는다. 사람이
 * 남긴 것이 늘 우선이다.
 *
 * 지운 기록만 있으면 — 결석을 눌렀다가 그 날 취소한 경우 — 출석으로 채우되, 그 묘비보다
 * 1ms 늦게 단다. 그렇지 않으면 병합에서 묘비가 자동 출석을 이기고 지우고, 다음 실행이
 * 다시 채우고, 또 지우기를 동기화마다 되풀이한다.
 */
export const planPresence = ({
  students,
  exceptions,
  existing,
  dates,
}: PresencePlanInput): Attendance[] => {
  const byKey = new Map<string, Attendance[]>();
  for (const row of existing) {
    if (row.type !== 'checkIn') continue;
    const key = `${row.studentId}|${row.date}`;
    const list = byKey.get(key);
    if (list) list.push(row);
    else byKey.set(key, [row]);
  }

  const exceptionsByDate = new Map<string, ScheduleException[]>();
  for (const rule of exceptions) {
    const list = exceptionsByDate.get(rule.date);
    if (list) list.push(rule);
    else exceptionsByDate.set(rule.date, [rule]);
  }

  const planned: Attendance[] = [];

  for (const date of dates) {
    const roster = buildRoster(students, exceptionsByDate.get(date) ?? [], fromDateKey(date));

    for (const entry of roster) {
      const studentId = entry.student.id;
      const id = autoPresenceId(studentId, date);
      const rows = byKey.get(`${studentId}|${date}`) ?? [];

      if (rows.some((row) => !row.deletedAt)) continue;
      // 이미 한 번 채웠다가 지운 것. 지운 사람의 판단을 따른다.
      if (rows.some((row) => row.id === id)) continue;

      const base = autoPresenceStamp(date);
      const newestTombstone = rows.reduce(
        (max, row) => ((row.updatedAt ?? '') > max ? (row.updatedAt as string) : max),
        ''
      );

      planned.push({
        id,
        studentId,
        date,
        // 언제 왔는지는 모른다. 지어내지 않고 비워 둔다 — 화면은 빈 시각을 그리지 않는다.
        time: '',
        status: 'scheduled',
        type: 'checkIn',
        leaveTime: null,
        updatedAt: newestTombstone > base ? later(newestTombstone) : base,
        deletedAt: null,
      });
    }
  }

  return planned;
};
