import { ipcBridge } from '@/common';
import type {
  Task,
  TaskCreateInput,
  TaskListQuery,
  TaskScope,
  TaskSeries,
  TaskUpdateInput,
} from '@/common/types/searcht/tasks';
import { nextOccurrenceDate, recurrenceAllowsOccurrence } from '@/common/searcht/taskRecurrence';
import { normalizeTaskCreateInput } from '@/common/searcht/taskValidation';
import { isElectronDesktop } from '@/renderer/utils/platform';

const STORAGE_KEY = 'searcht.tasks.v1';
type BrowserDocument = { version: 1; tasks: Task[]; series: TaskSeries[] };

export type TaskClient = {
  list(query: TaskListQuery): Promise<Task[]>;
  create(input: TaskCreateInput): Promise<Task>;
  update(input: TaskUpdateInput, scope?: TaskScope): Promise<Task>;
  complete(id: string): Promise<{ task: Task; nextTask?: Task }>;
  reopen(id: string): Promise<Task>;
  remove(id: string, scope?: TaskScope): Promise<void>;
  restore(id: string): Promise<Task>;
  destroy(id: string): Promise<void>;
  emptyTrash(): Promise<{ removed: number }>;
};

function browserRead(): BrowserDocument {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return { version: 1, tasks: [], series: [] };
  try {
    const value = JSON.parse(raw) as BrowserDocument;
    if (value.version === 1 && Array.isArray(value.tasks)) {
      return { version: 1, tasks: value.tasks, series: Array.isArray(value.series) ? value.series : [] };
    }
  } catch {
    localStorage.setItem(`${STORAGE_KEY}.corrupt.${Date.now()}`, raw);
    localStorage.removeItem(STORAGE_KEY);
  }
  return { version: 1, tasks: [], series: [] };
}

function browserWrite(document: BrowserDocument): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
}

function createBrowserTask(input: TaskCreateInput, id: string = crypto.randomUUID()): Task {
  const now = Date.now();
  const normalized = normalizeTaskCreateInput(input);
  if (normalized.recurrence && !normalized.dueLocalDate) throw new Error('Recurring tasks require a due date');
  const document = browserRead();
  const existing = document.tasks.find((task) => task.id === id);
  if (existing) return withBrowserRecurrence(document, existing);
  const series: TaskSeries | null = normalized.recurrence
    ? {
        id: crypto.randomUUID(),
        rule: normalized.recurrence.rule,
        end: normalized.recurrence.end,
        timezone: normalized.recurrence.timezone,
        startsAt: normalized.dueAt ?? normalized.dueLocalDate!,
        stoppedAt: null,
        createdAt: now,
        updatedAt: now,
      }
    : null;
  const task: Task = {
    id,
    title: normalized.title,
    notes: normalized.notes ?? '',
    priority: normalized.priority ?? 'none',
    dueAt: normalized.dueAt ?? null,
    dueLocalDate: normalized.dueLocalDate ?? null,
    estimatedMinutes: normalized.estimatedMinutes ?? null,
    status: 'open',
    completedAt: null,
    seriesId: series?.id ?? null,
    occurrenceKey: series ? normalized.dueLocalDate! : null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    recurrence: series ? { rule: series.rule, end: series.end, timezone: series.timezone } : null,
  };
  if (series) document.series.push(series);
  document.tasks.push(task);
  browserWrite(document);
  return task;
}

export const browserTaskConversionAdapter = {
  async get(id: string): Promise<Task | null> {
    const document = browserRead();
    const task = document.tasks.find((item) => item.id === id);
    return task ? withBrowserRecurrence(document, task) : null;
  },
  async create(input: TaskCreateInput, id: string): Promise<Task> {
    return createBrowserTask(input, id);
  },
  async remove(id: string): Promise<void> {
    const document = browserRead();
    const target = document.tasks.find((task) => task.id === id);
    if (!target) return;
    document.tasks = target.seriesId
      ? document.tasks.filter((task) => task.seriesId !== target.seriesId)
      : document.tasks.filter((task) => task.id !== id);
    if (target.seriesId) document.series = document.series.filter((series) => series.id !== target.seriesId);
    browserWrite(document);
  },
};

function browserClient(): TaskClient {
  return {
    async list(query) {
      const document = browserRead();
      const tasks = document.tasks.filter((task) =>
        query.view === 'trash' ? task.deletedAt !== null : task.deletedAt === null
      );
      return tasks
        .filter((task) =>
          query.view === 'today'
            ? task.status === 'open' && task.dueLocalDate === query.todayLocalDate
            : query.view === 'completed'
              ? task.status === 'completed'
              : query.view === 'scheduled'
                ? task.status === 'open' && task.dueLocalDate !== null
                : true
        )
        .toSorted((left, right) => compareTasks(left, right, query.todayLocalDate))
        .map((task) => withBrowserRecurrence(document, task));
    },
    async create(input) {
      return createBrowserTask(input);
    },
    async update(input, scope = 'single') {
      const document = browserRead();
      const index = document.tasks.findIndex((task) => task.id === input.id);
      if (index < 0) throw new Error('Task not found');
      const current = document.tasks[index];
      const now = Date.now();
      const normalized = normalizeTaskCreateInput({
        title: input.title ?? current.title,
        notes: input.notes ?? current.notes,
        priority: input.priority ?? current.priority,
        dueAt: input.dueAt === undefined ? current.dueAt : input.dueAt,
        dueLocalDate: input.dueLocalDate === undefined ? current.dueLocalDate : input.dueLocalDate,
        estimatedMinutes: input.estimatedMinutes === undefined ? current.estimatedMinutes : input.estimatedMinutes,
        ...(input.recurrence ? { recurrence: input.recurrence } : {}),
      });
      if (!current.seriesId && input.recurrence) {
        if (!normalized.dueLocalDate) throw new Error('Recurring tasks require a due date');
        const series: TaskSeries = {
          id: crypto.randomUUID(),
          rule: normalized.recurrence!.rule,
          end: normalized.recurrence!.end,
          timezone: normalized.recurrence!.timezone,
          startsAt: normalized.dueAt ?? normalized.dueLocalDate,
          stoppedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        document.series.push(series);
        document.tasks[index] = {
          ...current,
          ...taskFields(normalized),
          seriesId: series.id,
          occurrenceKey: normalized.dueLocalDate,
          updatedAt: now,
        };
        browserWrite(document);
        return withBrowserRecurrence(document, document.tasks[index]);
      }
      if (current.seriesId && input.recurrence === null) {
        const series = document.series.find((item) => item.id === current.seriesId);
        if (scope === 'single') createNextTask(document, current);
        else if (scope === 'this-and-future') {
          if (series) {
            series.stoppedAt = current.dueLocalDate ?? current.occurrenceKey ?? series.startsAt;
            series.updatedAt = now;
          }
          for (const future of document.tasks) {
            if (
              future.id !== current.id &&
              future.seriesId === current.seriesId &&
              future.status === 'open' &&
              future.deletedAt === null &&
              (future.dueLocalDate ?? '') >= (current.dueLocalDate ?? '')
            ) {
              future.deletedAt = now;
              future.updatedAt = now;
            }
          }
        } else throw new Error('Invalid task update scope');
        const updated: Task = {
          ...current,
          ...taskFields(normalized),
          seriesId: null,
          occurrenceKey: null,
          recurrence: null,
          updatedAt: now,
        };
        document.tasks[index] = updated;
        browserWrite(document);
        return updated;
      }
      if (scope === 'this-and-future' && current.seriesId) {
        const oldSeries = document.series.find((series) => series.id === current.seriesId);
        if (oldSeries) {
          oldSeries.stoppedAt = current.dueLocalDate ?? current.occurrenceKey ?? oldSeries.startsAt;
          oldSeries.updatedAt = now;
          const nextSeries: TaskSeries = {
            id: crypto.randomUUID(),
            rule: normalized.recurrence?.rule ?? oldSeries.rule,
            end: normalized.recurrence?.end ?? oldSeries.end,
            timezone: normalized.recurrence?.timezone ?? oldSeries.timezone,
            startsAt: normalized.dueAt ?? normalized.dueLocalDate ?? oldSeries.startsAt,
            stoppedAt: null,
            createdAt: now,
            updatedAt: now,
          };
          document.series.push(nextSeries);
          for (const task of document.tasks) {
            if (
              task.seriesId === current.seriesId &&
              (task.id === current.id ||
                (task.status === 'open' &&
                  task.deletedAt === null &&
                  (task.dueLocalDate ?? '') >= (current.dueLocalDate ?? '')))
            ) {
              task.title = normalized.title;
              task.notes = normalized.notes ?? '';
              task.priority = normalized.priority ?? 'none';
              task.estimatedMinutes = normalized.estimatedMinutes ?? null;
              task.seriesId = nextSeries.id;
              task.updatedAt = now;
              if (task.id === current.id) {
                task.dueAt = normalized.dueAt ?? null;
                task.dueLocalDate = normalized.dueLocalDate ?? null;
                task.occurrenceKey = normalized.dueLocalDate ?? task.occurrenceKey;
              }
            }
          }
          browserWrite(document);
          return withBrowserRecurrence(document, document.tasks.find((task) => task.id === current.id)!);
        }
      }
      const updated: Task = { ...current, ...taskFields(normalized), updatedAt: now };
      document.tasks[index] = updated;
      browserWrite(document);
      return withBrowserRecurrence(document, updated);
    },
    async complete(id) {
      const document = browserRead();
      const task = document.tasks.find((item) => item.id === id);
      if (!task) throw new Error('Task not found');
      if (task.status === 'completed') {
        const nextTask = findNextTask(document, task);
        return {
          task: withBrowserRecurrence(document, task),
          nextTask: nextTask ? withBrowserRecurrence(document, nextTask) : undefined,
        };
      }
      task.status = 'completed';
      task.completedAt = Date.now();
      task.updatedAt = Date.now();
      const nextTask = findNextTask(document, task) ?? createNextTask(document, task);
      browserWrite(document);
      return {
        task: withBrowserRecurrence(document, task),
        nextTask: nextTask ? withBrowserRecurrence(document, nextTask) : undefined,
      };
    },
    async reopen(id) {
      const document = browserRead();
      const task = document.tasks.find((item) => item.id === id);
      if (!task) throw new Error('Task not found');
      task.status = 'open';
      task.completedAt = null;
      task.updatedAt = Date.now();
      browserWrite(document);
      return task;
    },
    async remove(id, scope = 'single') {
      const document = browserRead();
      const task = document.tasks.find((item) => item.id === id);
      if (!task) throw new Error('Task not found');
      const now = Date.now();
      task.deletedAt = now;
      task.updatedAt = now;
      if (scope === 'single') {
        createNextTask(document, task);
      } else if (scope === 'this-and-future' && task.seriesId) {
        const series = document.series.find((item) => item.id === task.seriesId);
        if (series) {
          series.stoppedAt = task.dueLocalDate ?? task.occurrenceKey ?? series.startsAt;
          series.updatedAt = now;
        }
        for (const future of document.tasks) {
          if (
            future.id !== task.id &&
            future.seriesId === task.seriesId &&
            future.status === 'open' &&
            future.deletedAt === null &&
            (future.dueLocalDate ?? '') >= (task.dueLocalDate ?? '')
          ) {
            future.deletedAt = now;
            future.updatedAt = now;
          }
        }
      } else {
        throw new Error('Invalid task removal scope');
      }
      browserWrite(document);
    },
    async restore(id) {
      const document = browserRead();
      const task = document.tasks.find((item) => item.id === id);
      if (!task) throw new Error('Task not found');
      const series = task.seriesId ? document.series.find((item) => item.id === task.seriesId) : null;
      if (task.seriesId && (!series || series.stoppedAt)) {
        task.seriesId = null;
        task.occurrenceKey = null;
        task.recurrence = null;
      }
      task.deletedAt = null;
      task.updatedAt = Date.now();
      browserWrite(document);
      return withBrowserRecurrence(document, task);
    },
    async destroy(id) {
      const document = browserRead();
      document.tasks = document.tasks.filter((task) => task.id !== id);
      browserWrite(document);
    },
    async emptyTrash() {
      const document = browserRead();
      const before = document.tasks.length;
      document.tasks = document.tasks.filter((task) => task.deletedAt === null);
      browserWrite(document);
      return { removed: before - document.tasks.length };
    },
  };
}

function taskFields(input: TaskCreateInput) {
  return {
    title: input.title,
    notes: input.notes ?? '',
    priority: input.priority ?? 'none',
    dueAt: input.dueAt ?? null,
    dueLocalDate: input.dueLocalDate ?? null,
    estimatedMinutes: input.estimatedMinutes ?? null,
  };
}

const priorityRank: Record<Task['priority'], number> = { high: 0, medium: 1, low: 2, none: 3 };

function compareTasks(left: Task, right: Task, todayLocalDate?: string): number {
  const group = (task: Task): number => {
    if (task.status === 'open' && task.dueLocalDate && todayLocalDate && task.dueLocalDate < todayLocalDate) return 0;
    if (task.status === 'open' && task.dueLocalDate === todayLocalDate) return 1;
    if (task.status === 'open' && task.dueLocalDate) return 2;
    if (task.status === 'open') return 3;
    return 4;
  };
  return (
    group(left) - group(right) ||
    priorityRank[left.priority] - priorityRank[right.priority] ||
    (left.dueLocalDate ?? '9999-12-31').localeCompare(right.dueLocalDate ?? '9999-12-31') ||
    right.updatedAt - left.updatedAt
  );
}

function withBrowserRecurrence(document: BrowserDocument, task: Task): Task {
  if (!task.seriesId) return { ...task, recurrence: null };
  const series = document.series.find((item) => item.id === task.seriesId);
  return {
    ...task,
    recurrence: series ? { rule: series.rule, end: series.end, timezone: series.timezone } : null,
  };
}

function findNextTask(document: BrowserDocument, task: Task): Task | null {
  if (!task.seriesId || !task.dueLocalDate) return null;
  const series = document.series.find((item) => item.id === task.seriesId);
  if (!series || series.stoppedAt) return null;
  const nextDate = nextOccurrenceDate(task.dueLocalDate, series.rule);
  return document.tasks.find((item) => item.seriesId === series.id && item.occurrenceKey === nextDate) ?? null;
}

function createNextTask(document: BrowserDocument, task: Task): Task | null {
  if (!task.seriesId || !task.dueLocalDate) return null;
  const series = document.series.find((item) => item.id === task.seriesId);
  if (!series || series.stoppedAt) return null;
  const nextDate = nextOccurrenceDate(task.dueLocalDate, series.rule);
  const occurrenceNumber = document.tasks.filter((item) => item.seriesId === series.id).length + 1;
  if (!recurrenceAllowsOccurrence(nextDate, series.end, occurrenceNumber)) return null;
  const existing = findNextTask(document, task);
  if (existing) return existing;
  const now = Date.now();
  const next: Task = {
    ...task,
    id: crypto.randomUUID(),
    dueAt: task.dueAt && /^\d{4}-\d{2}-\d{2}/.test(task.dueAt) ? `${nextDate}${task.dueAt.slice(10)}` : task.dueAt,
    dueLocalDate: nextDate,
    status: 'open',
    completedAt: null,
    occurrenceKey: nextDate,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  document.tasks.push(next);
  return next;
}

export const taskClient: TaskClient = isElectronDesktop()
  ? {
      list: (query) => ipcBridge.task.list.invoke(query),
      create: (input) => ipcBridge.task.create.invoke(input),
      update: (input, scope) => ipcBridge.task.update.invoke({ ...input, scope }),
      complete: (id) => ipcBridge.task.complete.invoke({ id }),
      reopen: (id) => ipcBridge.task.reopen.invoke({ id }),
      remove: (id, scope) => ipcBridge.task.remove.invoke({ id, scope }),
      restore: (id) => ipcBridge.task.restore.invoke({ id }),
      destroy: (id) => ipcBridge.task.destroy.invoke({ id }),
      emptyTrash: () => ipcBridge.task.emptyTrash.invoke(),
    }
  : browserClient();
