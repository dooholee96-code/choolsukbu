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
  /** 월 수강료(원). 수납 화면이 '받을 돈'의 기본값으로 쓴다. */
  fee?: number;
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
  /**
   * 초등학교 입학 전 아이인가. 미취학 아동의 학원비는 보호자의 교육비 세액공제 대상인데
   * 연말정산 간소화에 나오지 않아서, 보호자가 학원에 교육비납입증명서를 받아 간다.
   * 그 증명서를 채울 자료를 뽑는 데 쓴다. 수납을 기록하는 순간의 값이 그 수납 건에
   * 함께 찍힌다 (Payment.preschool) — 3월에 입학해 이 표시를 꺼도 1·2월에 받은
   * 돈은 공제 대상으로 남아야 하기 때문이다.
   */
  preschool?: boolean;
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

/**
 * 받은 방법. 신고서의 수입금액 구성이 이 셋으로 갈린다 (utils/tax).
 *
 *   card      신용·체크카드, 카드 단말기로 받은 것 — 신용카드 매출
 *   transfer  계좌이체
 *   cash      현금
 *
 * 계좌이체와 현금은 현금영수증을 끊었는지(cashReceipt)에 따라 '현금영수증 매출'과
 * '기타 매출'로 다시 갈린다.
 */
export type PaymentMethod = 'card' | 'transfer' | 'cash';

/**
 * 무슨 돈인가. 학원사업자 수입금액검토표의 '총수입금액 명세'가 이렇게 나눠 묻는다.
 * 수강료만 원생의 월 수강료(완납·미납)에 들어간다.
 */
export type PaymentKind = 'tuition' | 'special' | 'admission' | 'materials' | 'exam' | 'other';

/**
 * 수강료를 실제로 받은 한 건.
 *
 * 원생의 fee는 '받기로 한 돈'이고 이것은 '받은 돈'이다. 세금 신고에는 받은 돈만
 * 들어간다 — 할인, 분납, 미납, 환불이 있으면 둘은 다르다.
 *
 * 원생을 삭제해도 지우지 않는다. 받은 돈은 이미 일어난 일이고, 그 해 신고에서
 * 빠지면 수입이 줄어 보인다.
 */
export interface Payment extends SyncMeta {
  id: string;
  studentId: string;
  /** 받은 날 'YYYY-MM-DD'. 신고 연도는 이 날짜로 가른다. */
  paidOn: string;
  /** 어느 달 수강료인가 'YYYY-MM'. 수납 화면의 달별 미납 확인에 쓴다. */
  month: string;
  /** 원. 환불은 음수로 적는다. */
  amount: number;
  /** 무슨 돈인가. 옛 행이나 비어 있으면 수강료. */
  kind: PaymentKind;
  method: PaymentMethod;
  /** 계좌이체·현금일 때 현금영수증을 끊었는가. 카드면 의미가 없다. */
  cashReceipt: boolean;
  /** 받은 순간 그 원생이 미취학 아동이었는가 (Student.preschool 참고). */
  preschool: boolean;
  note?: string | null;
}
