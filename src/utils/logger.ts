/**
 * 개발 중에만 출력하는 로거.
 *
 * Release 빌드에는 콘솔을 보는 사람이 없고, 문자열 조합 비용과 인자로 넘긴
 * 객체가 살아남는 부작용만 남는다. 그렇다고 에러를 통째로 버리면 안 되므로
 * 나중에 Sentry 같은 크래시 리포터를 붙일 자리를 report()로 열어 둔다.
 */
const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

type Reporter = (error: unknown, context?: string) => void;

let reporter: Reporter | null = null;

/** 크래시 리포터를 연결한다. 앱 시작 시 한 번 호출하면 된다. */
export const setErrorReporter = (next: Reporter | null) => {
  reporter = next;
};

export const logger = {
  log: (...args: unknown[]) => {
    if (isDev) console.log(...args);
  },
  warn: (...args: unknown[]) => {
    if (isDev) console.warn(...args);
  },
  /** 개발 중에는 콘솔로, 프로덕션에서는 등록된 리포터로 보낸다. */
  error: (message: string, error?: unknown) => {
    if (isDev) {
      console.error(message, error);
      return;
    }
    reporter?.(error ?? new Error(message), message);
  },
};
