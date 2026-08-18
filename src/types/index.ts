export type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

export interface DaySchedule {
  start: string; // HH:mm format
  end: string; // HH:mm format
}

export interface Student {
  id: string;
  name: string;
  grade: string;
  scheduledDays: DayOfWeek[];
  /** 기본 수업 시간. dayTimes에 없는 요일은 이 값을 쓴다. */
  scheduledStartTime: string; // HH:mm format
  scheduledEndTime: string; // HH:mm format
  /**
   * 요일마다 수업 시간이 다를 때만 채운다. '월 2시, 수 5시' 같은 반이 흔해서
   * 시간을 하나로만 두면 둘 중 하나는 항상 틀린 값이 된다.
   * 비어 있으면 모든 요일이 기본 시간이다.
   */
  dayTimes?: Partial<Record<DayOfWeek, DaySchedule>>;
  fee?: number; // Optional, for future use
}

export interface Attendance {
  id: string;
  studentId: string;
  date: string; // YYYY-MM-DD format
  time: string; // HH:mm format
  status: 'scheduled' | 'unexpected' | 'absent';
  type: 'checkIn' | 'makeUp';
}

export interface MakeUp {
  id: string;
  studentId: string;
  originalDate: string; // YYYY-MM-DD format
  makeUpDate?: string; // YYYY-MM-DD format
  completed: boolean;
}

/**
 * 그 날 하루만 정규 시간표와 달라지는 것들.
 *
 * - closure: 학원 전체 휴강. studentId는 없다.
 * - extra:   그 날 추가로 오는 원생. 특강이나 요일 이동의 도착 쪽.
 * - skip:    그 날 정규 수업에서 빠지는 원생. 결석이 아니라 일정이 옮겨진 것이다.
 *
 * 요일 이동은 원래 날짜의 skip과 옮겨간 날짜의 extra 한 쌍으로 표현한다.
 */
export type ExceptionKind = 'closure' | 'extra' | 'skip';

export interface ScheduleException {
  id: string;
  date: string; // YYYY-MM-DD format
  kind: ExceptionKind;
  /** closure면 없다. extra·skip이면 반드시 있다. */
  studentId?: string;
  /** extra 전용. 비우면 원생의 정규 수업 시간을 그대로 쓴다. */
  startTime?: string; // HH:mm format
  endTime?: string; // HH:mm format
  note?: string;
}
