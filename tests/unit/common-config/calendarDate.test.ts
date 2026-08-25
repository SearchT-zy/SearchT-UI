import { describe, expect, it } from 'vitest';
import {
  calculateReminderAt,
  localDateForInstant,
  overlapsLocalDateRange,
  parseLocalDate,
} from '@/common/searcht/calendarDate';

describe('calendar date rules', () => {
  it('uses half-open ranges for all-day events', () => {
    const event = { startLocalDate: '2026-08-13', endLocalDate: '2026-08-15' };
    expect(overlapsLocalDateRange(event, '2026-08-13', '2026-08-14')).toBe(true);
    expect(overlapsLocalDateRange(event, '2026-08-15', '2026-08-16')).toBe(false);
  });

  it('converts an instant into the requested local date', () => {
    expect(localDateForInstant('2026-08-13T16:30:00.000Z', 'Asia/Shanghai')).toBe('2026-08-14');
  });

  it('calculates reminder instants from an ISO event instant', () => {
    expect(calculateReminderAt('2026-08-14T09:00:00+08:00', 15)).toBe('2026-08-14T00:45:00.000Z');
  });

  it('rejects malformed local dates', () => {
    expect(() => parseLocalDate('2026-02-30')).toThrow('Invalid local date');
  });
});
