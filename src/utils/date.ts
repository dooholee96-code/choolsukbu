import { format, getDay } from 'date-fns';
import { DayOfWeek } from '../types';

export const getCurrentDate = () => format(new Date(), 'yyyy-MM-dd');
export const getCurrentTime = () => format(new Date(), 'HH:mm');

export const getDayOfWeek = (date: Date): DayOfWeek => {
  const days: DayOfWeek[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[getDay(date)];
};

/** 'HH:mm' 을 자정 기준 분으로. 형식이 어긋나면 null. */
const toMinutes = (time: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time?.trim() ?? '');
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
};

/**
 * time 이 [startTime, endTime] 안에 있는지 판정한다.
 *
 * 시작 > 종료인 구간(예: 22:00~01:00)은 자정을 넘는 수업으로 보고 처리한다.
 * 이전 구현은 두 시각을 모두 '오늘' 날짜로 파싱해 Interval을 만들었기 때문에
 * 이런 구간이 항상 뒤집힌 Interval이 되었고, date-fns v4의 isWithinInterval은
 * 그 경우 예외 없이 false를 돌려주므로 자정 넘는 수업이 조용히 전부
 * '예외 등원'으로 기록되고 있었다.
 */
export const isTimeWithinRange = (time: string, startTime: string, endTime: string): boolean => {
  const current = toMinutes(time);
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);

  if (current === null || start === null || end === null) return false;

  // 자정을 넘지 않는 일반 구간
  if (start <= end) return current >= start && current <= end;

  // 자정을 넘는 구간: 시작 이후이거나 종료 이전이면 구간 안
  return current >= start || current <= end;
};

/**
 * 'HH:mm' 을 'h:mm a' 표시용 문자열로. 파싱 실패 시 원본을 그대로 돌려준다.
 * (이전에는 new Date(`2000-01-01T${time}`)가 Invalid Date가 되면
 *  date-fns의 format이 RangeError를 던져 카드 렌더링이 통째로 깨졌다.)
 */
export const formatTimeLabel = (time: string): string => {
  const minutes = toMinutes(time);
  if (minutes === null) return time ?? '';

  return format(new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60), 'h:mm a');
};
