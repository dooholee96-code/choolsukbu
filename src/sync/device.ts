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
