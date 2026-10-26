import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from './helpers/db.mts';
import { insertStudent } from '../src/data/students';
import { insertAbsence, listAttendanceIncludingDeleted, listForDate } from '../src/data/attendance';
import { setClosureRow } from '../src/data/exceptions';
import { fillPresence } from '../src/data/presence';
import { applyMerge, readAll } from '../src/sync/store';
import { mergeSnapshots, SNAPSHOT_VERSION, type SyncSnapshot } from '../src/sync/merge';
import {
  autoPresenceId,
  autoPresenceStamp,
  planPresence,
  presenceRange,
  PRESENCE_LOOKBACK_DAYS,
} from '../src/utils/presence';
import type { Attendance, Student } from '../src/types';

// 2026-10-19 월, 20 화, 21 수, 22 목
const monWed: Student = {
  id: 'a',
  name: '김하늘',
  grade: '초3',
  scheduledDays: ['Mon', 'Wed'],
  scheduledStartTime: '16:00',
  scheduledEndTime: '17:00',
};
const tue: Student = { ...monWed, id: 'b', name: '이바다', scheduledDays: ['Tue'] };

const open = async () => {
  const db = await openTestDb();
  await insertStudent(db, monWed);
  await insertStudent(db, tue);
  return db;
};

test('켠 날부터 어제까지만 채운다 — 오늘은 아직 결석이 생길 수 있다', () => {
  assert.deepEqual(presenceRange('2026-10-19', '2026-10-22'), { from: '2026-10-19', to: '2026-10-21' });
  assert.equal(presenceRange('2026-10-22', '2026-10-22'), null, '오늘 켜면 채울 날이 없다');
  assert.equal(presenceRange(null, '2026-10-22'), null, '꺼져 있으면 없다');
});

test('오래 안 열었어도 정해 둔 날수까지만 거슬러 간다', () => {
  const range = presenceRange('2025-01-01', '2026-10-22');
  assert.ok(range);
  const days = (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000 + 1;
  assert.equal(days, PRESENCE_LOOKBACK_DAYS);
});

test('결석이 아닌 아이는 시각 없는 정상 출석으로 채운다', async () => {
  const db = await open();

  const filled = await fillPresence(db, '2026-10-19', '2026-10-22');

  // 월(a) 화(b) 수(a)
  assert.equal(filled, 3);
  const monday = await listForDate(db, '2026-10-19');
  assert.equal(monday.length, 1);
  assert.equal(monday[0].studentId, 'a');
  assert.equal(monday[0].status, 'scheduled');
  assert.equal(monday[0].time, '', '언제 왔는지는 지어내지 않는다');
  assert.equal(monday[0].id, autoPresenceId('a', '2026-10-19'));
});

test('결석을 누른 날은 건드리지 않는다', async () => {
  const db = await open();
  await insertAbsence(db, 'a', '2026-10-19');

  await fillPresence(db, '2026-10-19', '2026-10-22');

  const monday = await listForDate(db, '2026-10-19');
  assert.equal(monday.length, 1);
  assert.equal(monday[0].status, 'absent');
});

test('휴강한 날은 채우지 않는다', async () => {
  const db = await open();
  await setClosureRow(db, '2026-10-21', true, '학원 행사');

  await fillPresence(db, '2026-10-19', '2026-10-22');

  assert.equal((await listForDate(db, '2026-10-21')).length, 0);
});

test('두 번 돌려도 한 번만 들어간다', async () => {
  const db = await open();
  await fillPresence(db, '2026-10-19', '2026-10-22');
  const again = await fillPresence(db, '2026-10-19', '2026-10-22');

  assert.equal(again, 0);
  assert.equal((await listAttendanceIncludingDeleted(db)).length, 3);
});

test('채운 날은 나중에 등록한 원생으로 다시 채우지 않는다', async () => {
  // 원생에게는 등록일이 없다. 이미 채운 날을 다시 보면 새 원생이 등록 전 날에도 출석이 된다.
  const db = await open();
  await fillPresence(db, '2026-10-19', '2026-10-22');

  await insertStudent(db, { ...monWed, id: 'c', name: '박새봄' });
  await fillPresence(db, '2026-10-19', '2026-10-23');

  const monday = await listForDate(db, '2026-10-19');
  assert.deepEqual(monday.map((r) => r.studentId), ['a']);
  // 새로 채울 수 있게 된 날(22 목)에는 수업이 있는 원생이 없다.
});

test('지운 자동 출석은 다시 채우지 않는다', () => {
  const id = autoPresenceId('a', '2026-10-19');
  const existing: Attendance[] = [
    {
      id,
      studentId: 'a',
      date: '2026-10-19',
      time: '',
      status: 'scheduled',
      type: 'checkIn',
      updatedAt: '2026-10-20T03:00:00.000Z',
      deletedAt: '2026-10-20T03:00:00.000Z',
    },
  ];

  const planned = planPresence({
    students: [monWed],
    exceptions: [],
    existing,
    dates: ['2026-10-19'],
  });

  assert.equal(planned.length, 0);
});

test('결석을 눌렀다 취소한 날은 출석이 되고, 그 취소보다 늦게 달린다', () => {
  // 묘비보다 이르면 병합에서 묘비가 이겨 지우고, 다음 실행이 또 채운다 — 동기화마다 되풀이.
  const tombstone: Attendance = {
    id: 'human',
    studentId: 'a',
    date: '2026-10-19',
    time: '16:05',
    status: 'absent',
    type: 'checkIn',
    updatedAt: '2026-10-19T08:00:00.000Z',
    deletedAt: '2026-10-19T08:00:00.000Z',
  };

  const [row] = planPresence({
    students: [monWed],
    exceptions: [],
    existing: [tombstone],
    dates: ['2026-10-19'],
  });

  assert.ok(row);
  assert.ok((row.updatedAt ?? '') > (tombstone.updatedAt ?? ''));
});

test('다른 기기에서 그 날 누른 결석이 나중에 넘어와도 결석이 이긴다', async () => {
  // B는 A의 결석을 받기 전에 다음 날 아침 자동 출석을 채웠다.
  const b = await open();
  await fillPresence(b, '2026-10-19', '2026-10-20');

  const a = await open();
  await insertAbsence(a, 'a', '2026-10-19');

  const local = await readAll(b);
  const remote = await readAll(a);
  const fromA: SyncSnapshot = {
    version: SNAPSHOT_VERSION,
    deviceId: 'a',
    exportedAt: '2026-10-20T01:00:00.000Z',
    ...remote,
  };
  const merged = mergeSnapshots(local, [fromA]);
  await applyMerge(b, local, merged);

  const monday = await listForDate(b, '2026-10-19');
  assert.equal(monday.length, 1);
  assert.equal(monday[0].status, 'absent');

  // 그리고 다시 채워도 결석은 그대로다.
  await fillPresence(b, '2026-10-19', '2026-10-21');
  assert.equal((await listForDate(b, '2026-10-19'))[0].status, 'absent');
});

test('두 기기가 같은 날을 각자 채우면 같은 행이라 하나로 합쳐진다', async () => {
  const a = await open();
  const b = await open();
  await fillPresence(a, '2026-10-19', '2026-10-20');
  await fillPresence(b, '2026-10-19', '2026-10-20');

  const [ra, rb] = await Promise.all([listForDate(a, '2026-10-19'), listForDate(b, '2026-10-19')]);
  assert.deepEqual(ra, rb);
  assert.equal(ra[0].updatedAt, autoPresenceStamp('2026-10-19'));
});

test('자동 출석의 시각은 그 날 한국 시각 0시보다도 이르다', () => {
  // 한국의 10월 19일은 UTC로 18일 15시에 시작한다. 그 날 누른 무엇보다 일러야 한다.
  assert.ok(autoPresenceStamp('2026-10-19') < '2026-10-18T15:00:00.000Z');
});
