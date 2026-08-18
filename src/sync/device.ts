import type { SQLiteDatabase } from 'expo-sqlite';
import { createId } from '../utils/id';

/**
 * 이 기기가 iCloud에서 쓰는 이름표.
 *
 * store.ts와 나눠 둔 이유: 여기만 expo-crypto에 기대는데, 그 의존이 붙으면
 * 병합·SQL 계층을 노드에서 그대로 돌려볼 수 없다.
 */

/** 이 기기의 고유 id. 없으면 만들어 저장한다. 파일 이름이 되므로 한 번 정하면 바뀌지 않는다. */
export const getDeviceId = async (db: SQLiteDatabase): Promise<string> => {
  const row = await db.getFirstAsync<{ deviceId: string }>(
    "SELECT deviceId FROM device WHERE id = 'self';"
  );
  if (row?.deviceId) return row.deviceId;

  const deviceId = createId();
  await db.runAsync("INSERT OR REPLACE INTO device (id, deviceId) VALUES ('self', ?);", deviceId);
  return deviceId;
};

export const getLastSyncAt = async (db: SQLiteDatabase): Promise<string | null> => {
  const row = await db.getFirstAsync<{ lastSyncAt: string | null }>(
    "SELECT lastSyncAt FROM device WHERE id = 'self';"
  );
  return row?.lastSyncAt ?? null;
};

export const setLastSyncAt = async (db: SQLiteDatabase, at: string): Promise<void> => {
  await db.runAsync("UPDATE device SET lastSyncAt = ? WHERE id = 'self';", at);
};

/**
 * 마지막으로 올린 뒤에 이 기기에서 바뀐 것이 있는가.
 *
 * 없으면 올릴 이유가 없다. 앱을 열 때마다 원생 50명의 1년치를 통째로 올리면
 * 대부분의 실행에서 아무것도 달라지지 않은 파일을 다시 쓰는 셈이다.
 */
export const hasChangesSince = async (
  db: SQLiteDatabase,
  since: string | null
): Promise<boolean> => {
  if (!since) return true;

  for (const table of ['students', 'attendance', 'makeup', 'schedule_exception']) {
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${table} WHERE updatedAt > ?;`,
      since
    );
    if ((row?.n ?? 0) > 0) return true;
  }
  return false;
};
