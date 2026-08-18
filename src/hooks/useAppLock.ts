import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { isLockEnabled } from '../security/lock';

export interface AppLock {
  /** 잠금이 켜져 있는가 */
  enabled: boolean;
  /** 지금 잠겨 있는가. 켜져 있어도 방금 열었으면 false다. */
  locked: boolean;
  /** 잠금 설정을 다시 읽는다. 설정 화면에서 켜고 끈 뒤 부른다. */
  refresh: () => Promise<void>;
  unlock: () => void;
  /** 아이패드를 건네주기 전에 직접 잠근다. */
  lock: () => void;
}

/**
 * 백그라운드에 이만큼 넘게 있었으면 다시 잠근다.
 *
 * 0으로 두면 설정 앱을 잠깐 다녀오는 것만으로도 매번 다시 풀어야 한다.
 * 반대로 너무 길면 건네준 사이에 열려 버린다.
 */
const GRACE_MS = 30_000;

/**
 * 수업 중에 아이가 아이패드를 만지는 상황을 막는다.
 *
 * 두 갈래다. 앱을 떠났다 돌아오면 자동으로 잠기고, 건네주기 직전에는 직접
 * 잠근다. 앱을 켠 채로 넘겨주는 경우는 자동 잠금으로 잡을 수 없어서 손잠금이
 * 필요하다 — 실제로 그 경우가 가장 흔하다.
 */
export const useAppLock = (): AppLock => {
  const [enabled, setEnabled] = useState(false);
  const [locked, setLocked] = useState(false);

  /** 잠금이 켜져 있는지 아직 확인하기 전인가. 확인 전에는 잠그지 않는다. */
  const ready = useRef(false);
  const leftAt = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const on = await isLockEnabled();
    setEnabled(on);
    ready.current = true;

    // 막 켰다면 잠긴 상태로 두지 않는다. 방금 설정한 사람은 이미 본인이다.
    if (!on) setLocked(false);
  }, []);

  // 앱을 열 때 한 번. 켜져 있으면 잠긴 채로 시작한다.
  useEffect(() => {
    (async () => {
      const on = await isLockEnabled();
      ready.current = true;
      setEnabled(on);
      setLocked(on);
    })();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (!ready.current || !enabled) return;

      if (state === 'background') {
        leftAt.current = Date.now();
        return;
      }

      if (state === 'active' && leftAt.current !== null) {
        const away = Date.now() - leftAt.current;
        leftAt.current = null;
        if (away > GRACE_MS) setLocked(true);
      }
    });

    return () => subscription.remove();
  }, [enabled]);

  const unlock = useCallback(() => setLocked(false), []);
  const lock = useCallback(() => setLocked(true), []);

  return { enabled, locked, refresh, unlock, lock };
};
