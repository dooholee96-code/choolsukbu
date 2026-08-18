import { useCallback, useEffect, useRef, useState } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getLastSyncAt, runSync, type SyncOutcome } from '../sync';

export interface SyncState {
  /** 마지막으로 맞춘 시각. 한 번도 안 했으면 null. */
  lastSyncAt: string | null;
  /** 동기화를 쓸 수 없으면 그 이유. 쓸 수 있으면 null. */
  unavailable: string | null;
  /** 마지막 시도가 실패했으면 그 사유. 성공하면 지워진다. */
  error: string | null;
  syncing: boolean;
  syncNow: () => Promise<SyncOutcome>;
  /** 쓰기가 잠잠해지면 한 번 올린다. */
  schedulePush: () => void;
}

/** 쓰기 뒤 이만큼 조용하면 올린다. 등원을 연달아 찍을 때마다 올리면 낭비다. */
const PUSH_DELAY = 3_000;

/**
 * 동기화의 시점 관리. 무엇을 어떻게 합치는지는 src/sync가 맡고,
 * 여기서는 언제 부를지와 그 결과를 화면에 어떻게 남길지만 다룬다.
 *
 * 실패를 삼키지 않는 것이 핵심이다. 며칠째 못 맞추고 있는데 옛 '맞춤' 시각만
 * 떠 있으면 사용자는 두 기기가 같은 상태라고 믿는다.
 */
export const useSync = (db: SQLiteDatabase, onApplied: () => Promise<void>): SyncState => {
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncNow = useCallback(async (): Promise<SyncOutcome> => {
    setSyncing(true);
    try {
      const outcome = await runSync(db);

      if (outcome.status === 'synced') {
        setUnavailable(null);
        setError(null);
        setLastSyncAt(outcome.at);
        if (outcome.applied > 0) await onApplied();
      } else if (outcome.status === 'unavailable') {
        setUnavailable(outcome.reason);
        setError(null);
      } else {
        setError(outcome.message);
      }

      return outcome;
    } finally {
      setSyncing(false);
    }
  }, [db, onApplied]);

  const schedulePush = useCallback(() => {
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      pushTimer.current = null;
      syncNow().catch(() => {});
    }, PUSH_DELAY);
  }, [syncNow]);

  // 앱을 열 때 한 번. 쓸 수 없는 상태면 runSync가 그 사유를 돌려준다.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = await getLastSyncAt(db).catch(() => null);
      if (cancelled) return;
      if (stored) setLastSyncAt(stored);
      await syncNow();
    })();

    return () => {
      cancelled = true;
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
    // 앱 시작 시 한 번만 돈다. syncNow는 onApplied에 매여 있어 넣으면 매번 재실행된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  return { lastSyncAt, unavailable, error, syncing, syncNow, schedulePush };
};
