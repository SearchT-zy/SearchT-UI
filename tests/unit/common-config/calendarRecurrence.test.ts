import { describe, expect, it } from 'vitest';
import { expandCalendarOccurrences } from '@/common/searcht/calendarRecurrence';
import type { CalendarSeries } from '@/common/types/searcht/calendar';

const range = { startLocalDate: '2026-08-16', endLocalDate: '2026-08-25' };

describe('calendar recurrence', () => {
  it('expands weekly weekdays within a bounded range', () => {
    const series: CalendarSeries = {
      id: 'series-1',
      rule: { frequency: 'weekly', interval: 1, weekdays: [1, 3] },
      end: { kind: 'never' },
      timezone: 'Asia/Shanghai',
      startsAt: '2026-08-17T09:00:00+08:00',
      stoppedAt: null,
      createdAt: 0,
      updatedAt: 0,
    };
    expect(expandCalendarOccurrences(series, range).map((item) => item.occurrenceKey)).toEqual([
      '2026-08-17T09:00',
      '2026-08-19T09:00',
      '2026-08-24T09:00',
    ]);
  });

  it('does not invent an impossible monthly day', () => {
    const series: CalendarSeries = {
      id: 'series-2',
      rule: { frequency: 'monthly', interval: 1, dayOfMonth: 31 },
      end: { kind: 'until', localDate: '2026-03-01' },
      timezone: 'Asia/Shanghai',
      startsAt: '2026-01-31T09:00:00+08:00',
      stoppedAt: null,
      createdAt: 0,
      updatedAt: 0,
    };
    expect(expandCalendarOccurrences(series, { startLocalDate: '2026-02-01', endLocalDate: '2026-03-01' })).toEqual([]);
  });
});
