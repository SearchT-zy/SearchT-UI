import { addLocalDays, parseLocalDate } from '@/common/searcht/calendarDate';

export type MonthCell = { localDate: string; day: number; inMonth: boolean; isToday: boolean };

export function buildMonthCells(monthDate: string, today: string): MonthCell[] {
  const parts = parseLocalDate(monthDate);
  const first = `${parts.year}-${String(parts.month).padStart(2, '0')}-01`;
  const firstWeekday = new Date(Date.UTC(parts.year, parts.month - 1, 1)).getUTCDay();
  const mondayOffset = (firstWeekday + 6) % 7;
  const gridStart = addLocalDays(first, -mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const localDate = addLocalDays(gridStart, index);
    const cell = parseLocalDate(localDate);
    return { localDate, day: cell.day, inMonth: cell.month === parts.month, isToday: localDate === today };
  });
}

export function monthRange(monthDate: string): { startLocalDate: string; endLocalDate: string } {
  const parts = parseLocalDate(monthDate);
  const startLocalDate = `${parts.year}-${String(parts.month).padStart(2, '0')}-01`;
  const next = new Date(Date.UTC(parts.year, parts.month, 1));
  return {
    startLocalDate,
    endLocalDate: `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`,
  };
}

export function shiftMonth(monthDate: string, amount: number): string {
  const parts = parseLocalDate(monthDate);
  const date = new Date(Date.UTC(parts.year, parts.month - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
