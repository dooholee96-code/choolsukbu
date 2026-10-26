import { addDays, differenceInCalendarDays, getDay, subDays } from 'date-fns';
import { fromDateKey, toDateKey } from './date';

/**
 * 공부방·학원 원장이 해마다 챙기는 세무 일정. [수납] 탭 위에 다가오는 것만 띄운다.
 *
 * 알림(푸시)으로 보내지 않고 앱 안에만 띄운다. 알림은 라이브러리와 권한이 하나 더 붙어
 * 해마다 손볼 것이 늘고, 원장은 어차피 수납을 적으러 이 탭을 연다.
 *
 * 날짜는 해마다 같은 법정 기한이다. 기한이 토·일요일이면 다음 월요일로 미뤄 보여 준다
 * (국세기본법 제5조). 공휴일까지는 따지지 않는다 — 공휴일 표는 해마다 바뀌어 손볼 것이
 * 늘고, 미리 알리는 것이 목적이라 하루 이르게 알리는 쪽이 안전하다. 바뀌면 이 표 한 곳만 고친다.
 *
 * 내용은 2026년 10월 국세청 안내로 확인했다. 학원은 사업장현황신고를 늦게 내도 가산세가
 * 없지만(의료·수의·약사업만 붙는다) 5월 종합소득세의 기초 자료라 꼭 낸다.
 */
export type DeadlineAction = 'certificates' | 'exports';

export interface TaxDeadline {
  key: string;
  title: string;
  /** 'YYYY-MM-DD' */
  due: string;
  /** 법정 기한이 아니라 '보통 이 무렵'인 일정. D-day 대신 기간으로 보여 준다. */
  soft?: boolean;
  detail: string;
  /** 눌러서 바로 할 수 있는 일. 없으면 안내만 한다. */
  action?: DeadlineAction;
  /** 기한 며칠 전부터 띄울지. 없으면 DEADLINE_LEAD_DAYS. */
  leadDays?: number;
}

/** 기한 이만큼 전부터 띄운다. */
export const DEADLINE_LEAD_DAYS = 45;

const deadlinesOf = (year: number): TaxDeadline[] => [
  {
    key: `certificate-${year}`,
    title: '교육비 납입 증명서',
    due: `${year}-02-28`,
    soft: true,
    // 연말정산이 1월에 시작하니 새해 첫날부터 보이게.
    leadDays: 60,
    detail: `연말정산 서류를 내는 1~2월에 보호자들이 ${year - 1}년 납입분 증명서를 찾습니다. 교육비 공제 대상 원생(미취학, 초1·2 예체능)은 연말정산 간소화에 나오지 않아 꼭 필요합니다.`,
    action: 'certificates',
  },
  {
    key: `bizstatus-${year}`,
    title: '사업장현황신고',
    due: `${year}-02-10`,
    detail: `${year - 1}년 수입금액과 학원사업자 수입금액검토표를 홈택스에 냅니다. 숫자는 [설정]의 신고용 자료에서 뽑습니다. 교재·임대료 등으로 받은 (세금)계산서가 있으면 매입처별 합계표도 함께 냅니다.`,
    action: 'exports',
  },
  {
    key: `incometax-${year}`,
    title: '종합소득세 신고·납부',
    due: `${year}-05-31`,
    detail: `${year - 1}년 소득을 신고하고, 개인지방소득세도 함께 냅니다. 수납 장부가 수입의 근거입니다. 세무사에게 맡기면 장부 파일을 전달하세요. 성실신고확인 대상이면 6월 30일까지입니다.`,
    action: 'exports',
  },
  {
    key: `prepay-${year}`,
    title: '종합소득세 중간예납',
    due: `${year}-11-30`,
    // 고지서가 11월 초에 온다. 그 무렵부터.
    leadDays: 30,
    detail: `지난해 종합소득세를 낸 사업자에게 세무서가 11월 초에 고지서를 보냅니다. 금액은 보통 지난해 세액의 절반입니다. 올해 상반기 수입이 크게 줄었으면 상반기 실적으로 신고해 덜 낼 수 있습니다.`,
  },
];

/** 토·일요일이면 다음 월요일. */
const toWeekday = (dateKey: string): string => {
  const date = fromDateKey(dateKey);
  const day = getDay(date);
  return day === 6 ? toDateKey(addDays(date, 2)) : day === 0 ? toDateKey(addDays(date, 1)) : dateKey;
};

export interface UpcomingDeadline extends TaxDeadline {
  /** 오늘부터 기한까지 남은 날. 0이면 오늘이 기한. */
  daysLeft: number;
}

/** 오늘 기준으로 다가오는 일정, 기한이 가까운 순. 지난 것은 뺀다. */
export const upcomingDeadlines = (today: string): UpcomingDeadline[] => {
  const now = fromDateKey(today);
  const year = now.getFullYear();

  return [...deadlinesOf(year), ...deadlinesOf(year + 1)]
    .map((deadline) => (deadline.soft ? deadline : { ...deadline, due: toWeekday(deadline.due) }))
    .map((deadline) => ({
      ...deadline,
      daysLeft: differenceInCalendarDays(fromDateKey(deadline.due), now),
    }))
    .filter(
      (d) =>
        d.daysLeft >= 0 &&
        today >= toDateKey(subDays(fromDateKey(d.due), d.leadDays ?? DEADLINE_LEAD_DAYS))
    )
    .sort((a, b) => a.daysLeft - b.daysLeft);
};

/** '2월 10일까지 · D-12' / 기간 일정은 '2월 말까지'. */
export const deadlineLabel = (deadline: UpcomingDeadline): string => {
  const [, m, d] = deadline.due.split('-').map(Number);
  if (deadline.soft) return `${m}월 말까지`;
  const when = `${m}월 ${d}일까지`;
  return deadline.daysLeft === 0 ? `${when} · 오늘` : `${when} · D-${deadline.daysLeft}`;
};

/** 신고·증명서가 다루는 해. 기한이 있는 해의 바로 전 해다 (중간예납은 버튼이 없어 쓰지 않는다). */
export const deadlineTaxYear = (deadline: TaxDeadline) => Number(deadline.due.slice(0, 4)) - 1;
