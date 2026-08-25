import { ipcBridge } from '@/common';
import type {
  CalendarEvent,
  CalendarEventCreateInput,
  CalendarEventUpdateInput,
  CalendarRangeQuery,
  CalendarScope,
  CalendarSeries,
  NotificationCapability,
  ScheduleBlock,
  ScheduleBlockCreateInput,
  ScheduleBlockUpdateInput,
  TodaySchedule,
} from '@/common/types/searcht/calendar';
import { overlapsLocalDateRange, parseLocalDate } from '@/common/searcht/calendarDate';
import { expandCalendarOccurrences } from '@/common/searcht/calendarRecurrence';
import { isElectronDesktop } from '@/renderer/utils/platform';

const STORAGE_KEY = 'searcht.calendar.v1';
type Document = { version: 1; events: CalendarEvent[]; series: CalendarSeries[]; blocks: ScheduleBlock[] };

export type CalendarClient = {
  list(query: CalendarRangeQuery): Promise<CalendarEvent[]>;
  get(id: string): Promise<CalendarEvent | null>;
  create(input: CalendarEventCreateInput): Promise<CalendarEvent>;
  update(input: CalendarEventUpdateInput, scope?: CalendarScope): Promise<CalendarEvent>;
  remove(id: string, scope?: CalendarScope): Promise<void>;
  restore(id: string): Promise<CalendarEvent>;
  destroy(id: string): Promise<void>;
  emptyTrash(): Promise<{ removed: number }>;
  listBlocks(query: CalendarRangeQuery): Promise<ScheduleBlock[]>;
  createBlock(input: ScheduleBlockCreateInput): Promise<ScheduleBlock>;
  updateBlock(input: ScheduleBlockUpdateInput): Promise<ScheduleBlock>;
  removeBlock(id: string): Promise<void>;
  restoreBlock(id: string): Promise<ScheduleBlock>;
  destroyBlock(id: string): Promise<void>;
  getToday(localDate: string): Promise<TodaySchedule>;
  getNotificationCapability(): Promise<NotificationCapability>;
};

function read(): Document {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return { version: 1, events: [], series: [], blocks: [] };
  try {
    const value = JSON.parse(raw) as Document;
    if (value.version === 1 && Array.isArray(value.events) && Array.isArray(value.blocks))
      return { ...value, series: Array.isArray(value.series) ? value.series : [] };
  } catch {
    localStorage.setItem(`${STORAGE_KEY}.corrupt.${Date.now()}`, raw);
    localStorage.removeItem(STORAGE_KEY);
  }
  return { version: 1, events: [], series: [], blocks: [] };
}

const write = (document: Document) => localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
const findEvent = (document: Document, id: string) => {
  const event = document.events.find((item) => item.id === id);
  if (!event) throw new Error('Calendar event not found');
  return event;
};
const findBlock = (document: Document, id: string) => {
  const block = document.blocks.find((item) => item.id === id);
  if (!block) throw new Error('Schedule block not found');
  return block;
};

function validateInput(input: CalendarEventCreateInput): CalendarEventCreateInput {
  const title = input.title.trim();
  if (!title) throw new Error('Event title is required');
  parseLocalDate(input.startLocalDate);
  parseLocalDate(input.endLocalDate);
  if (input.endLocalDate <= input.startLocalDate) throw new Error('Event end date must be after start date');
  if (!input.allDay && (!input.startsAt || !input.endsAt || new Date(input.endsAt) <= new Date(input.startsAt)))
    throw new Error('Event end must be after start');
  return {
    ...input,
    title,
    description: input.description?.trim() ?? '',
    location: input.location?.trim() ?? '',
    startsAt: input.allDay ? null : new Date(input.startsAt!).toISOString(),
    endsAt: input.allDay ? null : new Date(input.endsAt!).toISOString(),
  };
}

function createBrowserEvent(input: CalendarEventCreateInput, id: string = crypto.randomUUID()): CalendarEvent {
  const value = validateInput(input);
  const document = read();
  const existing = document.events.find((event) => event.id === id);
  if (existing) return existing;
  const now = Date.now();
  const series: CalendarSeries | null = value.recurrence
    ? {
        id: crypto.randomUUID(),
        rule: value.recurrence.rule,
        end: value.recurrence.end ?? { kind: 'never' },
        timezone: value.recurrence.timezone ?? value.timezone,
        startsAt: value.startsAt ?? `${value.startLocalDate}T09:00:00+08:00`,
        stoppedAt: null,
        createdAt: now,
        updatedAt: now,
      }
    : null;
  const event: CalendarEvent = {
    id,
    title: value.title,
    description: value.description ?? '',
    location: value.location ?? '',
    allDay: value.allDay,
    startsAt: value.startsAt ?? null,
    endsAt: value.endsAt ?? null,
    startLocalDate: value.startLocalDate,
    endLocalDate: value.endLocalDate,
    timezone: value.timezone,
    seriesId: series?.id ?? null,
    occurrenceKey: series ? value.startLocalDate : null,
    reminderMinutes: value.reminderMinutes ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  if (series) {
    document.series.push(series);
    const duration = dayDifference(value.startLocalDate, value.endLocalDate);
    for (const occurrence of expandCalendarOccurrences(series, {
      startLocalDate: value.startLocalDate,
      endLocalDate: addYears(value.startLocalDate, 1),
    })) {
      if (occurrence.localDate === value.startLocalDate) continue;
      const shift = dayDifference(value.startLocalDate, occurrence.localDate);
      document.events.push({
        ...event,
        id: crypto.randomUUID(),
        startsAt: event.startsAt
          ? new Date(new Date(event.startsAt).getTime() + shift * 86_400_000).toISOString()
          : null,
        endsAt: event.endsAt ? new Date(new Date(event.endsAt).getTime() + shift * 86_400_000).toISOString() : null,
        startLocalDate: occurrence.localDate,
        endLocalDate: addDays(occurrence.localDate, duration),
        occurrenceKey: occurrence.occurrenceKey,
      });
    }
  }
  document.events.push(event);
  write(document);
  return event;
}

export const browserCalendarConversionAdapter = {
  async get(id: string): Promise<CalendarEvent | null> {
    return read().events.find((event) => event.id === id) ?? null;
  },
  async create(input: CalendarEventCreateInput, id: string): Promise<CalendarEvent> {
    return createBrowserEvent(input, id);
  },
  async remove(id: string): Promise<void> {
    const document = read();
    const target = document.events.find((event) => event.id === id);
    if (!target) return;
    document.events = target.seriesId
      ? document.events.filter((event) => event.seriesId !== target.seriesId)
      : document.events.filter((event) => event.id !== id);
    if (target.seriesId) document.series = document.series.filter((series) => series.id !== target.seriesId);
    write(document);
  },
};

function browserClient(): CalendarClient {
  return {
    async list(query) {
      return read()
        .events.filter(
          (event) =>
            (query.trash ? event.deletedAt !== null : event.deletedAt === null) &&
            overlapsLocalDateRange(event, query.startLocalDate, query.endLocalDate)
        )
        .toSorted(
          (a, b) =>
            Number(b.allDay) - Number(a.allDay) ||
            (a.startsAt ?? a.startLocalDate).localeCompare(b.startsAt ?? b.startLocalDate)
        );
    },
    async get(id) {
      return read().events.find((event) => event.id === id) ?? null;
    },
    async create(input) {
      return createBrowserEvent(input);
    },
    async update(input, _scope = 'single') {
      const document = read();
      const current = findEvent(document, input.id);
      const value = validateInput({
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
      });
      Object.assign(current, value, { updatedAt: Date.now() });
      write(document);
      return current;
    },
    async remove(id) {
      const document = read();
      const event = findEvent(document, id);
      event.deletedAt = Date.now();
      event.updatedAt = event.deletedAt;
      write(document);
    },
    async restore(id) {
      const document = read();
      const event = findEvent(document, id);
      event.deletedAt = null;
      event.updatedAt = Date.now();
      write(document);
      return event;
    },
    async destroy(id) {
      const document = read();
      document.events = document.events.filter((event) => event.id !== id);
      write(document);
    },
    async emptyTrash() {
      const document = read();
      const before = document.events.length;
      document.events = document.events.filter((event) => event.deletedAt === null);
      write(document);
      return { removed: before - document.events.length };
    },
    async listBlocks(query) {
      return read()
        .blocks.filter(
          (block) =>
            (query.trash ? block.deletedAt !== null : block.deletedAt === null) &&
            block.localDate >= query.startLocalDate &&
            block.localDate < query.endLocalDate
        )
        .toSorted((a, b) => a.startsAt.localeCompare(b.startsAt));
    },
    async createBlock(input) {
      const document = read();
      const now = Date.now();
      const block: ScheduleBlock = {
        id: crypto.randomUUID(),
        ...input,
        reminderMinutes: input.reminderMinutes ?? null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      document.blocks.push(block);
      write(document);
      return block;
    },
    async updateBlock(input) {
      const document = read();
      const block = findBlock(document, input.id);
      Object.assign(block, input, { updatedAt: Date.now() });
      write(document);
      return block;
    },
    async removeBlock(id) {
      const document = read();
      const block = findBlock(document, id);
      block.deletedAt = Date.now();
      block.updatedAt = block.deletedAt;
      write(document);
    },
    async restoreBlock(id) {
      const document = read();
      const block = findBlock(document, id);
      block.deletedAt = null;
      block.updatedAt = Date.now();
      write(document);
      return block;
    },
    async destroyBlock(id) {
      const document = read();
      document.blocks = document.blocks.filter((block) => block.id !== id);
      write(document);
    },
    async getToday(localDate) {
      const query = { startLocalDate: localDate, endLocalDate: nextDate(localDate) };
      return { events: await this.list(query), blocks: await this.listBlocks(query) };
    },
    async getNotificationCapability() {
      return {
        available: 'Notification' in window,
        permission: 'Notification' in window ? Notification.permission : 'unsupported',
        backgroundReliable: false,
      };
    },
  };
}

function nextDate(value: string): string {
  const parts = parseLocalDate(value);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
function addDays(value: string, days: number): string {
  const parts = parseLocalDate(value);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
function dayDifference(start: string, end: string): number {
  const left = parseLocalDate(start);
  const right = parseLocalDate(end);
  return Math.round(
    (Date.UTC(right.year, right.month - 1, right.day) - Date.UTC(left.year, left.month - 1, left.day)) / 86_400_000
  );
}
function addYears(value: string, years: number): string {
  const parts = parseLocalDate(value);
  return `${parts.year + years}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export const calendarClient: CalendarClient = isElectronDesktop()
  ? {
      list: (query) => ipcBridge.calendar.list.invoke(query),
      get: (id) => ipcBridge.calendar.get.invoke({ id }),
      create: (input) => ipcBridge.calendar.create.invoke(input),
      update: (input, scope) => ipcBridge.calendar.update.invoke({ ...input, scope }),
      remove: (id, scope) => ipcBridge.calendar.remove.invoke({ id, scope }),
      restore: (id) => ipcBridge.calendar.restore.invoke({ id }),
      destroy: (id) => ipcBridge.calendar.destroy.invoke({ id }),
      emptyTrash: () => ipcBridge.calendar.emptyTrash.invoke(),
      listBlocks: (query) => ipcBridge.calendar.listBlocks.invoke(query),
      createBlock: (input) => ipcBridge.calendar.createBlock.invoke(input),
      updateBlock: (input) => ipcBridge.calendar.updateBlock.invoke(input),
      removeBlock: (id) => ipcBridge.calendar.removeBlock.invoke({ id }),
      restoreBlock: (id) => ipcBridge.calendar.restoreBlock.invoke({ id }),
      destroyBlock: (id) => ipcBridge.calendar.destroyBlock.invoke({ id }),
      getToday: (localDate) => ipcBridge.calendar.getToday.invoke({ localDate }),
      getNotificationCapability: () => ipcBridge.calendar.getNotificationCapability.invoke(),
    }
  : browserClient();
