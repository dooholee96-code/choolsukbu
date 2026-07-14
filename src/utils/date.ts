import Papa from 'papaparse';
import { Student, DayOfWeek } from '../types';
import { v4 as uuidv4 } from 'uuid';

export const parseCSV = (csvData: string): Promise<Student[]> => {
  return new Promise((resolve, reject) => {
    Papa.parse(csvData, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const students: Student[] = results.data.map((row: any) => ({
          id: uuidv4(),
          name: row.name,
          grade: row.grade,
          scheduledDays: row.scheduledDays.split(',').map((day: string) => day.trim() as DayOfWeek),
          scheduledStartTime: row.scheduledStartTime,
          scheduledEndTime: row.scheduledEndTime,
          fee: row.fee ? parseInt(row.fee, 10) : undefined,
        }));
        resolve(students);
      },
      error: (error) => {
        reject(error);
      },
    });
  });
};
