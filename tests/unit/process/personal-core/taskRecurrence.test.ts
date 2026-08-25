import { describe, expect, it } from 'vitest';
import { nextOccurrenceDate, recurrenceAllowsOccurrence } from '@/common/searcht/taskRecurrence';

describe('task recurrence', () => {
  it('advances daily and weekdays occurrences', () => {
    expect(nextOccurrenceDate('2026-08-13', { frequency: 'daily', interval: 2 })).toBe('2026-08-15');
    expect(nextOccurrenceDate('2026-08-14', { frequency: 'weekdays', interval: 1 })).toBe('2026-08-17');
  });

  it('advances weekly occurrences across a week boundary', () => {
    expect(nextOccurrenceDate('2026-08-14', { frequency: 'weekly', interval: 1, weekdays: [1, 3, 5] })).toBe(
      '2026-08-17'
    );
    expect(nextOccurrenceDate('2026-08-12', { frequency: 'weekly', interval: 2, weekdays: [1, 3] })).toBe('2026-08-24');
  });

  it('falls back to the last day for short months', () => {
    expect(nextOccurrenceDate('2026-01-31', { frequency: 'monthly', interval: 1, dayOfMonth: 31 })).toBe('2026-02-28');
  });

  it('applies until and count end conditions', () => {
    expect(recurrenceAllowsOccurrence('2026-08-20', { kind: 'until', date: '2026-08-20' })).toBe(true);
    expect(recurrenceAllowsOccurrence('2026-08-21', { kind: 'until', date: '2026-08-20' })).toBe(false);
    expect(recurrenceAllowsOccurrence('2026-08-20', { kind: 'count', occurrences: 2 }, 3)).toBe(false);
  });

  it('allows the final occurrence in a count-limited series', () => {
    expect(recurrenceAllowsOccurrence('2026-08-14', { kind: 'count', occurrences: 2 }, 2)).toBe(true);
    expect(recurrenceAllowsOccurrence('2026-08-15', { kind: 'count', occurrences: 2 }, 3)).toBe(false);
  });
});
