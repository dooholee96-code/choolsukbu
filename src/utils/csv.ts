import Papa from 'papaparse';
import { Student, DayOfWeek } from '../types';
import { createId } from './id';
import { parseDayTimes } from './schedule';

const VALID_DAYS: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface ParseCSVResult {
  students: Student[];
  /** 형식이 맞지 않아 건너뛴 행. 1-based 행 번호와 사유. */
  skipped: { row: number; reason: string }[];
}

const isTimeString = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value.trim());

/**
 * 원생 명단 CSV를 파싱한다.
 * 기대 헤더: name, grade, scheduledDays, scheduledStartTime, scheduledEndTime,
 *            dayTimes(선택), fee(선택)
 * scheduledDays는 'Mon,Wed,Fri' 처럼 쉼표로 잇는다.
 * dayTimes는 'Mon=14:00-16:00|Wed=17:00-19:00' 형태로, 기본 시간과 다른 요일만 적는다.
 * 이 열이 없는 옛 파일도 그대로 읽힌다 — 모든 요일이 기본 시간이 된다.
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
          });
        });

        resolve({ students, skipped });
      },
      error: (error: Error) => reject(error),
    });
  });
};
