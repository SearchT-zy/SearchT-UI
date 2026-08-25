import {
  TASK_PRIORITIES,
  type TaskCreateInput,
  type TaskPriority,
  type TaskRecurrenceEnd,
  type TaskRecurrenceRule,
} from '@/common/types/searcht/tasks';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isPriority(value: unknown): value is TaskPriority {
  return typeof value === 'string' && TASK_PRIORITIES.includes(value as TaskPriority);
}

export function normalizeTaskCreateInput(input: TaskCreateInput): TaskCreateInput {
  const title = input.title.trim();
  if (title.length === 0) throw new Error('Task title must not be empty');
  if (title.length > 200) throw new Error('Task title must be at most 200 characters');

  const notes = input.notes?.trim() ?? '';
  if (notes.length > 10000) throw new Error('Task notes must be at most 10000 characters');
  if (input.dueLocalDate != null && input.dueLocalDate !== '' && !isDate(input.dueLocalDate)) {
    throw new Error('Task due date must use YYYY-MM-DD');
  }
  if (
    input.estimatedMinutes != null &&
    (!Number.isInteger(input.estimatedMinutes) || input.estimatedMinutes < 1 || input.estimatedMinutes > 1440)
  ) {
    throw new Error('Task duration must be between 1 and 1440 minutes');
  }

  const priority = input.priority ?? 'none';
  if (!isPriority(priority)) throw new Error('Invalid task priority');
  return {
    title,
    notes,
    priority,
    dueAt: input.dueAt ?? null,
    dueLocalDate: input.dueLocalDate || null,
    estimatedMinutes: input.estimatedMinutes ?? null,
    ...(input.recurrence ? { recurrence: normalizeRecurrence(input.recurrence) } : {}),
  };
}

export function normalizeRecurrenceRule(rule: TaskRecurrenceRule): TaskRecurrenceRule {
  if (!rule || typeof rule !== 'object') throw new Error('Invalid task recurrence rule');
  if (rule.frequency === 'daily') {
    validateInterval(rule.interval);
    return { frequency: 'daily', interval: rule.interval };
  }
  if (rule.frequency === 'weekdays') return { frequency: 'weekdays', interval: 1 };
  if (rule.frequency === 'weekly') {
    validateInterval(rule.interval);
    if (!Array.isArray(rule.weekdays) || rule.weekdays.length === 0) {
      throw new Error('Task recurrence weekdays must not be empty');
    }
    const weekdays = [...new Set(rule.weekdays)].toSorted((a, b) => a - b);
    if (weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      throw new Error('Task recurrence weekdays must use values from 0 to 6');
    }
    return { frequency: 'weekly', interval: rule.interval, weekdays };
  }
  if (rule.frequency === 'monthly') {
    validateInterval(rule.interval);
    if (!Number.isInteger(rule.dayOfMonth) || rule.dayOfMonth < 1 || rule.dayOfMonth > 31) {
      throw new Error('Task recurrence day must be between 1 and 31');
    }
    return { frequency: 'monthly', interval: rule.interval, dayOfMonth: rule.dayOfMonth };
  }
  throw new Error('Invalid task recurrence frequency');
}

export function normalizeRecurrenceEnd(end: TaskRecurrenceEnd): TaskRecurrenceEnd {
  if (!end || typeof end !== 'object') throw new Error('Invalid task recurrence end');
  if (end.kind === 'never') return { kind: 'never' };
  if (end.kind === 'until') {
    if (!isDate(end.date)) throw new Error('Task recurrence end date must use YYYY-MM-DD');
    return { kind: 'until', date: end.date };
  }
  if (end.kind === 'count') {
    if (!Number.isInteger(end.occurrences) || end.occurrences < 1 || end.occurrences > 10000) {
      throw new Error('Task recurrence count must be between 1 and 10000');
    }
    return { kind: 'count', occurrences: end.occurrences };
  }
  throw new Error('Invalid task recurrence end');
}

function normalizeRecurrence(recurrence: NonNullable<TaskCreateInput['recurrence']>) {
  return {
    rule: normalizeRecurrenceRule(recurrence.rule),
    end: normalizeRecurrenceEnd(recurrence.end ?? { kind: 'never' }),
    timezone: recurrence.timezone ?? 'Asia/Shanghai',
  };
}

function validateInterval(interval: number): void {
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) {
    throw new Error('Task recurrence interval must be between 1 and 365');
  }
}
