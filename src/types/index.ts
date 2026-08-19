export type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

/**
 * 동기화에 필요한 부가 정보. 화면은 쓰지 않는다.
 *
 * updatedAt은 같은 기록이 두 기기에 있을 때 어느 쪽이 최신인지 가리는 유일한
 * 근거다. deletedAt은 지웠다는 사실 자체를 남긴다 — 행을 그냥 없애면 상대 기기
 * 파일에 아직 남아 있어 다음 병합에서 되살아난다.
 */
export interface SyncMeta {
  /** ISO 8601 (UTC). 기기 시계 기준이다. */
  updatedAt?: string;
  /** 값이 있으면 삭제된 기록. 화면에서는 숨기고 병합에만 쓴다. */
  deletedAt?: string | null;
}

export interface DaySchedule {
  start: string; // HH:mm format
  end: string; // HH:mm format
}

export interface Student extends SyncMeta {
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
  /**
   * 퇴원일 'YYYY-MM-DD'. 값이 있으면 그 날부터 명단에 나오지 않는다.
   *
   * 삭제와는 다르다. 삭제는 출결 이력까지 같이 지워서 나중에 정산이나 확인을 할
   * 수 없게 되는데, 학원에서 사람이 나가는 일은 기록을 없애야 할 일이 아니다.
   */
  withdrawnAt?: string | null;
  /**
   * 동명이인 구분용 짧은 꼬리표. 이름 옆에 그대로 붙는다.
   *
   * 이 앱에는 학번 같은 외부 식별자가 없어서, 김민준이 둘이면 화면에서도
   * CSV에서도 구분할 방법이 이름밖에 없다. '월수반', '강북초' 같은 한 마디면 된다.
   */
  note?: string | null;
}

export interface Attendance extends SyncMeta {
  id: string;
  studentId: string;
  date: string; // YYYY-MM-DD format
  time: string; // HH:mm format
  status: 'scheduled' | 'unexpected' | 'absent';
  type: 'checkIn' | 'makeUp';
  /**
   * 하원 시각 'HH:mm'. 아직 안 갔거나 찍지 않았으면 없다.
   *
   * 등원만 남기면 '몇 시에 갔느냐'는 물음에 답할 수 없다. 조퇴는 그 물음이
   * 실제로 오는 자리이고 — 아이를 일찍 데려간 날 부모가 확인을 요청한다 —
   * 예정 종료보다 이르면 화면에서 조퇴로 표시한다.
   */
  leaveTime?: string | null;
}

export interface MakeUp extends SyncMeta {
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

export interface ScheduleException extends SyncMeta {
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
