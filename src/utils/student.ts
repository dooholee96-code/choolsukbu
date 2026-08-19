import { Student } from '../types';
import { formatDateLabel } from './date';

/**
 * 원생 하나를 사람이 알아보는 방법.
 *
 * 이 앱에는 학번 같은 외부 식별자가 없다. 화면에 뜨는 것은 이름과 학년뿐이라
 * 김민준이 둘이면 어느 쪽에 등원을 찍는지 알 수 없고, 잘못 찍어도 아무 표시가
 * 나지 않는다. 구분(note)은 그 자리를 메우려고 있는 값이고, 그래서 이름이
 * 나오는 곳마다 함께 나와야 한다.
 */

/** 이름 아래 한 줄. '중2 · 월수반' */
export const studentSubtitle = (student: Student): string =>
  [student.grade, student.note?.trim()].filter(Boolean).join(' · ');

/** 이름 한 줄에 다 넣어야 할 때. '김민준 (월수반)' */
export const studentDisplayName = (student: Student): string => {
  const note = student.note?.trim();
  return note ? `${student.name} (${note})` : student.name;
};

/** 그 날짜에 이미 퇴원한 상태인지. 퇴원일 당일부터 명단에서 빠진다. */
export const isWithdrawnOn = (student: Student, dateKey: string): boolean =>
  Boolean(student.withdrawnAt) && (student.withdrawnAt as string) <= dateKey;

/** 지금 기준으로 퇴원생인지. 미래 날짜로 잡아둔 퇴원도 퇴원으로 본다. */
export const isWithdrawn = (student: Student): boolean => Boolean(student.withdrawnAt);

export const withdrawnLabel = (student: Student): string =>
  student.withdrawnAt ? `${formatDateLabel(student.withdrawnAt)} 퇴원` : '';

/**
 * 이름이 겹치는 원생들의 이름.
 *
 * 겹칠 때만 구분을 눈에 띄게 보여주려는 것이다. 한 명뿐인 이름에까지 꼬리표를
 * 달면 화면만 시끄러워진다. 퇴원생은 세지 않는다 — 나간 사람과 헷갈릴 일은 없다.
 */
export const duplicateNames = (students: Student[]): Set<string> => {
  const seen = new Set<string>();
  const twice = new Set<string>();

  for (const student of students) {
    if (isWithdrawn(student)) continue;
    const name = student.name.trim();
    if (seen.has(name)) twice.add(name);
    seen.add(name);
  }

  return twice;
};
