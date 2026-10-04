import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from './helpers/db.mts';
import { emptyAcademy, getAcademy, saveAcademy } from '../src/data/academy';
import { applyMerge, readAll } from '../src/sync/store';
import { mergeSnapshots, SNAPSHOT_VERSION, type SyncSnapshot } from '../src/sync/merge';
import { buildBackup, readBackup, restoreBackup } from '../src/sync/backup';
import { hasChangesSince } from '../src/sync/device';

const info = { ...emptyAcademy(), name: '숲속영어', owner: '이두호', bizNumber: '123-45-67890' };

test('적은 적이 없으면 null, 적으면 그대로 읽힌다 (앞뒤 공백은 뺀다)', async () => {
  const db = await openTestDb();
  assert.equal(await getAcademy(db), null);
  await saveAcademy(db, { ...info, phone: ' 02-123-4567 ' });
  const got = await getAcademy(db);
  assert.equal(got?.name, '숲속영어');
  assert.equal(got?.phone, '02-123-4567');
  assert.equal(got?.address, '', '안 적은 칸은 빈 문자열');
});

test('두 기기에서 고치면 나중에 고친 쪽이 남는다', async () => {
  const a = await openTestDb();
  const b = await openTestDb();
  await saveAcademy(a, info, '2026-10-01T00:00:00.000Z');
  await saveAcademy(b, { ...info, phone: '02-999-0000' }, '2026-10-02T00:00:00.000Z');

  const local = await readAll(a);
  const remote = { version: SNAPSHOT_VERSION, deviceId: 'b', exportedAt: '', ...(await readAll(b)) } as SyncSnapshot;
  const applied = await applyMerge(a, local, mergeSnapshots(local, [remote]));
  assert.equal(applied, 1);
  assert.equal((await getAcademy(a))?.phone, '02-999-0000');

  // 반대 방향: b에는 더 옛 것이 와도 바뀌지 않는다
  const localB = await readAll(b);
  const fromA = { version: SNAPSHOT_VERSION, deviceId: 'a', exportedAt: '', ...(await readAll(a)) } as SyncSnapshot;
  await applyMerge(b, localB, mergeSnapshots(localB, [fromA]));
  assert.equal((await getAcademy(b))?.phone, '02-999-0000');
});

test('학원 정보가 없는 옛 파일과 합쳐도 내 학원 정보는 그대로다', async () => {
  const db = await openTestDb();
  await saveAcademy(db, info);
  const local = await readAll(db);
  const { academy: _drop, ...rest } = local;
  const old = { version: SNAPSHOT_VERSION, deviceId: 'old', exportedAt: '', ...rest } as SyncSnapshot;
  await applyMerge(db, local, mergeSnapshots(local, [old]));
  assert.equal((await getAcademy(db))?.name, '숲속영어');
});

test('백업에 담기고 새 기기에 되돌아온다', async () => {
  const old = await openTestDb();
  await saveAcademy(old, info);
  const fresh = await openTestDb();
  await restoreBackup(fresh, readBackup(await buildBackup(old))!);
  assert.equal((await getAcademy(fresh))?.bizNumber, '123-45-67890');
});

test('학원 정보만 고친 날도 동기화가 바뀐 것으로 본다', async () => {
  const db = await openTestDb();
  const since = new Date(Date.now() - 1000).toISOString();
  assert.equal(await hasChangesSince(db, since), false);
  await saveAcademy(db, info);
  assert.equal(await hasChangesSince(db, since), true);
});

test('학원 정보와 수강료 기준표를 따로 고쳐도 서로 덮지 않는다', async () => {
  const { patchAcademy } = await import('../src/data/academy');
  const db = await openTestDb();
  await patchAcademy(db, { name: '숲속영어' });
  await patchAcademy(db, { feeRules: [{ id: 'r', perWeek: 2, gradeFrom: null, gradeTo: null, fee: 200000 }], classMinutes: 50 });
  await patchAcademy(db, { phone: '02-1' });
  const got = await getAcademy(db);
  assert.equal(got?.name, '숲속영어');
  assert.equal(got?.phone, '02-1');
  assert.equal(got?.feeRules?.[0].fee, 200000);
  assert.equal(got?.classMinutes, 50);
});

test('수강료가 빈 재원생에게만 기준표대로 채운다', async () => {
  const { insertStudent, listStudents, fillMissingFees } = await import('../src/data/students');
  const db = await openTestDb();
  const base = { scheduledStartTime: '16:00', scheduledEndTime: '17:00' };
  await insertStudent(db, { id: 'a', name: '가', grade: '초2', scheduledDays: ['Mon', 'Wed'], ...base });
  await insertStudent(db, { id: 'b', name: '나', grade: '초5', scheduledDays: ['Mon', 'Wed', 'Fri'], ...base });
  await insertStudent(db, { id: 'c', name: '다', grade: '초2', scheduledDays: ['Mon', 'Wed'], fee: 180000, ...base }); // 할인
  await insertStudent(db, { id: 'd', name: '라', grade: '초2', scheduledDays: ['Mon'], withdrawnAt: '2026-06-01', ...base });
  await insertStudent(db, { id: 'e', name: '마', grade: '7세', scheduledDays: ['Tue'], ...base }); // 맞는 줄 없음

  const filled = await fillMissingFees(db, [
    { id: '1', perWeek: null, gradeFrom: 1, gradeTo: 3, fee: 250000 },
    { id: '2', perWeek: null, gradeFrom: 4, gradeTo: null, fee: 400000 },
  ]);
  assert.equal(filled, 2);
  const fees = Object.fromEntries((await listStudents(db)).map((s) => [s.id, s.fee ?? null]));
  assert.deepEqual(fees, { a: 250000, b: 400000, c: 180000, d: null, e: null });
});
