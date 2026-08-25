const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type LocalDateParts = { year: number; month: number; day: number };

export function parseLocalDate(value: string): LocalDateParts {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid local date: ${value}`);
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() !== parts.month - 1 ||
    date.getUTCDate() !== parts.day
  ) {
    throw new Error(`Invalid local date: ${value}`);
  }
  return parts;
}

export function formatLocalDate(parts: LocalDateParts): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function addLocalDays(value: string, days: number): string {
  const parts = parseLocalDate(value);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return formatLocalDate({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
}

export function localDateForInstant(instant: string, timezone: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid instant: ${instant}`);
  const values = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
  return `${values.year}-${values.month}-${values.day}`;
}

export function localTimeForInstant(instant: string, timezone: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid instant: ${instant}`);
  const values = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
  return `${values.hour}:${values.minute}`;
}

export function overlapsLocalDateRange(
  value: { startLocalDate: string; endLocalDate: string },
  rangeStart: string,
  rangeEnd: string
): boolean {
  parseLocalDate(value.startLocalDate);
  parseLocalDate(value.endLocalDate);
  parseLocalDate(rangeStart);
  parseLocalDate(rangeEnd);
  return value.startLocalDate < rangeEnd && value.endLocalDate > rangeStart;
}

export function calculateReminderAt(startsAt: string, offsetMinutes: number): string {
  const timestamp = new Date(startsAt).getTime();
  if (Number.isNaN(timestamp) || !Number.isInteger(offsetMinutes) || offsetMinutes < 0) {
    throw new Error('Invalid reminder input');
  }
  return new Date(timestamp - offsetMinutes * 60_000).toISOString();
}
