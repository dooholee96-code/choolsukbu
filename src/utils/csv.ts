import Papa from 'papaparse';
import { Attendance, DayOfWeek, MakeUp, ScheduleException, Student } from '../types';
import { createId } from './id';
import { parseDayTimes, serializeDayTimes } from './schedule';

const VALID_DAYS: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface ParseCSVResult {
  students: Student[];
  /** 형식이 맞지 않아 건너뛴 행. 1-based 행 번호와 사유. */
  skipped: { row: number; reason: string }[];
}

const isTimeString = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value.trim());

/** 켜졌다고 볼 글자. 엑셀에서 손으로 적는 칸이라 몇 가지를 받는다. 나머지는 전부 '아니오'. */
const asFlag = (value: string | undefined): boolean =>
  ['1', 'true', 'y', 'yes', 'o', '예', '네', '미취학'].includes(
    (value ?? '').trim().toLowerCase()
  );

/** 'YYYY-MM-DD'만 받는다. 형식이 다르면 퇴원하지 않은 것으로 본다. */
const asDateKey = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
};

/**
 * 원생 명단 CSV를 파싱한다.
 * 기대 헤더: name, grade, scheduledDays, scheduledStartTime, scheduledEndTime,
 *            dayTimes(선택), fee(선택), note(선택), withdrawnAt(선택), preschool(선택)
 * scheduledDays는 'Mon,Wed,Fri' 처럼 쉼표로 잇는다.
 * dayTimes는 'Mon=14:00-16:00|Wed=17:00-19:00' 형태로, 기본 시간과 다른 요일만 적는다.
 * note는 동명이인 구분용 한 마디, withdrawnAt은 'YYYY-MM-DD' 퇴원일, preschool은 미취학
 * 아동 표시('예'·'1'·'true'·'y'면 켬)다.
 * 이 열들이 없는 옛 파일도 그대로 읽힌다 — 없으면 기본값으로 떨어진다.
 *
 * 이전 구현은 (1) 헤더가 하나라도 빠지면 row.scheduledDays.split에서 그대로 죽고,
 * (2) papaparse가 문자열 입력에서는 error 콜백을 부르지 않고 results.errors에
 * 담기 때문에 reject 경로가 사실상 죽은 코드였다. 두 가지 모두 행 단위로 처리한다.
 */
export const parseCSV = (csvData: string): Promise<ParseCSVResult> => {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string | undefined>>(csvData, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const students: Student[] = [];
        const skipped: ParseCSVResult['skipped'] = [];

        results.data.forEach((row, index) => {
          const rowNumber = index + 2; // 헤더가 1행

          const name = row.name?.trim();
          if (!name) {
            skipped.push({ row: rowNumber, reason: 'name 값이 비어 있습니다.' });
            return;
          }

          const scheduledDays = (row.scheduledDays ?? '')
            .split(',')
            .map((day) => day.trim())
            .filter((day): day is DayOfWeek => VALID_DAYS.includes(day as DayOfWeek));

          if (scheduledDays.length === 0) {
            skipped.push({ row: rowNumber, reason: 'scheduledDays를 해석할 수 없습니다.' });
            return;
          }

          const start = row.scheduledStartTime?.trim();
          const end = row.scheduledEndTime?.trim();
          if (!isTimeString(start) || !isTimeString(end)) {
            skipped.push({ row: rowNumber, reason: '수업 시간 형식이 HH:mm이 아닙니다.' });
            return;
          }

          const parsedFee = Number((row.fee ?? '').replace(/[^0-9]/g, ''));

          students.push({
            id: createId(),
            name,
            grade: row.grade?.trim() ?? '',
            scheduledDays,
            scheduledStartTime: start,
            scheduledEndTime: end,
            dayTimes: parseDayTimes(row.dayTimes),
            fee: parsedFee > 0 ? parsedFee : undefined,
            note: row.note?.trim() || null,
            withdrawnAt: asDateKey(row.withdrawnAt),
            preschool: asFlag(row.preschool),
          });
        });

        resolve({ students, skipped });
      },
      error: (error: Error) => reject(error),
    });
  });
};

/*
 * 내보내기. 사람이 엑셀에서 읽는 표라 id·관계는 빠진다 — 그래서 되돌릴 수 없고, 복구용은
 * 전체 백업(sync/backup)이다. 원생 명단만은 위의 parseCSV가 다시 읽을 수 있는 형식이다.
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
      note: s.note ?? '',
      withdrawnAt: s.withdrawnAt ?? '',
      // 내보낸 파일을 그대로 가져와도 같은 원생이 되어야 한다. 빠지면 한 번 왕복에 표시가 지워진다.
      preschool: s.preschool ? '예' : '',
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
        'note',
        'withdrawnAt',
        'preschool',
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
        leaveTime: r.leaveTime ?? '',
        name: byId.get(r.studentId)?.name ?? '(삭제된 원생)',
        grade: byId.get(r.studentId)?.grade ?? '',
        note: byId.get(r.studentId)?.note ?? '',
        status: STATUS_LABEL[r.status] ?? r.status,
        type: r.type === 'makeUp' ? '보충' : '정규',
      })),
      { columns: ['date', 'time', 'leaveTime', 'name', 'grade', 'note', 'status', 'type'] }
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
        note: byId.get(m.studentId)?.note ?? '',
        originalDate: m.originalDate,
        makeUpDate: m.makeUpDate ?? '',
        completed: m.completed ? '완료' : '대기',
      })),
      { columns: ['name', 'note', 'originalDate', 'makeUpDate', 'completed'] }
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
