import { ScheduleException, Student } from '../types';
import { getDayOfWeek } from './date';
import { timesForDay } from './schedule';

/**
 * 그 날 실제로 와야 하는 원생 한 명.
 *
 * 정규 시간표만으로는 그 주에만 생기는 변경을 담을 수 없어서, 날짜별 예외를
 * 얹은 결과를 여기서 만든다. 홈 화면과 일정 화면이 같은 명단을 봐야 하므로
 * 계산은 한 곳에만 둔다.
 */
export interface RosterEntry {
  student: Student;
  /** 그 날 적용되는 수업 시간. 특강처럼 예외에 시간이 붙어 있으면 그쪽이 이긴다. */
  startTime: string;
  endTime: string;
  /** 정규 수업이 아니라 예외로 들어온 자리인지 (특강·요일 이동) */
  isExtra: boolean;
}

/** 그 날짜가 학원 전체 휴강인지 */
export const isClosedOn = (exceptions: ScheduleException[]): boolean =>
  exceptions.some((rule) => rule.kind === 'closure');

/** 휴강에 붙은 사유. 없으면 빈 문자열. */
export const closureNote = (exceptions: ScheduleException[]): string =>
  exceptions.find((rule) => rule.kind === 'closure')?.note ?? '';

/**
 * 정규 시간표에 그 날짜의 예외를 적용한 최종 명단.
 *
 * 휴강이면 정규든 특강이든 전부 비운다. 학원 문이 닫힌 날에 특강만 남으면
 * 두 예외가 서로 모순되는데, 휴강 쪽이 상위 개념이라 그쪽을 따른다.
 */
export const buildRoster = (
  students: Student[],
  exceptions: ScheduleException[],
  date: Date
): RosterEntry[] => {
  if (isClosedOn(exceptions)) return [];

  const dayOfWeek = getDayOfWeek(date);
  const skipped = new Set(
    exceptions.filter((rule) => rule.kind === 'skip' && rule.studentId).map((rule) => rule.studentId)
  );
  const extras = new Map(
    exceptions
      .filter((rule) => rule.kind === 'extra' && rule.studentId)
      .map((rule) => [rule.studentId as string, rule])
  );

  const entries: RosterEntry[] = [];

  for (const student of students) {
    const extra = extras.get(student.id);
    const isRegular = student.scheduledDays.includes(dayOfWeek) && !skipped.has(student.id);

    if (!isRegular && !extra) continue;

    // 요일마다 시간이 다를 수 있으므로 그 요일의 시간을 쓴다.
    // 예외에 시간이 붙어 있으면 그쪽이 이긴다.
    const regular = timesForDay(student, dayOfWeek);

    entries.push({
      student,
      startTime: extra?.startTime ?? regular.start,
      endTime: extra?.endTime ?? regular.end,
      // 정규 수업이 있는 날에 예외가 겹치면 시간만 바뀐 것이므로 특강으로 보지 않는다.
      isExtra: Boolean(extra) && !isRegular,
    });
  }

  return entries;
};
