import { format, getDay, isValid, parse } from 'date-fns';
import { ko } from 'date-fns/locale';
import { DayOfWeek } from '../types';

/** Date를 'YYYY-MM-DD'로. 저장된 날짜 문자열과 비교할 수 있는 유일한 형태다. */
export const toDateKey = (date: Date) => format(date, 'yyyy-MM-dd');

export const getCurrentDate = () => toDateKey(new Date());
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
/**
 * 'YYYY-MM-DD' 를 '8월 7일 (금)' 로. 파싱 실패 시 원본을 그대로 돌려준다.
 * 보충 목록에서는 요일이 있어야 일정을 잡을 수 있어 함께 표시한다.
 */
export const formatDateLabel = (date: string): string => {
  const parsed = parse(date ?? '', 'yyyy-MM-dd', new Date());
  if (!isValid(parsed)) return date ?? '';

  return format(parsed, 'M월 d일 (E)', { locale: ko });
};

/** 90 → '1시간 30분', 45 → '45분', 120 → '2시간' */
const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}분`;
  return rest ? `${hours}시간 ${rest}분` : `${hours}시간`;
};

/** 이 정도 차이는 굳이 알릴 것이 없다. 몇 분 차이마다 라벨이 붙으면 눈이 피곤하다. */
const NOTABLE_OFFSET_MINUTES = 10;

/**
 * 실제 도착이 예정 시작 시각보다 얼마나 이르거나 늦었는지. 차이가 작으면 null.
 *
 * 자정을 넘는 수업(22:00 시작)에서 00:30 도착 같은 경우 단순 뺄셈은
 * '21시간 30분 일찍'이 되므로, 12시간을 넘는 차이는 반대쪽으로 감아 해석한다.
 */
export const arrivalOffsetLabel = (
  actualTime: string,
  scheduledStartTime: string
): string | null => {
  const diff = signedOffset(actualTime, scheduledStartTime);
  if (diff === null || Math.abs(diff) < NOTABLE_OFFSET_MINUTES) return null;

  return `${formatDuration(Math.abs(diff))} ${diff > 0 ? '늦음' : '일찍'}`;
};

/**
 * 두 시각의 차이를 분으로. 늦으면 양수.
 *
 * 자정을 넘는 수업(22:00 시작)에서 00:30은 단순 뺄셈이면 '21시간 30분 이르다'가
 * 되므로, 12시간을 넘는 차이는 반대쪽으로 감아 해석한다.
 */
const signedOffset = (actualTime: string, referenceTime: string): number | null => {
  const actual = toMinutes(actualTime);
  const reference = toMinutes(referenceTime);
  if (actual === null || reference === null) return null;

  let diff = actual - reference;
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return diff;
};

/**
 * 하원이 예정 종료보다 얼마나 이르거나 늦었는지. 차이가 작으면 null.
 *
 * 일찍 간 쪽에만 '조퇴'를 붙인다. 남아서 더 있다 간 것은 알려줄 값이긴 해도
 * 부모에게 설명할 일이 생기는 쪽은 항상 일찍 간 날이다.
 */
export const departureOffsetLabel = (
  actualTime: string,
  scheduledEndTime: string
): string | null => {
  const diff = signedOffset(actualTime, scheduledEndTime);
  if (diff === null || Math.abs(diff) < NOTABLE_OFFSET_MINUTES) return null;

  return diff < 0
    ? `조퇴 · ${formatDuration(-diff)} 일찍`
    : `${formatDuration(diff)} 더 있음`;
};

export const formatTimeLabel = (time: string): string => {
  const minutes = toMinutes(time);
  if (minutes === null) return time ?? '';

  return format(new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60), 'h:mm a');
};
