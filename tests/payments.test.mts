import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SQLiteDatabase } from 'expo-sqlite';
import { openTestDb } from './helpers/db.mts';
import { insertStudent, listStudents, softDeleteStudent, updateStudentRow } from '../src/data/students';
import {
  insertPayment,
  lastMethodFor,
  listForMonth,
  listPaidBetween,
  softDeletePayment,
  updatePaymentRow,
} from '../src/data/payments';
import { applyMerge, readAll } from '../src/sync/store';
import { mergeSnapshots, SNAPSHOT_VERSION, type MergeResult, type SyncSnapshot } from '../src/sync/merge';
import { buildBackup, readBackup, restoreBackup, summarize } from '../src/sync/backup';
import { hasChangesSince } from '../src/sync/device';
import type { Payment, Student } from '../src/types';

const student = (id: string, name: string, extra: Partial<Student> = {}): Student => ({
  id,
  name,
  grade: '7세',
  scheduledDays: ['Mon'],
  scheduledStartTime: '16:00',
  scheduledEndTime: '18:00',
  fee: 250000,
  ...extra,
});

const payment = (id: string, studentId: string, extra: Partial<Payment> = {}): Payment => ({
  id,
  studentId,
  paidOn: '2026-03-05',
  month: '2026-03',
  amount: 250000,
  kind: 'tuition',
  method: 'card',
  cashReceipt: false,
  preschool: false,
  ...extra,
});

const withStudent = async (db: SQLiteDatabase, extra: Partial<Student> = {}) => {
  await insertStudent(db, student('s1', '김하윤', extra));
};

test('새 데이터베이스에 수납 테이블이 있고 미취학 표시가 오간다', async () => {
  const db = await openTestDb();
  await withStudent(db, { preschool: true });
  const [s] = await listStudents(db);
  assert.equal(s.preschool, true);

  await updateStudentRow(db, { ...s, preschool: false });
  const [after] = await listStudents(db);
  assert.equal(after.preschool, false, '3월에 입학하면 끈다');
});

test('달별·기간별로 읽고, 지운 것은 보이지 않는다', async () => {
  const db = await openTestDb();
  await withStudent(db);
  await insertPayment(db, payment('p1', 's1', { month: '2026-02', paidOn: '2026-02-03' }));
  await insertPayment(db, payment('p2', 's1', { month: '2026-03', paidOn: '2026-03-04' }));
  // 3월 수강료를 2월 말에 미리 받았다 — 달은 3월, 받은 날은 2월
  await insertPayment(db, payment('p3', 's1', { month: '2026-03', paidOn: '2026-02-27', amount: 50000 }));

  assert.deepEqual((await listForMonth(db, '2026-03')).map((p) => p.id), ['p3', 'p2']);
  assert.deepEqual(
    (await listPaidBetween(db, '2026-02-01', '2026-02-28')).map((p) => p.id),
    ['p1', 'p3'],
    '신고는 받은 날로 가른다'
  );

  await softDeletePayment(db, 'p2');
  assert.deepEqual((await listForMonth(db, '2026-03')).map((p) => p.id), ['p3']);
});

test('카드 결제에는 현금영수증 표시가 남지 않는다', async () => {
  const db = await openTestDb();
  await withStudent(db);
  await insertPayment(db, payment('p1', 's1', { method: 'card', cashReceipt: true }));
  await insertPayment(db, payment('p2', 's1', { method: 'transfer', cashReceipt: true }));
  const rows = await listForMonth(db, '2026-03');
  assert.equal(rows.find((p) => p.id === 'p1')?.cashReceipt, false);
  assert.equal(rows.find((p) => p.id === 'p2')?.cashReceipt, true);

  // 고칠 때도 같다
  await updatePaymentRow(db, { ...rows.find((p) => p.id === 'p2')!, method: 'card' });
  const [, p2] = await listForMonth(db, '2026-03');
  assert.equal(p2.method, 'card');
  assert.equal(p2.cashReceipt, false);
});

test('원생을 지워도 받은 돈 기록은 남는다', async () => {
  const db = await openTestDb();
  await withStudent(db);
  await insertPayment(db, payment('p1', 's1'));
  await softDeleteStudent(db, 's1');

  assert.equal((await listStudents(db)).length, 0);
  assert.equal((await listPaidBetween(db, '2026-01-01', '2026-12-31')).length, 1);
});

test('수납만 기록한 날도 동기화가 바뀐 것으로 본다', async () => {
  const db = await openTestDb();
  await withStudent(db);
  const since = new Date(Date.now() + 1000).toISOString();
  assert.equal(await hasChangesSince(db, since), false);

  await new Promise((r) => setTimeout(r, 1100));
  await insertPayment(db, payment('p1', 's1'));
  assert.equal(await hasChangesSince(db, since), true);
});

test('두 기기의 수납은 합쳐지고, 같은 달 분납 두 건은 둘 다 남는다', async () => {
  const a = await openTestDb();
  await withStudent(a);
  await insertPayment(a, payment('pa', 's1', { amount: 150000 }));

  const b = await openTestDb();
  await withStudent(b);
  await insertPayment(b, payment('pb', 's1', { amount: 100000, method: 'transfer', cashReceipt: true }));

  const remote = { version: SNAPSHOT_VERSION, deviceId: 'b', exportedAt: '', ...(await readAll(b)) };
  const local = await readAll(a);
  await applyMerge(a, local, mergeSnapshots(local, [remote as SyncSnapshot]));

  const rows = await listForMonth(a, '2026-03');
  assert.deepEqual(rows.map((p) => p.amount).sort(), [100000, 150000]);
  assert.equal(rows.find((p) => p.id === 'pb')?.cashReceipt, true);
});

test('지운 수납은 다른 기기에서도 지워진다', async () => {
  const a = await openTestDb();
  await withStudent(a);
  await insertPayment(a, payment('p1', 's1'));
  const b = await openTestDb();
  const fromA = await readAll(a);
  await applyMerge(b, { students: [], attendance: [], makeups: [], exceptions: [] }, fromA);
  assert.equal((await listForMonth(b, '2026-03')).length, 1);

  await new Promise((r) => setTimeout(r, 5));
  await softDeletePayment(a, 'p1');
  const local = await readAll(b);
  const remote = { version: SNAPSHOT_VERSION, deviceId: 'a', exportedAt: '', ...(await readAll(a)) };
  await applyMerge(b, local, mergeSnapshots(local, [remote as SyncSnapshot]));
  assert.equal((await listForMonth(b, '2026-03')).length, 0);
});

test('수납이 없는 옛 동기화 파일과 합쳐도 내 수납은 그대로다', async () => {
  // 다른 기기가 아직 옛 앱이라 파일에 payments가 없다.
  const db = await openTestDb();
  await withStudent(db);
  await insertPayment(db, payment('p1', 's1'));

  const local = await readAll(db);
  const { payments: _drop, ...withoutPayments } = local;
  const old = { version: SNAPSHOT_VERSION, deviceId: 'old', exportedAt: '', ...withoutPayments } as SyncSnapshot;
  await applyMerge(db, local, mergeSnapshots(local, [old]));
  assert.equal((await listForMonth(db, '2026-03')).length, 1);
});

test('미취학 표시가 동기화를 탄다', async () => {
  const a = await openTestDb();
  await withStudent(a, { preschool: true });
  const b = await openTestDb();
  const empty: MergeResult = { students: [], attendance: [], makeups: [], exceptions: [] };
  await applyMerge(b, empty, await readAll(a));
  assert.equal((await listStudents(b))[0].preschool, true);
});

test('백업에 수납이 담기고, 새 기기에 그대로 되돌아온다', async () => {
  const old = await openTestDb();
  await withStudent(old, { preschool: true });
  await insertPayment(old, payment('p1', 's1', { preschool: true, method: 'cash', cashReceipt: true }));
  const file = await buildBackup(old);

  const snapshot = readBackup(file);
  assert.ok(snapshot);
  assert.equal(summarize(snapshot).payments, 1);

  const fresh = await openTestDb();
  await restoreBackup(fresh, snapshot);
  const [p] = await listForMonth(fresh, '2026-03');
  assert.equal(p.amount, 250000);
  assert.equal(p.method, 'cash');
  assert.equal(p.cashReceipt, true);
  assert.equal(p.preschool, true);
});

test('수납 기능 전의 백업도 복원되고, 있는 수납을 지우지 않는다', async () => {
  const db = await openTestDb();
  await withStudent(db);
  await insertPayment(db, payment('p1', 's1'));

  const legacy = JSON.stringify({
    version: SNAPSHOT_VERSION,
    deviceId: 'backup',
    exportedAt: '2026-01-01T00:00:00.000Z',
    students: [{ ...student('s2', '이서연'), updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }],
    attendance: [],
    makeups: [],
    exceptions: [],
  });
  const snapshot = readBackup(legacy);
  assert.ok(snapshot, '옛 백업을 거부하지 않는다');
  assert.equal(summarize(snapshot).payments, 0);
  await restoreBackup(db, snapshot);

  assert.equal((await listStudents(db)).length, 2);
  assert.equal((await listForMonth(db, '2026-03')).length, 1);
});

test('payments가 목록이 아닌 파일은 백업으로 받지 않는다', () => {
  const bad = JSON.stringify({
    version: SNAPSHOT_VERSION, deviceId: 'x', exportedAt: '',
    students: [], attendance: [], makeups: [], exceptions: [], payments: 'nope',
  });
  assert.equal(readBackup(bad), null);
});

test('수입구분이 저장·백업을 지나도 그대로이고, 비어 있던 옛 행은 수강료로 읽힌다', async () => {
  const db = await openTestDb();
  await withStudent(db);
  await insertPayment(db, payment('p1', 's1', { kind: 'materials', amount: 30000 }));
  const fresh = await openTestDb();
  await restoreBackup(fresh, readBackup(await buildBackup(db))!);
  assert.equal((await listForMonth(fresh, '2026-03'))[0].kind, 'materials');

  await db.runAsync("UPDATE payment SET kind = NULL WHERE id = 'p1';");
  assert.equal((await listForMonth(db, '2026-03'))[0].kind, 'tuition');
});

test('기본 결제수단은 그 원생이 지난번에 수강료를 낸 방법이다', async () => {
  const db = await openTestDb();
  await withStudent(db);
  await insertStudent(db, student('s2', '이서연'));
  assert.equal(await lastMethodFor(db, 's1'), null, '처음 내는 집');

  await insertPayment(db, payment('p1', 's1', { method: 'transfer', paidOn: '2026-09-05' }));
  await insertPayment(db, payment('p2', 's1', { method: 'cash', kind: 'materials', paidOn: '2026-10-01' }));
  await insertPayment(db, payment('p3', 's2', { method: 'cash', paidOn: '2026-10-02' })); // 다른 집
  assert.equal(await lastMethodFor(db, 's1'), 'transfer', '교재비 현금·다른 집 현금에 끌려가지 않는다');
});
