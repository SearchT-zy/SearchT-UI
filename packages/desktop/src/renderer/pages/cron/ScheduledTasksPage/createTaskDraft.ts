import type { ICronSchedule } from '@/common/adapter/ipcBridge';

export type CreateTaskFrequency = 'manual' | 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'custom';
export type CreateTaskExecutionMode = 'new_conversation' | 'existing';

export type CreateTaskDialogInitialDraft = {
  name: string;
  prompt: string;
  schedule: Extract<ICronSchedule, { kind: 'cron' }>;
  executionMode?: CreateTaskExecutionMode;
  queueEnabled?: boolean;
};

export type ResolvedCreateTaskInitialDraft = {
  name: string;
  prompt: string;
  frequency: CreateTaskFrequency;
  time: string;
  weekday: string;
  executionMode: CreateTaskExecutionMode;
  queueEnabled: boolean;
};

export function resolveCreateTaskInitialDraft(draft: CreateTaskDialogInitialDraft): ResolvedCreateTaskInitialDraft {
  const parsed = parseCronExpr(draft.schedule.expr);
  return {
    name: draft.name,
    prompt: draft.prompt,
    frequency: parsed.frequency,
    time: parsed.time,
    weekday: parsed.weekday,
    executionMode: draft.executionMode ?? 'new_conversation',
    queueEnabled: draft.queueEnabled ?? false,
  };
}

export function parseCronExpr(expr: string): {
  frequency: CreateTaskFrequency;
  time: string;
  weekday: string;
} {
  if (!expr) return { frequency: 'manual', time: '09:00', weekday: 'MON' };
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return { frequency: 'custom', time: '09:00', weekday: 'MON' };
  const [minute, hour, day, month, weekday] = parts;
  if (hour === '*' && minute === '0' && day === '*' && month === '*' && weekday === '*') {
    return { frequency: 'hourly', time: '09:00', weekday: 'MON' };
  }
  if (weekday === 'MON-FRI' && day === '*' && month === '*') {
    return { frequency: 'weekdays', time: formatTime(hour, minute), weekday: 'MON' };
  }
  if (weekday !== '*' && day === '*' && month === '*' && /^[A-Z]{3}$/i.test(weekday)) {
    return { frequency: 'weekly', time: formatTime(hour, minute), weekday: weekday.toUpperCase() };
  }
  const hourNumber = Number(hour);
  const minuteNumber = Number(minute);
  if (
    day === '*' &&
    month === '*' &&
    weekday === '*' &&
    Number.isInteger(hourNumber) &&
    hourNumber >= 0 &&
    hourNumber <= 23 &&
    Number.isInteger(minuteNumber) &&
    minuteNumber >= 0 &&
    minuteNumber <= 59
  ) {
    return { frequency: 'daily', time: formatTime(hour, minute), weekday: 'MON' };
  }
  return { frequency: 'custom', time: '09:00', weekday: 'MON' };
}

function formatTime(hour: string, minute: string): string {
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}
