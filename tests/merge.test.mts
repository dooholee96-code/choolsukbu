import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attendanceKey,
  changedRows,
  exceptionKey,
  mergeRows,
  mergeSnapshots,
  SNAPSHOT_VERSION,
  supersededIds,
  type SyncSnapshot,
  type MergeResult,
} from '../src/sync/merge';
import type { Attendance, ScheduleException, Student } from '../src/types';

const at = (over: Partial<Attendance> = {}): Attendance => ({
  id: 'a1',
  studentId: 's1',
  date: '2026-08-18',
  time: '16:00',
  status: 'scheduled',
  type: 'checkIn',
  updatedAt: '2026-08-18T16:00:00.000Z',
  deletedAt: null,
  ...over,
});

const student = (over: Partial<Student> = {}): Student => ({
  id: 's1',
  name: '김민준',
  grade: '중2',
  scheduledDays: ['Tue'],
  scheduledStartTime: '16:00',
  scheduledEndTime: '18:00',
  updatedAt: '2026-08-18T10:00:00.000Z',
  deletedAt: null,
  ...over,
});

const empty: MergeResult = { students: [], attendance: [], makeups: [], exceptions: [] };
const snapshot = (over: Partial<SyncSnapshot> = {}): SyncSnapshot => ({
  version: SNAPSHOT_VERSION,
  deviceId: 'iphone',
  exportedAt: '2026-08-18T20:00:00.000Z',
  students: [],
  attendance: [],
  makeups: [],
  exceptions: [],
  ...over,
});

test('서로 다른 기록은 둘 다 남는다', () => {
  const merged = mergeSnapshots(
    { ...empty, attendance: [at()] },
    [snapshot({ attendance: [at({ id: 'a2', studentId: 's2' })] })]
  );
  assert.deepEqual(merged.attendance.map((r) => r.studentId).sort(), ['s1', 's2']);
});

test('같은 학생의 같은 날 정규 등원은 하나로 합쳐진다', () => {
  const later = at({ id: 'a9', time: '16:30', updatedAt: '2026-08-18T16:30:00.000Z' });
  const merged = mergeRows(attendanceKey, [at()], [later]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'a9');
});

test('같은 날 보충 두 건은 각각 남는다', () => {
  // 두 번 빠진 학생이 오후에 두 타임을 몰아 보충하는 경우.
  // 학생+날짜로 묶으면 하나가 지워지고 되돌릴 수 없다.
  const first = at({ id: 'makeup-1', type: 'makeUp', time: '14:00' });
  const second = at({ id: 'makeup-2', type: 'makeUp', time: '16:00' });
  const merged = mergeRows(attendanceKey, [first, second]);

  assert.deepEqual(merged.map((r) => r.id).sort(), ['makeup-1', 'makeup-2']);
  assert.deepEqual(supersededIds(attendanceKey, [first, second], merged), []);
});

test('같은 보충을 두 기기에서 완료하면 하나로 합쳐진다', () => {
  const mine = at({ id: 'makeup-1', type: 'makeUp' });
  const theirs = at({ id: 'makeup-1', type: 'makeUp', time: '14:05', updatedAt: '2026-08-20T14:05:00.000Z' });
  assert.equal(mergeRows(attendanceKey, [mine], [theirs]).length, 1);
});

test('삭제가 전파되고, 나중 재등록이 그것을 되돌린다', () => {
  const tomb = student({ updatedAt: '2026-08-19T10:00:00.000Z', deletedAt: '2026-08-19T10:00:00.000Z' });
  assert.equal(
    mergeSnapshots({ ...empty, students: [student()] }, [snapshot({ students: [tomb] })]).students[0]
      .deletedAt,
    '2026-08-19T10:00:00.000Z'
  );

  const readded = student({ updatedAt: '2026-08-20T10:00:00.000Z' });
  assert.equal(
    mergeSnapshots({ ...empty, students: [tomb] }, [snapshot({ students: [readded] })]).students[0]
      .deletedAt,
    null
  );
});

test('묘비와 대체 행의 시각이 같으면 승자를 추첨한다', () => {
  // 이래서 stamp()가 단조 증가여야 한다. 같은 시각이면 절반의 확률로
  // 방금 만든 행이 지고 다음 동기화에서 지워진다.
  const same = '2026-08-20T10:00:00.000Z';
  const tomb: ScheduleException = { id: 'zzz', date: '2026-08-20', kind: 'extra', studentId: 's1', updatedAt: same, deletedAt: same };
  const fresh: ScheduleException = { id: 'aaa', date: '2026-08-20', kind: 'extra', studentId: 's1', updatedAt: same, deletedAt: null };

  assert.equal(mergeRows(exceptionKey, [tomb], [fresh])[0].deletedAt, same);
  assert.equal(
    mergeRows(exceptionKey, [tomb], [{ ...fresh, updatedAt: '2026-08-20T10:00:00.001Z' }])[0].deletedAt,
    null
  );
});

test('입력 순서와 무관하게 같은 결과가 나온다', () => {
  const a = at({ id: 'a1', updatedAt: '2026-08-18T16:00:00.000Z' });
  const b = at({ id: 'a2', updatedAt: '2026-08-18T17:00:00.000Z' });
  const c = at({ id: 'a3', updatedAt: '2026-08-18T15:00:00.000Z' });

  for (const order of [[a, b, c], [c, a, b], [b, c, a]]) {
    assert.equal(mergeRows(attendanceKey, ...order.map((r) => [r]))[0].id, 'a2');
  }
});

test('시각까지 같으면 양쪽 기기가 같은 답을 낸다', () => {
  const x = at({ id: 'aaa' });
  const y = at({ id: 'bbb' });
  assert.equal(mergeRows(attendanceKey, [x], [y])[0].id, mergeRows(attendanceKey, [y], [x])[0].id);
});

test('updatedAt이 없는 기록은 진다', () => {
  const old = at({ id: 'a1', updatedAt: undefined });
  const fresh = at({ id: 'a2', time: '17:00', updatedAt: '2026-08-18T17:00:00.000Z' });
  assert.equal(mergeRows(attendanceKey, [old], [fresh])[0].id, 'a2');
});

test('모르는 스냅샷 버전은 건너뛴다', () => {
  const future = { ...snapshot({ attendance: [at({ id: 'a2', studentId: 's2' })] }), version: 99 };
  assert.equal(mergeSnapshots({ ...empty, attendance: [at()] }, [future]).attendance.length, 1);
});

test('바뀌지 않은 행은 다시 쓰지 않는다', () => {
  const local = [at()];
  const merged = [at(), at({ id: 'a2', studentId: 's2' })];
  assert.deepEqual(changedRows(attendanceKey, local, merged).map((r) => r.id), ['a2']);
});
