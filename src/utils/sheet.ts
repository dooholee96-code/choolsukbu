/**
 * 엑셀에서 손으로 적은 칸을 읽는 도우미. 원생 명단과 수납 기록 가져오기가 같이 쓴다.
 *
 * 엑셀은 칸의 모양을 제멋대로 바꾼다 — '16:00'을 '4:00 PM'으로, '2026-03'을 '2026-03-01'로,
 * 금액에 쉼표와 '원'을 붙여 저장한다. 엑셀 양식(templates/)은 칸을 텍스트로 잡아 두지만,
 * 사람이 다른 파일에서 붙여 넣으면 그 서식이 따라온다. 그래서 흔한 모양은 다 받는다.
 * 어느 모양에도 맞지 않으면 null — 부르는 쪽이 그 행을 사유와 함께 건너뛴다.
 */
import { DayOfWeek } from '../types';

const pad = (n: number) => String(n).padStart(2, '0');

const validDate = (y: number, m: number, d: number) => {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(y, m, 0).getDate();
};

/** '2026-03-05', '2026.3.5', '2026/03/05', '2026. 3. 5.', '2026년 3월 5일' → '2026-03-05'. */
export const readDate = (value: string | undefined): string | null => {
  const match = /^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*[.일]?\s*$/.exec(value?.trim() ?? '');
  if (!match) return null;
  const [y, m, d] = match.slice(1).map(Number);
  return validDate(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/** '2026-03', '2026.3', '2026년 3월', 날짜('2026-03-01')까지 → '2026-03'. */
export const readMonth = (value: string | undefined): string | null => {
  const text = value?.trim() ?? '';
  const date = readDate(text);
  if (date) return date.slice(0, 7);
  const match = /^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[.월]?\s*(분)?$/.exec(text);
  if (!match) return null;
  const [y, m] = [Number(match[1]), Number(match[2])];
  return m >= 1 && m <= 12 ? `${y}-${pad(m)}` : null;
};

/** '16:00', '16:00:00', '4:00 PM', '오후 4:00' → '16:00'. */
export const readTime = (value: string | undefined): string | null => {
  let text = (value ?? '').trim().toUpperCase();
  let half: 'AM' | 'PM' | null = null;
  if (/^(오전|AM)\s*/.test(text) || /\s*(오전|AM)$/.test(text)) half = 'AM';
  if (/^(오후|PM)\s*/.test(text) || /\s*(오후|PM)$/.test(text)) half = 'PM';
  text = text.replace(/오전|오후|AM|PM/g, '').trim();

  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (half) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (half === 'PM' ? 12 : 0);
  }
  if (hours > 23 || minutes > 59) return null;
  return `${pad(hours)}:${pad(minutes)}`;
};

/** '250,000원', '₩250000', '-50,000', '(50,000)' → 원 단위 정수. */
export const readAmount = (value: string | undefined): number | null => {
  let text = (value ?? '').trim();
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith('-') || text.startsWith('−')) {
    negative = true;
    text = text.slice(1);
  }
  const digits = text.replace(/[,\s원₩]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const amount = Number(digits);
  return negative ? -amount : amount;
};

/** 켜졌다고 볼 글자. 엑셀에서 손으로 적는 칸이라 몇 가지를 받는다. 나머지는 전부 '아니오'. */
export const readFlag = (value: string | undefined): boolean =>
  ['1', 'true', 'y', 'yes', 'o', 'v', '✓', '예', '네', '발급', '미취학'].includes(
    (value ?? '').trim().toLowerCase()
  );

const KOREAN_DAYS: Record<string, DayOfWeek> = {
  월: 'Mon',
  화: 'Tue',
  수: 'Wed',
  목: 'Thu',
  금: 'Fri',
  토: 'Sat',
  일: 'Sun',
};
const DAYS: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * 요일. 'Mon,Wed'(앱이 내보내는 모양)와 '월,수' · '월수' · '월/수/금' · '월 수'(사람이 적는 모양)를
 * 모두 받는다. 순서는 월~일로 맞추고 겹치면 하나로.
 */
export const readDays = (value: string | undefined): DayOfWeek[] => {
  const text = value ?? '';
  const found = new Set<DayOfWeek>();
  for (const token of text.split(/[,\s/·]+/)) {
    const word = token.trim();
    if (!word) continue;
    const english = DAYS.find((d) => d.toLowerCase() === word.slice(0, 3).toLowerCase());
    if (english && /^[a-z]+$/i.test(word)) {
      found.add(english);
      continue;
    }
    for (const char of word.replace(/요일/g, '')) {
      const day = KOREAN_DAYS[char];
      if (day) found.add(day);
    }
  }
  return DAYS.filter((d) => found.has(d));
};
