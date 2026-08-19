import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasVaryingTimes,
  parseDayTimes,
  scheduleLines,
  serializeDayTimes,
  timesForDay,
} from '../src/utils/schedule';
import { buildRoster } from '../src/utils/roster';
import { isTimeWithinRange, arrivalOffsetLabel } from '../src/utils/date';
import type { ScheduleException, Student } from '../src/types';

/** 월 14:00–16:00 / 수 17:00–19:00 */
const varied: Student = {
  id: 's1',
  name: '요일별학생',
  grade: '중2',
  scheduledDays: ['Mon', 'Wed'],
  scheduledStartTime: '14:00',
  scheduledEndTime: '16:00',
  dayTimes: { Mon: { start: '14:00', end: '16:00' }, Wed: { start: '17:00', end: '19:00' } },
};

const plain: Student = { ...varied, id: 's2', name: '단일시간학생', dayTimes: undefined };

const MON = new Date('2026-08-17T12:00:00');
const WED = new Date('2026-08-19T12:00:00');
const none: ScheduleException[] = [];

test('기본 시간과 같은 요일은 저장하지 않는다', () => {
  // 저장된 값이 곧 '다른 시간'의 목록이라야, 기본 시간을 고쳤을 때 낡은 사본이 안 남는다.
  assert.equal(serializeDayTimes(varied), 'Wed=17:00-19:00');
  assert.equal(serializeDayTimes(plain), null);
});

test('선택하지 않은 요일은 저장하지 않는다', () => {
  assert.equal(serializeDayTimes({ ...plain, dayTimes: { Fri: { start: '10:00', end: '12:00' } } }), null);
});

test('직렬화를 왕복해도 값이 유지된다', () => {
  assert.deepEqual(parseDayTimes(serializeDayTimes(varied)), { Wed: { start: '17:00', end: '19:00' } });
});

test('깨진 항목은 조용히 버린다', () => {
  assert.deepEqual(parseDayTimes('Mon=14:00-16:00|Xxx=9-9|Wed=abc'), { Mon: { start: '14:00', end: '16:00' } });
  assert.equal(parseDayTimes(''), undefined);
  assert.equal(parseDayTimes(undefined), undefined);
});

test('요일별 시간이 없으면 기본 시간으로 떨어진다', () => {
  assert.deepEqual(timesForDay(varied, 'Mon'), { start: '14:00', end: '16:00' });
  assert.deepEqual(timesForDay(varied, 'Wed'), { start: '17:00', end: '19:00' });
  assert.deepEqual(timesForDay(plain, 'Wed'), { start: '14:00', end: '16:00' });
});

test('시간이 같으면 한 줄, 다르면 요일별로 나눈다', () => {
  assert.equal(hasVaryingTimes(plain), false);
  assert.equal(hasVaryingTimes(varied), true);
  assert.deepEqual(scheduleLines(plain), ['2:00 PM – 4:00 PM']);
  assert.deepEqual(scheduleLines(varied), ['월 2:00 PM – 4:00 PM', '수 5:00 PM – 7:00 PM']);
});

test('명단이 그 요일의 시간을 쓴다', () => {
  const [mon] = buildRoster([varied], none, MON);
  const [wed] = buildRoster([varied], none, WED);
  assert.deepEqual([mon.startTime, mon.endTime], ['14:00', '16:00']);
  assert.deepEqual([wed.startTime, wed.endTime], ['17:00', '19:00']);
});

test('같은 시각이라도 요일에 따라 등원 판정이 갈린다', () => {
  // 이게 안 되면 수요일에 정시에 온 학생이 조용히 '예외'로 기록된다.
  const [mon] = buildRoster([varied], none, MON);
  const [wed] = buildRoster([varied], none, WED);
  assert.equal(isTimeWithinRange('14:30', mon.startTime, mon.endTime), true);
  assert.equal(isTimeWithinRange('14:30', wed.startTime, wed.endTime), false);
  assert.equal(isTimeWithinRange('17:30', wed.startTime, wed.endTime), true);
});

test('특강에 붙은 시간이 요일별 시간보다 우선한다', () => {
  const extra: ScheduleException[] = [
    { id: 'e1', date: '2026-08-19', kind: 'extra', studentId: 's1', startTime: '10:00', endTime: '12:00' },
  ];
  const [entry] = buildRoster([varied], extra, WED);
  assert.deepEqual([entry.startTime, entry.endTime], ['10:00', '12:00']);
});

test('휴강은 특강보다 우선한다', () => {
  // 문이 닫힌 날에 수업이 있을 수는 없다.
  const rules: ScheduleException[] = [
    { id: 'c1', date: '2026-08-19', kind: 'closure' },
    { id: 'e1', date: '2026-08-19', kind: 'extra', studentId: 's2' },
  ];
  assert.deepEqual(buildRoster([varied, plain], rules, WED), []);
});

test('요일 이동은 skip과 extra 한 쌍이다', () => {
  const rules: ScheduleException[] = [
    { id: 'k1', date: '2026-08-19', kind: 'skip', studentId: 's1' },
    { id: 'x1', date: '2026-08-19', kind: 'extra', studentId: 's2' },
  ];
  const roster = buildRoster([varied, plain], rules, WED);
  assert.deepEqual(roster.map((e) => e.student.id), ['s2']);
  assert.equal(roster[0].isExtra, false); // s2는 수요일 정규 수업이 있다
});

test('지각·조기 표시', () => {
  assert.equal(arrivalOffsetLabel('16:35', '16:00'), '35분 늦음');
  assert.equal(arrivalOffsetLabel('15:00', '16:00'), '1시간 일찍');
  assert.equal(arrivalOffsetLabel('16:05', '16:00'), null, '10분 미만은 표시하지 않는다');
  // 자정을 넘는 수업: 단순 뺄셈이면 '21시간 30분 일찍'이 된다
  assert.equal(arrivalOffsetLabel('00:30', '22:00'), '2시간 30분 늦음');
});
