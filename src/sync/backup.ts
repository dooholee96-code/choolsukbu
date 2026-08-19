import type { SQLiteDatabase } from 'expo-sqlite';
import { mergeSnapshots, SNAPSHOT_VERSION, type SyncSnapshot } from './merge';
import { applyMerge, readAll } from './store';

/**
 * 기기 전체를 파일 하나로 내보내고 되돌린다.
 *
 * CSV는 사람이 읽으려고 만든 것이라 되돌릴 수 없다 — id도 관계도 없어서
 * 출결을 어느 원생의 것으로 붙일지 알 수 없다. 그래서 가져오기가 원생 명단에만
 * 있었고, **되돌릴 수 없는 백업**은 백업이 아니다.
 *
 * 형식은 기기 간 동기화가 쓰는 스냅샷과 같다. 덕분에 복원이 덮어쓰기가 아니라
 * 병합이 된다:
 *
 *   - 백업 이후에 기기에서 더 찍은 기록은 살아남는다
 *   - 같은 파일을 두 번 복원해도 두 배가 되지 않는다
 *   - 삭제한 원생이 옛 백업 때문에 되살아나지 않는다 (묘비가 같이 담긴다)
 */

/** 파일 안에 무엇이 들었는지. 복원 전에 사용자에게 보여준다. */
export interface BackupSummary {
  students: number;
  attendance: number;
  makeups: number;
  exceptions: number;
  exportedAt: string;
}

export const buildBackup = async (db: SQLiteDatabase): Promise<string> => {
  const rows = await readAll(db);

  const snapshot: SyncSnapshot = {
    version: SNAPSHOT_VERSION,
    // 어느 기기에서 나왔는지는 복원에 필요 없다. 동기화 파일과 섞이지 않도록
    // 기기 id를 넣지 않는다.
    deviceId: 'backup',
    exportedAt: new Date().toISOString(),
    ...rows,
  };

  return JSON.stringify(snapshot);
};

const isRowArray = (value: unknown): value is unknown[] =>
  Array.isArray(value) && value.every((row) => row !== null && typeof row === 'object');

/**
 * 파일이 이 앱의 백업이 맞는지 본다.
 *
 * 엉뚱한 파일을 골랐을 때 조용히 아무 일도 안 일어나는 것보다, 왜 안 되는지
 * 말해 주는 편이 낫다. 형식이 맞지 않으면 null이다.
 */
export const readBackup = (text: string): SyncSnapshot | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const snapshot = parsed as Partial<SyncSnapshot>;

  if (snapshot.version !== SNAPSHOT_VERSION) return null;
  if (
    !isRowArray(snapshot.students) ||
    !isRowArray(snapshot.attendance) ||
    !isRowArray(snapshot.makeups) ||
    !isRowArray(snapshot.exceptions)
  ) {
    return null;
  }

  return snapshot as SyncSnapshot;
};

export const summarize = (snapshot: SyncSnapshot): BackupSummary => ({
  // 지워진 기록은 세지 않는다. 사용자가 세는 것과 맞아야 한다.
  students: snapshot.students.filter((row) => !row.deletedAt).length,
  attendance: snapshot.attendance.filter((row) => !row.deletedAt).length,
  makeups: snapshot.makeups.filter((row) => !row.deletedAt).length,
  exceptions: snapshot.exceptions.filter((row) => !row.deletedAt).length,
  exportedAt: snapshot.exportedAt,
});

/** 되돌린 기록 수. 이미 있는 것과 같으면 0이다. */
export const restoreBackup = async (
  db: SQLiteDatabase,
  snapshot: SyncSnapshot
): Promise<number> => {
  const local = await readAll(db);
  return applyMerge(db, local, mergeSnapshots(local, [snapshot]));
};
