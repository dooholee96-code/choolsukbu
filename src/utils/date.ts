import { format, parse, isWithinInterval, getDay } from 'date-fns';
import { DayOfWeek } from '../types';

export const getCurrentDate = () => format(new Date(), 'yyyy-MM-dd');
export const getCurrentTime = () => format(new Date(), 'HH:mm');

export const getDayOfWeek = (date: Date): DayOfWeek => {
  const days: DayOfWeek[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[getDay(date)];
};

export const isTimeWithinRange = (time: string, startTime: string, endTime: string): boolean => {
  const today = format(new Date(), 'yyyy-MM-dd');
  const timeDate = parse(`${today} ${time}`, 'yyyy-MM-dd HH:mm', new Date());
  const startDate = parse(`${today} ${startTime}`, 'yyyy-MM-dd HH:mm', new Date());
  const endDate = parse(`${today} ${endTime}`, 'yyyy-MM-dd HH:mm', new Date());

  return isWithinInterval(timeDate, { start: startDate, end: endDate });
};
