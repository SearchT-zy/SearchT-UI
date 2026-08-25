import type { CalendarSeries } from '@/common/types/searcht/calendar';
import { addLocalDays, localDateForInstant, localTimeForInstant, parseLocalDate } from './calendarDate';

export type CalendarOccurrence = { localDate: string; occurrenceKey: string };
export type CalendarOccurrenceRange = { startLocalDate: string; endLocalDate: string };

const MAX_CANDIDATES = 10_000;
const MAX_RANGE_DAYS = 460;

function daysBetween(start: string, end: string): number {
  const left = parseLocalDate(start);
  const right = parseLocalDate(end);
  return Math.round(
    (Date.UTC(right.year, right.month - 1, right.day) - Date.UTC(left.year, left.month - 1, left.day)) / 86_400_000
  );
}

function weekday(value: string): number {
  const parts = parseLocalDate(value);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function monthDistance(start: string, candidate: string): number {
  const left = parseLocalDate(start);
  const right = parseLocalDate(candidate);
  return (right.year - left.year) * 12 + right.month - left.month;
}

function matches(series: CalendarSeries, startDate: string, candidate: string): boolean {
  const distance = daysBetween(startDate, candidate);
  if (distance < 0) return false;
  switch (series.rule.frequency) {
    case 'daily':
      return distance % series.rule.interval === 0;
    case 'weekdays': {
      const day = weekday(candidate);
      return day >= 1 && day <= 5;
    }
    case 'weekly':
      return Math.floor(distance / 7) % series.rule.interval === 0 && series.rule.weekdays.includes(weekday(candidate));
    case 'monthly': {
      const parts = parseLocalDate(candidate);
      return parts.day === series.rule.dayOfMonth && monthDistance(startDate, candidate) % series.rule.interval === 0;
    }
  }
}

function validateSeries(series: CalendarSeries): void {
  if (!Number.isInteger(series.rule.interval) || series.rule.interval < 1)
    throw new Error('Invalid recurrence interval');
  if (series.rule.frequency === 'weekly') {
    if (
      series.rule.weekdays.length === 0 ||
      series.rule.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
    ) {
      throw new Error('Invalid recurrence weekdays');
    }
  }
  if (series.rule.frequency === 'monthly' && (series.rule.dayOfMonth < 1 || series.rule.dayOfMonth > 31)) {
    throw new Error('Invalid recurrence day of month');
  }
}

export function expandCalendarOccurrences(
  series: CalendarSeries,
  range: CalendarOccurrenceRange
): CalendarOccurrence[] {
  validateSeries(series);
  const rangeDays = daysBetween(range.startLocalDate, range.endLocalDate);
  if (rangeDays < 0 || rangeDays > MAX_RANGE_DAYS) throw new Error('Calendar query range is invalid');
  const startDate = localDateForInstant(series.startsAt, series.timezone);
  const localTime = localTimeForInstant(series.startsAt, series.timezone);
  const stoppedDate = series.stoppedAt ? localDateForInstant(series.stoppedAt, series.timezone) : null;
  const occurrences: CalendarOccurrence[] = [];
  let occurrenceNumber = 0;
  let candidate = startDate;

  for (let checked = 0; checked < MAX_CANDIDATES && candidate < range.endLocalDate; checked += 1) {
    if (matches(series, startDate, candidate)) {
      occurrenceNumber += 1;
      const allowedByEnd =
        series.end.kind === 'never' ||
        (series.end.kind === 'until' && candidate <= series.end.localDate) ||
        (series.end.kind === 'count' && occurrenceNumber <= series.end.occurrences);
      if (!allowedByEnd || (stoppedDate && candidate >= stoppedDate)) break;
      if (candidate >= range.startLocalDate) {
        occurrences.push({ localDate: candidate, occurrenceKey: `${candidate}T${localTime}` });
      }
    }
    candidate = addLocalDays(candidate, 1);
  }
  return occurrences;
}
