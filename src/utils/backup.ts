import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { logger } from './logger';

/**
 * 기기 밖으로 데이터를 꺼내는 유일한 경로 — 파일로 쓰고, 공유 시트를 열고, 파일을 고른다.
 *
 * 이 앱은 서버가 없고 원생 삭제도 되돌릴 수 없어서, 앱을 지우거나 기기를 바꾸면
 * 기록이 전부 사라진다. 내보내기는 그 상황에 대비한 마지막 방어선이다.
 *
 * 표의 내용을 만드는 함수(buildStudentsCsv 등)는 utils/csv에 있다. 여기는 네이티브
 * 모듈에 묶여 있어 노드에서 불러올 수 없는데, 표의 내용은 테스트로 붙잡아야 한다.
 */

/**
 * 파일로 쓰고 공유 시트를 연다.
 *
 * 캐시 디렉터리에 쓰는 이유: 사용자가 공유 시트에서 저장할 곳을 고르고 나면
 * 앱 안의 사본은 쓸모가 없다. document에 두면 지우는 사람이 없어 계속 쌓인다.
 */
export const exportFile = async (
  fileName: string,
  content: string,
  kind: 'csv' | 'json' = 'csv'
): Promise<void> => {
  const mimeType = kind === 'json' ? 'application/json' : 'text/csv';
  const uti = kind === 'json' ? 'public.json' : 'public.comma-separated-values-text';

  if (Platform.OS === 'web') {
    // 웹에는 공유 시트가 없다. 브라우저 다운로드로 대신한다.
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(content);

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('이 기기에서는 공유 기능을 쓸 수 없습니다.');
  }

  await Sharing.shareAsync(file.uri, { mimeType, UTI: uti, dialogTitle: fileName });
};

export const exportCsv = (fileName: string, content: string) =>
  exportFile(fileName, content, 'csv');

const CSV_TYPES = [
  'text/csv',
  'text/comma-separated-values',
  'public.comma-separated-values-text',
  'text/plain',
];

const JSON_TYPES = ['application/json', 'public.json', 'text/plain'];

/** 파일을 고르게 하고 내용을 읽어 온다. 취소하면 null. */
const pickText = async (types: string[]): Promise<string | null> => {
  const result = await DocumentPicker.getDocumentAsync({
    type: types,
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  try {
    if (Platform.OS === 'web') {
      const response = await fetch(asset.uri);
      return await response.text();
    }
    return await new File(asset.uri).text();
  } catch (error) {
    logger.error('Failed to read picked file', error);
    throw new Error('파일을 읽지 못했습니다.');
  }
};

export const pickCsvText = () => pickText(CSV_TYPES);
export const pickBackupText = () => pickText(JSON_TYPES);

/** 파일명에 쓸 오늘 날짜. */
export const backupStamp = (date = new Date()): string =>
  `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
