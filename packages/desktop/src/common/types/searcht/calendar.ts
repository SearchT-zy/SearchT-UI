export const REMINDER_OFFSET_MINUTES = [0, 5, 15, 30, 60, 1440] as const;
export type ReminderOffsetMinutes = (typeof REMINDER_OFFSET_MINUTES)[number];

export type CalendarRecurrenceRule =
  | { frequency: 'daily'; interval: number }
  | { frequency: 'weekdays'; interval: 1 }
  | { frequency: 'weekly'; interval: number; weekdays: number[] }
  | { frequency: 'monthly'; interval: number; dayOfMonth: number };

export type CalendarRecurrenceEnd =
  | { kind: 'never' }
  | { kind: 'until'; localDate: string }
  | { kind: 'count'; occurrences: number };

export type CalendarSeries = {
  id: string;
  rule: CalendarRecurrenceRule;
  end: CalendarRecurrenceEnd;
  timezone: string;
  startsAt: string;
  stoppedAt: string | null;
  createdAt: number;
  updatedAt: number;
};

export type CalendarEvent = {
  id: string;
  title: string;
  description: string;
  location: string;
  allDay: boolean;
  startsAt: string | null;
  endsAt: string | null;
  startLocalDate: string;
  endLocalDate: string;
  timezone: string;
  seriesId: string | null;
  occurrenceKey: string | null;
  reminderMinutes: ReminderOffsetMinutes | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type ScheduleBlock = {
  id: string;
  taskId: string;
  startsAt: string;
  endsAt: string;
  localDate: string;
  timezone: string;
  reminderMinutes: ReminderOffsetMinutes | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type ReminderOwnerType = 'event' | 'schedule-block';
export type ReminderStatus = 'pending' | 'claimed' | 'delivered' | 'failed' | 'cancelled';

export type Reminder = {
  id: string;
  ownerType: ReminderOwnerType;
  ownerId: string;
  scheduledAt: number;
  status: ReminderStatus;
  attempts: number;
  claimedAt: number | null;
  deliveredAt: number | null;
  cancelledAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
};

export type CalendarRangeQuery = {
  startLocalDate: string;
  endLocalDate: string;
  trash?: boolean;
};

export type CalendarRecurrence = {
  rule: CalendarRecurrenceRule;
  end?: CalendarRecurrenceEnd;
  timezone?: string;
};

export type CalendarEventCreateInput = {
  title: string;
  description?: string;
  location?: string;
  allDay: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  startLocalDate: string;
  endLocalDate: string;
  timezone: string;
  reminderMinutes?: ReminderOffsetMinutes | null;
  recurrence?: CalendarRecurrence;
};

export type CalendarEventUpdateInput = Partial<Omit<CalendarEventCreateInput, 'recurrence'>> & {
  id: string;
  recurrence?: CalendarRecurrence | null;
};

export type ScheduleBlockCreateInput = {
  taskId: string;
  startsAt: string;
  endsAt: string;
  localDate: string;
  timezone: string;
  reminderMinutes?: ReminderOffsetMinutes | null;
};

export type ScheduleBlockUpdateInput = Partial<Omit<ScheduleBlockCreateInput, 'taskId'>> & { id: string };
export type CalendarScope = 'single' | 'this-and-future';
export type TodaySchedule = { events: CalendarEvent[]; blocks: ScheduleBlock[] };
export type NotificationCapability = {
  available: boolean;
  permission: 'granted' | 'denied' | 'default' | 'unsupported';
  backgroundReliable: boolean;
};
