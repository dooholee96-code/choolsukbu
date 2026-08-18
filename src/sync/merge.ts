import { Attendance, MakeUp, ScheduleException, Student, SyncMeta } from '../types';

/**
 * 기기 하나가 iCloud에 올리는 파일의 내용.
 *
 * 기기마다 자기 파일에만 쓴다. 두 기기가 같은 파일을 건드리지 않으므로 쓰기
 * 충돌이 구조적으로 생기지 않고, 읽을 때만 전부 읽어 합친다.
 */
export interface SyncSnapshot {
  /** 형식이 바뀔 때 올린다. 모르는 버전은 병합에서 건너뛴다. */
  version: number;
  deviceId: string;
  exportedAt: string;
  students: Student[];
  attendance: Attendance[];
  makeups: MakeUp[];
  exceptions: ScheduleException[];
}

export const SNAPSHOT_VERSION = 1;

/**
 * 무엇이 같으면 같은 기록인가.
 *
 * 출결만 id가 아닌 이유: 두 기기에서 같은 학생의 같은 날 등원을 각각 찍으면
 * id는 서로 다르지만 같은 사실이다. id로 합치면 한 학생이 하루에 두 번 등원한
 * 것처럼 남는다.
 */
export const studentKey = (row: Student) => row.id;
export const attendanceKey = (row: Attendance) => `${row.studentId}|${row.date}|${row.type}`;
export const makeupKey = (row: MakeUp) => row.id;
export const exceptionKey = (row: ScheduleException) =>
  `${row.date}|${row.kind}|${row.studentId ?? ''}`;

/**
 * 같은 키를 가진 두 기록 중 살아남을 쪽.
 *
 * updatedAt이 늦은 쪽이 이긴다. ISO 8601 문자열은 사전순 비교가 곧 시간순이라
 * 파싱 없이 비교한다. 값이 없는 쪽은 항상 진다 — 동기화 이전에 만들어진 기록은
 * 언제 고쳤는지 알 수 없기 때문이다.
 *
 * 시각까지 같으면 id로 가른다. 어느 쪽이 옳다고 말할 근거가 없을 때 두 기기가
 * 서로 다른 답을 내면 영원히 서로를 덮어쓰므로, 결과가 같기만 하면 된다.
 */
export const pickWinner = <T extends SyncMeta & { id: string }>(a: T, b: T): T => {
  const left = a.updatedAt ?? '';
  const right = b.updatedAt ?? '';
  if (left !== right) return left > right ? a : b;
  return a.id >= b.id ? a : b;
};

/** 같은 키끼리 승자만 남긴 목록. 입력 순서와 무관하게 결과가 같다. */
export const mergeRows = <T extends SyncMeta & { id: string }>(
  keyOf: (row: T) => string,
  ...sources: T[][]
): T[] => {
  const winners = new Map<string, T>();

  for (const rows of sources) {
    for (const row of rows) {
      const key = keyOf(row);
      const current = winners.get(key);
      winners.set(key, current ? pickWinner(current, row) : row);
    }
  }

  return [...winners.values()];
};

export interface MergeResult {
  students: Student[];
  attendance: Attendance[];
  makeups: MakeUp[];
  exceptions: ScheduleException[];
}

/**
 * 내 기록과 상대 기기들의 기록을 합친다.
 *
 * 결과에는 삭제된 기록(deletedAt)도 남는다. 화면에서 숨기는 것과 기록을 지우는
 * 것은 다르다 — 묘비를 버리면 다음 병합에서 삭제가 되살아난다.
 */
export const mergeSnapshots = (local: MergeResult, remotes: SyncSnapshot[]): MergeResult => {
  const usable = remotes.filter((snapshot) => snapshot?.version === SNAPSHOT_VERSION);

  return {
    students: mergeRows(studentKey, local.students, ...usable.map((s) => s.students ?? [])),
    attendance: mergeRows(attendanceKey, local.attendance, ...usable.map((s) => s.attendance ?? [])),
    makeups: mergeRows(makeupKey, local.makeups, ...usable.map((s) => s.makeups ?? [])),
    exceptions: mergeRows(exceptionKey, local.exceptions, ...usable.map((s) => s.exceptions ?? [])),
  };
};

/**
 * 병합 결과 중 로컬에 실제로 반영해야 하는 것만 골라낸다.
 *
 * 전부 다시 쓰면 원생 50명의 1년치가 매번 통째로 갱신되고, 그때마다 updatedAt이
 * 흔들려 다음 병합이 또 커진다. 달라진 행만 만진다.
 */
export const changedRows = <T extends SyncMeta & { id: string }>(
  keyOf: (row: T) => string,
  local: T[],
  merged: T[]
): T[] => {
  const before = new Map(local.map((row) => [keyOf(row), row]));

  return merged.filter((row) => {
    const current = before.get(keyOf(row));
    if (!current) return true;
    // 같은 키인데 id가 다르면 상대 기기가 만든 행이 이긴 것이므로 바꿔 써야 한다.
    return current.id !== row.id || (current.updatedAt ?? '') !== (row.updatedAt ?? '');
  });
};

/** 같은 키를 가진 로컬 행 중 병합에서 진 것. 중복이 남지 않도록 지운다. */
export const supersededIds = <T extends SyncMeta & { id: string }>(
  keyOf: (row: T) => string,
  local: T[],
  merged: T[]
): string[] => {
  const winners = new Map(merged.map((row) => [keyOf(row), row.id]));

  return local
    .filter((row) => {
      const winnerId = winners.get(keyOf(row));
      return winnerId !== undefined && winnerId !== row.id;
    })
    .map((row) => row.id);
};
