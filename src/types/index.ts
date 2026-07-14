export type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

export interface Student {
  id: string;
  name: string;
  grade: string;
  scheduledDays: DayOfWeek[];
  scheduledStartTime: string; // HH:mm format
  scheduledEndTime: string; // HH:mm format
  fee?: number; // Optional, for future use
}

export interface Attendance {
  id: string;
  studentId: string;
  date: string; // YYYY-MM-DD format
  time: string; // HH:mm format
  status: 'scheduled' | 'unexpected' | 'absent';
  type: 'checkIn' | 'makeUp';
}

export interface MakeUp {
  id: string;
  studentId: string;
  originalDate: string; // YYYY-MM-DD format
  makeUpDate?: string; // YYYY-MM-DD format
  completed: boolean;
}
