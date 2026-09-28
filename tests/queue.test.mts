import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from './helpers/db.mts';
import { exclusive } from '../src/db/queue';
import { insertStudent } from '../src/data/students';
import { insertCheckIn, listForDate } from '../src/data/attendance';
import type { Student } from '../src/types';

const DAY = '2026-09-28';
const student: Student = {
  id: 's1',
  name: '김민준',
  grade: '중2',
  scheduledDays: ['Mon'],
  scheduledStartTime: '16:00',
  scheduledEndTime: '18:00',
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

/**
 * 동기화 병합처럼 트랜잭션을 연 채 기다리다가 실패하는 일.
 * (iCloud 파일이 깨졌거나, 병합 중 제약 위반이 난 경우)
 */
const failingMerge = (db: Awaited<ReturnType<typeof openTestDb>>) =>
  db.withTransactionAsync(async () => {
    await db.runAsync("UPDATE students SET grade = '중3' WHERE id = 's1';");
    await tick();
    await tick();
    throw new Error('merge failed');
  });

test('전제: 줄을 세우지 않으면, 실패한 병합이 그 사이 찍은 등원까지 되돌린다', async () => {
  // expo-sqlite의 withTransactionAsync는 BEGIN과 COMMIT 사이에 다른 질의를 막지 않는다.
  // 테스트용 연결도 같은 방식이라, 이 테스트는 왜 db/queue가 있어야 하는지를 보여준다.
  const db = await openTestDb();
  await insertStudent(db, student);

  const merge = failingMerge(db).catch(() => {});
  await tick();
  await insertCheckIn(db, 's1', DAY, 'scheduled'); // 병합 트랜잭션 안으로 섞여 들어간다
  await merge;

  assert.equal((await listForDate(db, DAY)).length, 0, '화면에는 찍혔던 등원이 사라졌다');
});

test('줄을 세우면 병합이 실패해도 그 사이 누른 등원은 남는다', async () => {
  const db = await openTestDb();
  await insertStudent(db, student);

  const merge = exclusive(() => failingMerge(db)).catch(() => {});
  await tick();
  const checkIn = exclusive(() => insertCheckIn(db, 's1', DAY, 'scheduled'));
  await Promise.all([merge, checkIn]);

  assert.equal((await listForDate(db, DAY)).length, 1);
  const [row] = await db.getAllAsync<{ grade: string }>("SELECT grade FROM students WHERE id = 's1';");
  assert.equal(row.grade, '중2', '실패한 병합은 제 것만 되돌린다');
});

test('앞사람이 실패해도 줄은 계속 간다', async () => {
  const order: string[] = [];
  const first = exclusive(async () => {
    order.push('first');
    throw new Error('boom');
  }).catch(() => order.push('first failed'));
  const second = exclusive(async () => {
    order.push('second');
    return 42;
  });

  await first;
  assert.equal(await second, 42);
  assert.deepEqual(order, ['first', 'first failed', 'second']);
});

test('한 번에 하나씩, 들어온 순서대로', async () => {
  const log: string[] = [];
  const job = (name: string, wait: number) =>
    exclusive(async () => {
      log.push(`${name} start`);
      await new Promise((resolve) => setTimeout(resolve, wait));
      log.push(`${name} end`);
    });

  await Promise.all([job('a', 15), job('b', 1), job('c', 5)]);
  assert.deepEqual(log, ['a start', 'a end', 'b start', 'b end', 'c start', 'c end']);
});
