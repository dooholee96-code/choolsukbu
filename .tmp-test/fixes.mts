import { DatabaseSync } from 'node:sqlite';
import { mergeRows, mergeSnapshots, attendanceKey, exceptionKey, supersededIds, SNAPSHOT_VERSION, type SyncSnapshot } from '../src/sync/merge';
import { applyMerge, readAll } from '../src/sync/store';
import type { Attendance, ScheduleException } from '../src/types';

let fails = 0;
const eq = (l: string, a: unknown, e: unknown) => {
  const A = JSON.stringify(a), E = JSON.stringify(e);
  if (A !== E) fails++;
  console.log(`${A === E ? 'ok  ' : 'FAIL'} ${l}` + (A === E ? '' : `\n     got=${A}\n     exp=${E}`));
};

const mk = (id: string, studentId: string, time: string, u: string): Attendance =>
  ({ id, studentId, date: '2026-08-20', time, status: 'scheduled', type: 'makeUp', updatedAt: u, deletedAt: null });

// ① 같은 날 보충 두 건이 살아남는가 (지적 #1)
{
  const a = mk('makeup-1', 's1', '14:00', '2026-08-20T14:00:00.000Z');
  const b = mk('makeup-2', 's1', '16:00', '2026-08-20T16:00:00.000Z');
  const merged = mergeRows(attendanceKey, [a, b]);
  eq('같은 날 보충 2건 유지', merged.map(r => r.id).sort(), ['makeup-1', 'makeup-2']);
  eq('진 행으로 지워지지 않음', supersededIds(attendanceKey, [a, b], merged), []);
}

// ② 같은 보충을 두 기기에서 완료하면 하나로
{
  const mine = mk('makeup-1', 's1', '14:00', '2026-08-20T14:00:00.000Z');
  const theirs = mk('makeup-1', 's1', '14:05', '2026-08-20T14:05:00.000Z');
  const merged = mergeRows(attendanceKey, [mine], [theirs]);
  eq('같은 보충은 하나로', [merged.length, merged[0].time], [1, '14:05']);
}

// ③ 정규 등원은 여전히 학생+날짜로 합쳐지는가
{
  const a: Attendance = { id: 'a1', studentId: 's1', date: '2026-08-20', time: '16:00', status: 'scheduled', type: 'checkIn', updatedAt: '2026-08-20T16:00:00.000Z', deletedAt: null };
  const b: Attendance = { ...a, id: 'a9', time: '16:30', updatedAt: '2026-08-20T16:30:00.000Z' };
  eq('정규 중복은 하나로', mergeRows(attendanceKey, [a], [b]).map(r => r.id), ['a9']);
}

// ④ 묘비와 대체 행이 같은 시각이면? (지적 #2 재현 후 수정 확인)
{
  const tomb: ScheduleException = { id: 'zzz', date: '2026-08-20', kind: 'extra', studentId: 's1', updatedAt: '2026-08-20T10:00:00.000Z', deletedAt: '2026-08-20T10:00:00.000Z' };
  const fresh: ScheduleException = { id: 'aaa', date: '2026-08-20', kind: 'extra', studentId: 's1', updatedAt: '2026-08-20T10:00:00.000Z', deletedAt: null };
  eq('같은 시각이면 새 행이 진다 (버그 재현)', mergeRows(exceptionKey, [tomb], [fresh])[0].deletedAt, '2026-08-20T10:00:00.000Z');

  const fresher = { ...fresh, updatedAt: '2026-08-20T10:00:00.001Z' };
  eq('1ms만 늦어도 새 행이 이긴다 (수정)', mergeRows(exceptionKey, [tomb], [fresher])[0].deletedAt, null);
}

// ⑤ applyMerge가 지운 행을 결과에 세는가 (지적 #6)
{
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec(`
    CREATE TABLE students (id TEXT PRIMARY KEY, name TEXT NOT NULL, grade TEXT, scheduledDays TEXT,
      scheduledStartTime TEXT, scheduledEndTime TEXT, dayTimes TEXT, fee INTEGER, updatedAt TEXT, deletedAt TEXT);
    CREATE TABLE attendance (id TEXT PRIMARY KEY, studentId TEXT, date TEXT NOT NULL, time TEXT NOT NULL,
      status TEXT NOT NULL, type TEXT NOT NULL, updatedAt TEXT, deletedAt TEXT, FOREIGN KEY (studentId) REFERENCES students (id));
    CREATE TABLE makeup (id TEXT PRIMARY KEY, studentId TEXT, originalDate TEXT NOT NULL, makeUpDate TEXT,
      completed INTEGER DEFAULT 0, updatedAt TEXT, deletedAt TEXT, FOREIGN KEY (studentId) REFERENCES students (id));
    CREATE TABLE schedule_exception (id TEXT PRIMARY KEY, date TEXT NOT NULL, kind TEXT NOT NULL, studentId TEXT,
      startTime TEXT, endTime TEXT, note TEXT, updatedAt TEXT, deletedAt TEXT, FOREIGN KEY (studentId) REFERENCES students (id));
  `);
  const db = {
    getAllAsync: async (q: string, ...p: unknown[]) => raw.prepare(q).all(...(p as never[])),
    getFirstAsync: async (q: string, ...p: unknown[]) => raw.prepare(q).get(...(p as never[])) ?? null,
    runAsync: async (q: string, ...p: unknown[]) => raw.prepare(q).run(...(p as never[])),
    withTransactionAsync: async (fn: () => Promise<void>) => { raw.exec('BEGIN'); try { await fn(); raw.exec('COMMIT'); } catch (e) { raw.exec('ROLLBACK'); throw e; } },
  } as never;

  const s1 = { id: 's1', name: '김민준', grade: '중2', scheduledDays: ['Tue'], scheduledStartTime: '16:00', scheduledEndTime: '18:00', updatedAt: '2026-08-20T09:00:00.000Z', deletedAt: null };
  const mine: Attendance = { id: 'a1', studentId: 's1', date: '2026-08-20', time: '16:00', status: 'scheduled', type: 'checkIn', updatedAt: '2026-08-20T16:00:00.000Z', deletedAt: null };
  await applyMerge(db, { students: [], attendance: [], makeups: [], exceptions: [] },
    { students: [s1] as never, attendance: [mine], makeups: [], exceptions: [] });

  const local = await readAll(db);
  const theirs: Attendance = { ...mine, id: 'a9', time: '16:30', updatedAt: '2026-08-20T16:30:00.000Z' };
  const snap: SyncSnapshot = { version: SNAPSHOT_VERSION, deviceId: 'iphone', exportedAt: 'x', students: [], attendance: [theirs], makeups: [], exceptions: [] };
  const applied = await applyMerge(db, local, mergeSnapshots(local, [snap]));
  eq('교체된 건수가 0이 아님', applied > 0, true);
  eq('실제로 교체됨', (await readAll(db)).attendance.map(r => r.id), ['a9']);
}

console.log(fails ? `\n실패 ${fails}건` : '\n전부 통과');
process.exit(fails ? 1 : 0);
