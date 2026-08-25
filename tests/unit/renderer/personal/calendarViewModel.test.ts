import { describe, expect, it } from 'vitest';
import { buildMonthCells } from '@renderer/pages/calendar/calendarViewModel';

describe('calendar view model', () => {
  it('builds a stable Monday-first six-week grid', () => {
    const cells = buildMonthCells('2026-08-01', '2026-08-13');
    expect(cells).toHaveLength(42);
    expect(cells[0]).toEqual(expect.objectContaining({ localDate: '2026-07-27', inMonth: false }));
    expect(cells.find((cell) => cell.localDate === '2026-08-13')).toEqual(expect.objectContaining({ isToday: true }));
  });
});
