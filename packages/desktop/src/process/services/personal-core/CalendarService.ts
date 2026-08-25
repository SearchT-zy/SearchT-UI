import { randomUUID } from 'node:crypto';
import type {
  CalendarEvent,
  CalendarEventCreateInput,
  CalendarEventUpdateInput,
  CalendarRangeQuery,
  CalendarScope,
  CalendarSeries,
  Reminder,
  ScheduleBlock,
  ScheduleBlockCreateInput,
  ScheduleBlockUpdateInput,
  TodaySchedule,
} from '@/common/types/searcht/calendar';
import { REMINDER_OFFSET_MINUTES } from '@/common/types/searcht/calendar';
import { addLocalDays, calculateReminderAt, parseLocalDate } from '@/common/searcht/calendarDate';
import { expandCalendarOccurrences } from '@/common/searcht/calendarRecurrence';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import { CalendarRepository } from './CalendarRepository';

const MATERIALIZATION_MONTHS = 12;

export class CalendarService {
  private readonly repository: CalendarRepository;

  constructor(private readonly driver: ISqliteDriver) {
    this.repository = new CalendarRepository(driver);
  }

  listEvents(query: CalendarRangeQuery): CalendarEvent[] {
    validateRange(query);
    return this.repository.listEvents(query);
  }

  getEvent(id: string): CalendarEvent | null {
    return this.repository.findEvent(id);
  }

  createEvent(input: CalendarEventCreateInput, now = Date.now()): CalendarEvent {
    const normalized = normalizeEventInput(input);
    return this.repository.transaction(() => {
      const series = normalized.recurrence
        ? this.repository.insertSeries({
            id: randomUUID(),
            rule: normalized.recurrence.rule,
            end: normalized.recurrence.end ?? { kind: 'never' },
            timezone: normalized.recurrence.timezone ?? normalized.timezone,
            startsAt: normalized.startsAt ?? `${normalized.startLocalDate}T09:00:00+08:00`,
            stoppedAt: null,
            createdAt: now,
            updatedAt: now,
          })
        : null;
      const created = this.repository.insertEvent(buildEvent(normalized, series, now));
      this.syncEventReminder(created, now);
      if (series) this.materializeSeries(series, created, now);
      this.repository.insertAudit(
        randomUUID(),
        'calendar_event_create',
        { eventId: created.id, seriesId: series?.id },
        now
      );
      return created;
    });
  }

  createEventFromInbox(input: CalendarEventCreateInput, targetId: string, now = Date.now()): CalendarEvent {
    const normalized = normalizeEventInput(input);
    if (normalized.recurrence) throw new Error('INBOX_CONVERSION_RECURRENCE_UNSUPPORTED');
    const event = this.repository.insertEvent({ ...buildEvent(normalized, null, now), id: targetId });
    this.syncEventReminder(event, now);
    return event;
  }

  updateEvent(input: CalendarEventUpdateInput, scope: CalendarScope = 'single', now = Date.now()): CalendarEvent {
    const current = this.requireEvent(input.id);
    const normalized = normalizeEventInput({
      title: input.title ?? current.title,
      description: input.description ?? current.description,
      location: input.location ?? current.location,
      allDay: input.allDay ?? current.allDay,
      startsAt: input.startsAt === undefined ? current.startsAt : input.startsAt,
      endsAt: input.endsAt === undefined ? current.endsAt : input.endsAt,
      startLocalDate: input.startLocalDate ?? current.startLocalDate,
      endLocalDate: input.endLocalDate ?? current.endLocalDate,
      timezone: input.timezone ?? current.timezone,
      reminderMinutes: input.reminderMinutes === undefined ? current.reminderMinutes : input.reminderMinutes,
      recurrence: input.recurrence === undefined ? undefined : (input.recurrence ?? undefined),
    });
    if (!current.seriesId || scope === 'single') {
      return this.repository.transaction(() => {
        const updated = this.repository.updateEvent({ ...current, ...eventFields(normalized), updatedAt: now });
        this.syncEventReminder(updated, now);
        return updated;
      });
    }
    if (scope !== 'this-and-future') throw new Error('Invalid calendar scope');
    return this.repository.transaction(() => this.splitSeries(current, normalized, now));
  }

  removeEvent(id: string, scope: CalendarScope = 'single', now = Date.now()): void {
    this.repository.transaction(() => {
      const current = this.requireEvent(id);
      this.repository.setEventDeletedAt(id, now);
      this.repository.cancelReminder('event', id, now);
      if (scope === 'this-and-future' && current.seriesId) {
        const series = this.repository.findSeries(current.seriesId);
        if (series)
          this.repository.updateSeries({
            ...series,
            stoppedAt: current.startsAt ?? current.startLocalDate,
            updatedAt: now,
          });
        for (const future of this.repository.listSeriesEvents(current.seriesId)) {
          if (future.id !== id && (future.occurrenceKey ?? '') >= (current.occurrenceKey ?? '')) {
            this.repository.setEventDeletedAt(future.id, now);
            this.repository.cancelReminder('event', future.id, now);
          }
        }
        this.repository.insertAudit(
          randomUUID(),
          'calendar_series_stop',
          { eventId: id, seriesId: current.seriesId },
          now
        );
      } else if (scope !== 'single') {
        throw new Error('Invalid calendar scope');
      }
    });
  }

  restoreEvent(id: string, now = Date.now()): CalendarEvent {
    return this.repository.transaction(() => {
      const current = this.requireEvent(id);
      const series = current.seriesId ? this.repository.findSeries(current.seriesId) : null;
      const detach = Boolean(current.seriesId && (!series || series.stoppedAt));
      const restored = this.repository.updateEvent({
        ...current,
        seriesId: detach ? null : current.seriesId,
        occurrenceKey: detach ? null : current.occurrenceKey,
        deletedAt: null,
        updatedAt: now,
      });
      this.syncEventReminder(restored, now);
      this.repository.insertAudit(randomUUID(), 'calendar_event_restore', { eventId: id }, now);
      return restored;
    });
  }

  destroyEvent(id: string, now = Date.now()): void {
    this.repository.transaction(() => {
      const event = this.requireEvent(id);
      this.repository.cancelReminder('event', id, now);
      this.repository.destroyEvent(id);
      this.repository.insertAudit(
        randomUUID(),
        'calendar_event_destroy',
        { eventId: id, seriesId: event.seriesId },
        now
      );
    });
  }

  emptyTrash(now = Date.now()): number {
    return this.repository.transaction(() => {
      const events = this.repository.listEvents({
        startLocalDate: '0001-01-01',
        endLocalDate: '9999-12-31',
        trash: true,
      });
      for (const event of events) this.repository.cancelReminder('event', event.id, now);
      const removed = this.repository.emptyEventTrash();
      this.repository.insertAudit(randomUUID(), 'calendar_trash_empty', { removed }, now);
      return removed;
    });
  }

  listBlocks(query: CalendarRangeQuery): ScheduleBlock[] {
    validateRange(query);
    return this.repository.listBlocks(query);
  }

  createBlock(input: ScheduleBlockCreateInput, now = Date.now()): ScheduleBlock {
    validateBlock(input);
    return this.repository.transaction(() => {
      const block = this.repository.insertBlock({
        id: randomUUID(),
        taskId: input.taskId,
        startsAt: new Date(input.startsAt).toISOString(),
        endsAt: new Date(input.endsAt).toISOString(),
        localDate: input.localDate,
        timezone: input.timezone,
        reminderMinutes: input.reminderMinutes ?? null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      this.syncBlockReminder(block, now);
      this.repository.insertAudit(
        randomUUID(),
        'schedule_block_create',
        { blockId: block.id, taskId: block.taskId },
        now
      );
      return block;
    });
  }

  updateBlock(input: ScheduleBlockUpdateInput, now = Date.now()): ScheduleBlock {
    const current = this.requireBlock(input.id);
    const next = { ...current, ...input, updatedAt: now };
    validateBlock(next);
    return this.repository.transaction(() => {
      const updated = this.repository.updateBlock(next);
      this.syncBlockReminder(updated, now);
      return updated;
    });
  }

  removeBlock(id: string, now = Date.now()): void {
    this.requireBlock(id);
    this.repository.transaction(() => {
      this.repository.setBlockDeletedAt(id, now);
      this.repository.cancelReminder('schedule-block', id, now);
      this.repository.insertAudit(randomUUID(), 'schedule_block_remove', { blockId: id }, now);
    });
  }

  restoreBlock(id: string, now = Date.now()): ScheduleBlock {
    const block = this.requireBlock(id);
    const restored = this.repository.updateBlock({ ...block, deletedAt: null, updatedAt: now });
    this.syncBlockReminder(restored, now);
    return restored;
  }

  destroyBlock(id: string, now = Date.now()): void {
    this.requireBlock(id);
    this.repository.transaction(() => {
      this.repository.cancelReminder('schedule-block', id, now);
      this.repository.destroyBlock(id);
      this.repository.insertAudit(randomUUID(), 'schedule_block_destroy', { blockId: id }, now);
    });
  }

  getToday(localDate: string): TodaySchedule {
    parseLocalDate(localDate);
    const range = { startLocalDate: localDate, endLocalDate: addLocalDays(localDate, 1) };
    return { events: this.listEvents(range), blocks: this.listBlocks(range) };
  }

  private splitSeries(current: CalendarEvent, input: CalendarEventCreateInput, now: number): CalendarEvent {
    const oldSeries = this.repository.findSeries(current.seriesId!);
    if (!oldSeries) return this.repository.updateEvent({ ...current, ...eventFields(input), updatedAt: now });
    const newSeries = this.repository.insertSeries({
      id: randomUUID(),
      rule: input.recurrence?.rule ?? oldSeries.rule,
      end: input.recurrence?.end ?? oldSeries.end,
      timezone: input.recurrence?.timezone ?? input.timezone,
      startsAt: input.startsAt ?? oldSeries.startsAt,
      stoppedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    this.repository.updateSeries({
      ...oldSeries,
      stoppedAt: current.startsAt ?? current.startLocalDate,
      updatedAt: now,
    });
    const future = this.repository
      .listSeriesEvents(oldSeries.id)
      .filter((event) => (event.occurrenceKey ?? '') >= (current.occurrenceKey ?? ''));
    let selected: CalendarEvent | null = null;
    for (const event of future) {
      const updated = this.repository.updateEvent({
        ...event,
        ...eventFields(input),
        startsAt: event.id === current.id ? (input.startsAt ?? event.startsAt) : event.startsAt,
        endsAt: event.id === current.id ? (input.endsAt ?? event.endsAt) : event.endsAt,
        startLocalDate: event.id === current.id ? input.startLocalDate : event.startLocalDate,
        endLocalDate: event.id === current.id ? input.endLocalDate : event.endLocalDate,
        seriesId: newSeries.id,
        occurrenceKey: event.id === current.id ? occurrenceKey(input) : event.occurrenceKey,
        updatedAt: now,
      });
      this.syncEventReminder(updated, now);
      if (event.id === current.id) selected = updated;
    }
    this.repository.insertAudit(
      randomUUID(),
      'calendar_series_split',
      { eventId: current.id, previousSeriesId: oldSeries.id, nextSeriesId: newSeries.id },
      now
    );
    return selected ?? this.requireEvent(current.id);
  }

  private materializeSeries(series: CalendarSeries, seed: CalendarEvent, now: number): void {
    const rangeEnd = addMonths(seed.startLocalDate, MATERIALIZATION_MONTHS);
    const occurrences = expandCalendarOccurrences(series, {
      startLocalDate: seed.startLocalDate,
      endLocalDate: rangeEnd,
    });
    const durationDays = daysBetween(seed.startLocalDate, seed.endLocalDate);
    for (const occurrence of occurrences) {
      if (occurrence.occurrenceKey === seed.occurrenceKey) continue;
      const dayOffset = daysBetween(seed.startLocalDate, occurrence.localDate);
      const event = this.repository.insertEvent({
        ...seed,
        id: randomUUID(),
        startsAt: seed.startsAt ? shiftInstant(seed.startsAt, dayOffset) : null,
        endsAt: seed.endsAt ? shiftInstant(seed.endsAt, dayOffset) : null,
        startLocalDate: occurrence.localDate,
        endLocalDate: addLocalDays(occurrence.localDate, durationDays),
        occurrenceKey: occurrence.occurrenceKey,
        createdAt: now,
        updatedAt: now,
      });
      this.syncEventReminder(event, now);
    }
  }

  private syncEventReminder(event: CalendarEvent, now: number): void {
    if (event.reminderMinutes === null) {
      this.repository.cancelReminder('event', event.id, now);
      return;
    }
    const startsAt = event.startsAt ?? `${event.startLocalDate}T09:00:00+08:00`;
    this.repository.upsertReminder(reminderFor('event', event.id, startsAt, event.reminderMinutes, now));
  }

  private syncBlockReminder(block: ScheduleBlock, now: number): void {
    if (block.reminderMinutes === null) {
      this.repository.cancelReminder('schedule-block', block.id, now);
      return;
    }
    this.repository.upsertReminder(reminderFor('schedule-block', block.id, block.startsAt, block.reminderMinutes, now));
  }

  private requireEvent(id: string): CalendarEvent {
    const event = this.repository.findEvent(id);
    if (!event) throw new Error('Calendar event not found');
    return event;
  }

  private requireBlock(id: string): ScheduleBlock {
    const block = this.repository.findBlock(id);
    if (!block) throw new Error('Schedule block not found');
    return block;
  }
}

function normalizeEventInput(input: CalendarEventCreateInput): CalendarEventCreateInput {
  const title = input.title.trim();
  if (!title) throw new Error('Event title is required');
  parseLocalDate(input.startLocalDate);
  parseLocalDate(input.endLocalDate);
  assertTimezone(input.timezone);
  if (input.endLocalDate <= input.startLocalDate) throw new Error('Event end date must be after start date');
  if (!input.allDay) {
    if (!input.startsAt || !input.endsAt) throw new Error('Timed events require start and end');
    if (new Date(input.endsAt).getTime() <= new Date(input.startsAt).getTime())
      throw new Error('Event end must be after start');
  }
  if (
    input.reminderMinutes !== undefined &&
    input.reminderMinutes !== null &&
    !REMINDER_OFFSET_MINUTES.includes(input.reminderMinutes)
  ) {
    throw new Error('Invalid reminder offset');
  }
  return {
    ...input,
    title,
    description: input.description?.trim() ?? '',
    location: input.location?.trim() ?? '',
    startsAt: input.allDay ? null : new Date(input.startsAt!).toISOString(),
    endsAt: input.allDay ? null : new Date(input.endsAt!).toISOString(),
    reminderMinutes: input.reminderMinutes ?? null,
  };
}

function buildEvent(input: CalendarEventCreateInput, series: CalendarSeries | null, now: number): CalendarEvent {
  return {
    id: randomUUID(),
    ...eventFields(input),
    seriesId: series?.id ?? null,
    occurrenceKey: series ? occurrenceKey(input) : null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

function eventFields(
  input: CalendarEventCreateInput
): Pick<
  CalendarEvent,
  | 'title'
  | 'description'
  | 'location'
  | 'allDay'
  | 'startsAt'
  | 'endsAt'
  | 'startLocalDate'
  | 'endLocalDate'
  | 'timezone'
  | 'reminderMinutes'
> {
  return {
    title: input.title,
    description: input.description ?? '',
    location: input.location ?? '',
    allDay: input.allDay,
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    startLocalDate: input.startLocalDate,
    endLocalDate: input.endLocalDate,
    timezone: input.timezone,
    reminderMinutes: input.reminderMinutes ?? null,
  };
}

function occurrenceKey(input: CalendarEventCreateInput): string {
  if (input.allDay || !input.startsAt) return input.startLocalDate;
  const values = new Intl.DateTimeFormat('en-US', {
    timeZone: input.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(new Date(input.startsAt))
    .reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
  return `${input.startLocalDate}T${values.hour}:${values.minute}`;
}

function reminderFor(
  ownerType: Reminder['ownerType'],
  ownerId: string,
  startsAt: string,
  minutes: number,
  now: number
): Reminder {
  return {
    id: randomUUID(),
    ownerType,
    ownerId,
    scheduledAt: new Date(calculateReminderAt(startsAt, minutes)).getTime(),
    status: 'pending',
    attempts: 0,
    claimedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
}

function validateRange(query: CalendarRangeQuery): void {
  parseLocalDate(query.startLocalDate);
  parseLocalDate(query.endLocalDate);
  const days = daysBetween(query.startLocalDate, query.endLocalDate);
  if (days <= 0 || days > 460) throw new Error('Calendar query range is invalid');
}

function validateBlock(input: ScheduleBlockCreateInput | ScheduleBlock): void {
  if (!input.taskId.trim()) throw new Error('Task is required');
  parseLocalDate(input.localDate);
  assertTimezone(input.timezone);
  if (new Date(input.endsAt).getTime() <= new Date(input.startsAt).getTime())
    throw new Error('Schedule block end must be after start');
  if (
    input.reminderMinutes !== undefined &&
    input.reminderMinutes !== null &&
    !REMINDER_OFFSET_MINUTES.includes(input.reminderMinutes)
  ) {
    throw new Error('Invalid reminder offset');
  }
}

function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new Error('Invalid timezone');
  }
}

function daysBetween(start: string, end: string): number {
  const left = parseLocalDate(start);
  const right = parseLocalDate(end);
  return Math.round(
    (Date.UTC(right.year, right.month - 1, right.day) - Date.UTC(left.year, left.month - 1, left.day)) / 86_400_000
  );
}

function addMonths(value: string, months: number): string {
  const parts = parseLocalDate(value);
  const date = new Date(Date.UTC(parts.year, parts.month - 1 + months, parts.day));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function shiftInstant(value: string, days: number): string {
  return new Date(new Date(value).getTime() + days * 86_400_000).toISOString();
}
