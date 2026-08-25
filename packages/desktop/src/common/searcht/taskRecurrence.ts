import type { TaskRecurrenceEnd, TaskRecurrenceRule } from '@/common/types/searcht/tasks';

function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(date: Date): string {
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
    .map((value, index) => (index === 0 ? String(value).padStart(4, '0') : String(value).padStart(2, '0')))
    .join('-');
}

function addDays(date: Date, amount: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + amount);
  return result;
}

export function nextOccurrenceDate(current: string, rule: TaskRecurrenceRule): string {
  const date = parseDate(current);
  if (rule.frequency === 'daily') return formatDate(addDays(date, rule.interval));
  if (rule.frequency === 'weekdays') {
    let next = addDays(date, 1);
    while (next.getUTCDay() === 0 || next.getUTCDay() === 6) next = addDays(next, 1);
    return formatDate(next);
  }
  if (rule.frequency === 'weekly') {
    const currentWeekMonday = addDays(date, -((date.getUTCDay() + 6) % 7));
    if (rule.interval === 1) {
      for (let offset = 1; offset <= 6; offset += 1) {
        const candidate = addDays(date, offset);
        if (rule.weekdays.includes(candidate.getUTCDay())) return formatDate(candidate);
      }
    }
    return formatDate(addDays(currentWeekMonday, rule.interval * 7 + rule.weekdays[0] - 1));
  }

  const targetMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + rule.interval, 1));
  const lastDay = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate();
  targetMonth.setUTCDate(Math.min(rule.dayOfMonth, lastDay));
  return formatDate(targetMonth);
}

export function recurrenceAllowsOccurrence(date: string, end: TaskRecurrenceEnd, occurrenceNumber = 1): boolean {
  if (end.kind === 'never') return true;
  if (end.kind === 'until') return date <= end.date;
  return occurrenceNumber <= end.occurrences;
}
