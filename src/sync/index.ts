import type { SQLiteDatabase } from 'expo-sqlite';
import { getLastSyncAt } from './device';
import { runSyncOnce, type SyncOutcome } from './run';
import { checkAvailability, downloadOthers, upload } from './transport';

export type { SyncSnapshot } from './merge';
export type { Availability, SyncOutcome } from './run';

/**
 * 지금 돌고 있는 동기화. 겹쳐 돌면 두 트랜잭션이 같은 연결 위에서 서로 끼어든다.
 * iOS는 앱을 내릴 때 'inactive'와 'background'를 잇달아 보내고, 쓰기 뒤 타이머와
 * 겹치는 일도 있어서 실제로 겹친다.
 */
let inFlight: Promise<SyncOutcome> | null = null;

const iCloud = { checkAvailability, upload, downloadOthers };

export const runSync = (db: SQLiteDatabase): Promise<SyncOutcome> => {
  if (inFlight) return inFlight;

  inFlight = runSyncOnce(db, iCloud).finally(() => {
    inFlight = null;
  });
  return inFlight;
};

export { checkAvailability, getLastSyncAt };
