import { DayOfWeek, DaySchedule, Student } from '../types';
import { formatTimeLabel } from './date';

export const DAYS: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const DAY_LABEL: Record<DayOfWeek, string> = {
  Mon: '월',
  Tue: '화',
  Wed: '수',
  Thu: '목',
  Fri: '금',
  Sat: '토',
  Sun: '일',
};

const isTimeString = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value.trim());

/**
 * 그 요일의 수업 시간. dayTimes에 없으면 기본 시간으로 떨어진다.
 *
 * '월 2시, 수 5시'처럼 요일마다 시간이 다른 반이 흔한데 시간을 하나만 두면
 * 둘 중 하나는 늘 틀린 값이 되고, 등원 판정이 그 값을 그대로 쓰기 때문에
 * 정상 등원이 조용히 '예외'로 기록된다.
 */
export const timesForDay = (student: Student, day: DayOfWeek): DaySchedule => {
  const override = student.dayTimes?.[day];
  if (override && isTimeString(override.start) && isTimeString(override.end)) {
    return override;
  }
  return { start: student.scheduledStartTime, end: student.scheduledEndTime };
};

/** 요일마다 시간이 실제로 다른가. 원생 카드에서 표시를 나눌 때 쓴다. */
export const hasVaryingTimes = (student: Student): boolean => {
  const times = student.scheduledDays.map((day) => {
    const { start, end } = timesForDay(student, day);
    return `${start}-${end}`;
  });
  return new Set(times).size > 1;
};

/**
 * '월 2:00 PM – 4:00 PM' 형태의 줄. 요일마다 시간이 다를 때만 요일별로 나눈다.
 * 같으면 한 줄로 합쳐야 카드가 쓸데없이 길어지지 않는다.
 */
export const scheduleLines = (student: Student): string[] => {
  const ordered = DAYS.filter((day) => student.scheduledDays.includes(day));
  if (ordered.length === 0) return [];

  if (!hasVaryingTimes(student)) {
    const { start, end } = timesForDay(student, ordered[0]);
    return [`${formatTimeLabel(start)} – ${formatTimeLabel(end)}`];
  }

  return ordered.map((day) => {
    const { start, end } = timesForDay(student, day);
    return `${DAY_LABEL[day]} ${formatTimeLabel(start)} – ${formatTimeLabel(end)}`;
  });
};

/**
 * dayTimes를 DB/CSV용 한 줄 문자열로. 'Mon=14:00-16:00|Wed=17:00-19:00'
 *
 * 기본 시간과 같은 요일은 넣지 않는다. 저장된 값이 곧 '다른 시간'의 목록이라야
 * 나중에 기본 시간을 고쳤을 때 낡은 사본이 남지 않는다.
 */
export const serializeDayTimes = (student: {
  scheduledDays: DayOfWeek[];
  scheduledStartTime: string;
  scheduledEndTime: string;
  dayTimes?: Partial<Record<DayOfWeek, DaySchedule>>;
}): string | null => {
  const parts: string[] = [];

  for (const day of DAYS) {
    if (!student.scheduledDays.includes(day)) continue;
    const value = student.dayTimes?.[day];
    if (!value || !isTimeString(value.start) || !isTimeString(value.end)) continue;
    if (value.start === student.scheduledStartTime && value.end === student.scheduledEndTime) {
      continue;
    }
    parts.push(`${day}=${value.start}-${value.end}`);
  }

  return parts.length ? parts.join('|') : null;
};

/** serializeDayTimes의 역. 깨진 항목은 조용히 버린다. */
export const parseDayTimes = (
  raw: unknown
): Partial<Record<DayOfWeek, DaySchedule>> | undefined => {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;

  const result: Partial<Record<DayOfWeek, DaySchedule>> = {};

  for (const chunk of raw.split('|')) {
    const [day, range] = chunk.split('=');
    const key = day?.trim() as DayOfWeek;
    if (!DAYS.includes(key) || !range) continue;

    const [start, end] = range.split('-');
    if (!isTimeString(start) || !isTimeString(end)) continue;

    result[key] = { start: start.trim(), end: end.trim() };
  }

  return Object.keys(result).length ? result : undefined;
};
