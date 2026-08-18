import { Platform } from 'react-native';
import { logger } from '../utils/logger';
import { SyncSnapshot } from './merge';

/**
 * iCloud Drive에 스냅샷 파일을 읽고 쓴다.
 *
 * 여기서 무슨 일이 나든 앱은 평소대로 돌아가야 한다. iCloud 권한은 유료
 * Apple Developer 계정에서만 발급되므로, 무료 계정으로 빌드한 앱에서는
 * 이 계층이 통째로 '사용 불가'가 되고 나머지 기능은 전부 그대로 쓴다.
 *
 * 라이브러리도 있으면 쓰고 없으면 없는 대로 간다 — 네이티브 모듈이 안 붙은
 * 빌드에서 import 하나 때문에 앱이 시작조차 못 하는 상황을 만들지 않는다.
 */

const DIRECTORY = '/출석부';
const PREFIX = 'device-';
const SUFFIX = '.json';

export type Availability =
  | { ok: true }
  | { ok: false; reason: 'platform' | 'module' | 'signedOut' | 'error' };

type CloudModule = {
  CloudStorage: {
    isCloudAvailable: () => Promise<boolean>;
    exists: (path: string) => Promise<boolean>;
    mkdir: (path: string) => Promise<void>;
    readdir: (path: string) => Promise<string[]>;
    readFile: (path: string) => Promise<string>;
    writeFile: (path: string, content: string) => Promise<void>;
  };
};

let cached: CloudModule | null | undefined;

/**
 * 모듈을 한 번만 찾아 기억한다. 없으면 null로 기억해 두고 다시 찾지 않는다.
 * require를 쓰는 이유는 모듈이 없는 빌드에서 import가 최상단에서 터지지 않게 하기 위함이다.
 */
const loadModule = (): CloudModule | null => {
  if (cached !== undefined) return cached;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cached = require('react-native-cloud-storage') as CloudModule;
  } catch {
    cached = null;
  }
  return cached;
};

export const checkAvailability = async (): Promise<Availability> => {
  if (Platform.OS !== 'ios') return { ok: false, reason: 'platform' };

  const module = loadModule();
  if (!module?.CloudStorage) return { ok: false, reason: 'module' };

  try {
    return (await module.CloudStorage.isCloudAvailable())
      ? { ok: true }
      : { ok: false, reason: 'signedOut' };
  } catch (error) {
    logger.error('iCloud availability check failed', error);
    return { ok: false, reason: 'error' };
  }
};

const ensureDirectory = async (cloud: CloudModule['CloudStorage']) => {
  if (!(await cloud.exists(DIRECTORY))) await cloud.mkdir(DIRECTORY);
};

/** 내 파일만 쓴다. 두 기기가 같은 파일을 건드리지 않으므로 쓰기 충돌이 없다. */
export const upload = async (snapshot: SyncSnapshot): Promise<void> => {
  const module = loadModule();
  if (!module?.CloudStorage) throw new Error('iCloud를 쓸 수 없습니다.');

  const cloud = module.CloudStorage;
  await ensureDirectory(cloud);
  await cloud.writeFile(
    `${DIRECTORY}/${PREFIX}${snapshot.deviceId}${SUFFIX}`,
    JSON.stringify(snapshot)
  );
};

/**
 * 내 것을 뺀 나머지 기기 파일. 한 파일이 깨져 있어도 나머지는 읽는다 —
 * 상대 기기 파일 하나 때문에 동기화 전체가 멈추면 안 된다.
 */
export const downloadOthers = async (ownDeviceId: string): Promise<SyncSnapshot[]> => {
  const module = loadModule();
  if (!module?.CloudStorage) return [];

  const cloud = module.CloudStorage;
  if (!(await cloud.exists(DIRECTORY))) return [];

  const names = await cloud.readdir(DIRECTORY);
  const mine = `${PREFIX}${ownDeviceId}${SUFFIX}`;
  const snapshots: SyncSnapshot[] = [];

  for (const name of names) {
    if (!name.startsWith(PREFIX) || !name.endsWith(SUFFIX) || name === mine) continue;

    try {
      snapshots.push(JSON.parse(await cloud.readFile(`${DIRECTORY}/${name}`)) as SyncSnapshot);
    } catch (error) {
      logger.error(`Skipping unreadable snapshot: ${name}`, error);
    }
  }

  return snapshots;
};
