import { describe, expect, it } from 'vitest';
import {
  normalizeTaskCreateInput,
  normalizeRecurrenceEnd,
  normalizeRecurrenceRule,
} from '@/common/searcht/taskValidation';

describe('task validation', () => {
  it('trims a valid task and keeps optional fields', () => {
    expect(
      normalizeTaskCreateInput({
        title: '  Review inbox  ',
        notes: '  important  ',
        priority: 'high',
        dueLocalDate: '2026-08-13',
        estimatedMinutes: 30,
      })
    ).toEqual({
      title: 'Review inbox',
      notes: 'important',
      priority: 'high',
      dueAt: null,
      dueLocalDate: '2026-08-13',
      estimatedMinutes: 30,
    });
  });

  it('rejects an empty title and invalid duration', () => {
    expect(() => normalizeTaskCreateInput({ title: '   ' })).toThrow('Task title must not be empty');
    expect(() => normalizeTaskCreateInput({ title: 'Task', estimatedMinutes: 0 })).toThrow(
      'Task duration must be between 1 and 1440 minutes'
    );
  });

  it('normalizes weekly recurrence weekdays and rejects invalid dates', () => {
    expect(normalizeRecurrenceRule({ frequency: 'weekly', interval: 1, weekdays: [3, 1, 3] })).toEqual({
      frequency: 'weekly',
      interval: 1,
      weekdays: [1, 3],
    });
    expect(() => normalizeRecurrenceRule({ frequency: 'weekly', interval: 1, weekdays: [7] })).toThrow(
      'Task recurrence weekdays must use values from 0 to 6'
    );
  });

  it('normalizes recurrence end conditions', () => {
    expect(normalizeRecurrenceEnd({ kind: 'until', date: '2026-12-31' })).toEqual({
      kind: 'until',
      date: '2026-12-31',
    });
    expect(() => normalizeRecurrenceEnd({ kind: 'count', occurrences: 0 })).toThrow(
      'Task recurrence count must be between 1 and 10000'
    );
  });
});
