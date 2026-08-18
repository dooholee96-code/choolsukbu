import Papa from 'papaparse';
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { Attendance, MakeUp, ScheduleException, Student } from '../types';
import { logger } from './logger';
import { serializeDayTimes } from './schedule';

/**
 * 기기 밖으로 데이터를 꺼내는 유일한 경로.
 *
 * 이 앱은 서버가 없고 원생 삭제도 되돌릴 수 없어서, 앱을 지우거나 기기를 바꾸면
 * 기록이 전부 사라진다. 내보내기는 그 상황에 대비한 마지막 방어선이다.
 */

/** CSV 앞에 붙이는 BOM. 없으면 엑셀이 한글을 깨서 연다. */
const BOM = '﻿';

export const buildStudentsCsv = (students: Student[]): string =>
  BOM +
  Papa.unparse(
    students.map((s) => ({
      name: s.name,
      grade: s.grade,
      scheduledDays: s.scheduledDays.join(','),
      scheduledStartTime: s.scheduledStartTime,
      scheduledEndTime: s.scheduledEndTime,
      dayTimes: serializeDayTimes(s) ?? '',
      fee: s.fee ?? '',
    })),
    {
      columns: [
        'name',
        'grade',
        'scheduledDays',
        'scheduledStartTime',
        'scheduledEndTime',
        'dayTimes',
        'fee',
      ],
    }
  );

const STATUS_LABEL: Record<Attendance['status'], string> = {
  scheduled: '출석',
  unexpected: '예외',
  absent: '결석',
};

export const buildAttendanceCsv = (records: Attendance[], students: Student[]): string => {
  const byId = new Map(students.map((s) => [s.id, s]));

  return (
    BOM +
    Papa.unparse(
      records.map((r) => ({
        date: r.date,
        time: r.time,
        name: byId.get(r.studentId)?.name ?? '(삭제된 원생)',
        grade: byId.get(r.studentId)?.grade ?? '',
        status: STATUS_LABEL[r.status] ?? r.status,
        type: r.type === 'makeUp' ? '보충' : '정규',
      })),
      { columns: ['date', 'time', 'name', 'grade', 'status', 'type'] }
    )
  );
};

export const buildMakeupCsv = (makeups: MakeUp[], students: Student[]): string => {
  const byId = new Map(students.map((s) => [s.id, s]));

  return (
    BOM +
    Papa.unparse(
      makeups.map((m) => ({
        name: byId.get(m.studentId)?.name ?? '(삭제된 원생)',
        originalDate: m.originalDate,
        makeUpDate: m.makeUpDate ?? '',
        completed: m.completed ? '완료' : '대기',
      })),
      { columns: ['name', 'originalDate', 'makeUpDate', 'completed'] }
    )
  );
};

const KIND_LABEL: Record<ScheduleException['kind'], string> = {
  closure: '휴강',
  extra: '추가',
  skip: '빠짐',
};

export const buildExceptionCsv = (
  exceptions: ScheduleException[],
  students: Student[]
): string => {
  const byId = new Map(students.map((s) => [s.id, s]));

  return (
    BOM +
    Papa.unparse(
      exceptions.map((e) => ({
        date: e.date,
        kind: KIND_LABEL[e.kind] ?? e.kind,
        // 휴강은 학원 전체라 원생이 없다. 빈 칸 대신 무엇에 걸린 건지 적는다.
        name: e.studentId ? byId.get(e.studentId)?.name ?? '(삭제된 원생)' : '(전체)',
        startTime: e.startTime ?? '',
        endTime: e.endTime ?? '',
        note: e.note ?? '',
      })),
      { columns: ['date', 'kind', 'name', 'startTime', 'endTime', 'note'] }
    )
  );
};

/**
 * CSV를 파일로 쓰고 공유 시트를 연다.
 *
 * 캐시 디렉터리에 쓰는 이유: 사용자가 공유 시트에서 저장할 곳을 고르고 나면
 * 앱 안의 사본은 쓸모가 없다. document에 두면 지우는 사람이 없어 계속 쌓인다.
 */
export const exportCsv = async (fileName: string, content: string): Promise<void> => {
  if (Platform.OS === 'web') {
    // 웹에는 공유 시트가 없다. 브라우저 다운로드로 대신한다.
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
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

  await Sharing.shareAsync(file.uri, {
    mimeType: 'text/csv',
    UTI: 'public.comma-separated-values-text',
    dialogTitle: fileName,
  });
};

/** CSV 파일을 고르게 하고 내용을 읽어 온다. 취소하면 null. */
export const pickCsvText = async (): Promise<string | null> => {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['text/csv', 'text/comma-separated-values', 'public.comma-separated-values-text', 'text/plain'],
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

/** 파일명에 쓸 오늘 날짜. */
export const backupStamp = (date = new Date()): string =>
  `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
