import { createContext, useContext } from 'react';
import type { AppLock } from './useAppLock';

/**
 * 잠금 상태를 화면에서 쓰기 위한 통로.
 *
 * 잠금 화면은 네비게이터보다 위에 있어야 해서 App이 들고 있는데, 손잠금 버튼과
 * 설정 화면은 네비게이터 안에 있다. 그 사이를 잇는다.
 */
export const AppLockContext = createContext<AppLock | null>(null);

export const useAppLockContext = (): AppLock => {
  const value = useContext(AppLockContext);
  if (!value) throw new Error('AppLockContext is missing');
  return value;
};
