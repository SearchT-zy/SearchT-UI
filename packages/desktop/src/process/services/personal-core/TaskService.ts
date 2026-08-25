import { randomUUID } from 'node:crypto';
import type { Task, TaskCreateInput, TaskListQuery, TaskScope, TaskUpdateInput } from '@/common/types/searcht/tasks';
import { nextOccurrenceDate, recurrenceAllowsOccurrence } from '@/common/searcht/taskRecurrence';
import { normalizeTaskCreateInput } from '@/common/searcht/taskValidation';
import { TaskRepository } from './TaskRepository';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';

type CompleteResult = { task: Task; nextTask?: Task };

export class TaskService {
  private readonly repository: TaskRepository;

  constructor(private readonly driver: ISqliteDriver) {
    this.repository = new TaskRepository(driver);
  }

  list(query: TaskListQuery): Task[] {
    return this.repository.list(query).map((task) => this.withRecurrence(task));
  }

  create(input: TaskCreateInput, now = Date.now()): Task {
    const normalized = normalizeTaskCreateInput(input);
    if (normalized.recurrence && !normalized.dueLocalDate) {
      throw new Error('Recurring tasks require a due date');
    }
    return this.withRecurrence(
      this.driver.transaction(() => {
        const series = normalized.recurrence
          ? this.repository.insertSeries({
              id: randomUUID(),
              rule: normalized.recurrence.rule,
              end: normalized.recurrence.end,
              timezone: normalized.recurrence.timezone,
              startsAt: normalized.dueAt ?? normalized.dueLocalDate!,
              stoppedAt: null,
              createdAt: now,
              updatedAt: now,
            })
          : null;
        return this.repository.insertTask({
          id: randomUUID(),
          title: normalized.title,
          notes: normalized.notes ?? '',
          priority: normalized.priority ?? 'none',
          dueAt: normalized.dueAt ?? null,
          dueLocalDate: normalized.dueLocalDate ?? null,
          estimatedMinutes: normalized.estimatedMinutes ?? null,
          status: 'open',
          completedAt: null,
          seriesId: series?.id ?? null,
          occurrenceKey: series ? normalized.dueLocalDate : null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
      })()
    );
  }

  createFromInbox(input: TaskCreateInput, targetId: string, now = Date.now()): Task {
    const normalized = normalizeTaskCreateInput(input);
    if (normalized.recurrence) throw new Error('INBOX_CONVERSION_RECURRENCE_UNSUPPORTED');
    return this.repository.insertTask({
      id: targetId,
      title: normalized.title,
      notes: normalized.notes ?? '',
      priority: normalized.priority ?? 'none',
      dueAt: normalized.dueAt ?? null,
      dueLocalDate: normalized.dueLocalDate ?? null,
      estimatedMinutes: normalized.estimatedMinutes ?? null,
      status: 'open',
      completedAt: null,
      seriesId: null,
      occurrenceKey: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  update(input: TaskUpdateInput, scope: TaskScope = 'single', now = Date.now()): Task {
    const current = this.requireTask(input.id);
    const normalized = normalizeTaskCreateInput({
      title: input.title ?? current.title,
      notes: input.notes ?? current.notes,
      priority: input.priority ?? current.priority,
      dueAt: input.dueAt === undefined ? current.dueAt : input.dueAt,
      dueLocalDate: input.dueLocalDate === undefined ? current.dueLocalDate : input.dueLocalDate,
      estimatedMinutes: input.estimatedMinutes === undefined ? current.estimatedMinutes : input.estimatedMinutes,
      recurrence: input.recurrence === undefined ? undefined : input.recurrence === null ? undefined : input.recurrence,
    });
    if (!current.seriesId && input.recurrence) {
      if (!normalized.dueLocalDate) throw new Error('Recurring tasks require a due date');
      return this.withRecurrence(
        this.driver.transaction(() => {
          const series = this.repository.insertSeries({
            id: randomUUID(),
            rule: input.recurrence!.rule,
            end: input.recurrence!.end ?? { kind: 'never' },
            timezone: input.recurrence!.timezone ?? 'Asia/Shanghai',
            startsAt: normalized.dueAt ?? normalized.dueLocalDate!,
            stoppedAt: null,
            createdAt: now,
            updatedAt: now,
          });
          return this.repository.updateTask({
            ...current,
            ...taskFields(normalized),
            seriesId: series.id,
            occurrenceKey: normalized.dueLocalDate,
            updatedAt: now,
          });
        })()
      );
    }
    if (current.seriesId && input.recurrence === null) {
      return this.withRecurrence(
        this.driver.transaction(() => {
          const series = this.repository.findSeriesById(current.seriesId!);
          if (scope === 'single') this.createNext(current, now);
          else if (scope === 'this-and-future') {
            if (series) {
              series.stoppedAt = current.dueLocalDate ?? current.occurrenceKey ?? series.startsAt;
              series.updatedAt = now;
              this.repository.updateSeries(series);
            }
            for (const future of this.repository.listSeriesTasks(current.seriesId!)) {
              if (
                future.id !== current.id &&
                future.status === 'open' &&
                future.deletedAt === null &&
                (future.dueLocalDate ?? '') >= (current.dueLocalDate ?? '')
              ) {
                this.repository.setDeletedAt(future.id, now);
              }
            }
            this.repository.insertAudit(
              randomUUID(),
              'task_series_stop',
              { taskId: current.id, seriesId: current.seriesId },
              now
            );
          } else throw new Error('Invalid task update scope');
          return this.repository.updateTask({
            ...current,
            ...taskFields(normalized),
            seriesId: null,
            occurrenceKey: null,
            updatedAt: now,
          });
        })()
      );
    }
    if (scope === 'single' || !current.seriesId) {
      return this.withRecurrence(
        this.driver.transaction(() =>
          this.repository.updateTask({ ...current, ...taskFields(normalized), updatedAt: now })
        )()
      );
    }

    if (scope !== 'this-and-future') throw new Error('Invalid task update scope');
    return this.withRecurrence(
      this.driver.transaction(() => {
        const oldSeries = this.repository.findSeriesById(current.seriesId!);
        if (!oldSeries) return this.repository.updateTask({ ...current, ...taskFields(normalized), updatedAt: now });
        const newSeries = this.repository.insertSeries({
          id: randomUUID(),
          rule: normalized.recurrence?.rule ?? oldSeries.rule,
          end: normalized.recurrence?.end ?? oldSeries.end,
          timezone: normalized.recurrence?.timezone ?? oldSeries.timezone,
          startsAt: normalized.dueAt ?? normalized.dueLocalDate ?? oldSeries.startsAt,
          stoppedAt: null,
          createdAt: now,
          updatedAt: now,
        });
        oldSeries.stoppedAt = current.dueLocalDate ?? current.occurrenceKey ?? oldSeries.startsAt;
        oldSeries.updatedAt = now;
        this.repository.updateSeries(oldSeries);
        const future = this.repository
          .listSeriesTasks(current.seriesId!)
          .filter(
            (task) =>
              task.id === current.id ||
              (task.status === 'open' &&
                task.deletedAt === null &&
                (task.dueLocalDate ?? '') >= (current.dueLocalDate ?? ''))
          );
        for (const task of future) {
          const fields =
            task.id === current.id
              ? taskFields(normalized)
              : {
                  title: normalized.title,
                  notes: normalized.notes ?? '',
                  priority: normalized.priority ?? 'none',
                  dueAt: task.dueAt,
                  dueLocalDate: task.dueLocalDate,
                  estimatedMinutes: normalized.estimatedMinutes ?? null,
                };
          this.repository.updateTask({
            ...task,
            ...fields,
            seriesId: newSeries.id,
            occurrenceKey:
              task.id === current.id ? (normalized.dueLocalDate ?? task.occurrenceKey) : task.occurrenceKey,
            updatedAt: now,
          });
        }
        this.repository.insertAudit(
          randomUUID(),
          'task_series_split',
          { taskId: current.id, previousSeriesId: oldSeries.id, nextSeriesId: newSeries.id },
          now
        );
        return this.repository.findById(current.id)!;
      })()
    );
  }

  complete(id: string, now = Date.now()): CompleteResult {
    const result = this.driver.transaction(() => {
      const task = this.requireTask(id);
      if (task.status === 'completed') return { task, nextTask: this.findNext(task) ?? undefined };
      const completed = this.repository.updateTask({ ...task, status: 'completed', completedAt: now, updatedAt: now });
      const nextTask = this.findNext(completed) ?? this.createNext(completed, now);
      return { task: completed, nextTask: nextTask ?? undefined };
    })();
    return {
      task: this.withRecurrence(result.task),
      nextTask: result.nextTask ? this.withRecurrence(result.nextTask) : undefined,
    };
  }

  reopen(id: string, now = Date.now()): Task {
    const task = this.requireTask(id);
    return this.withRecurrence(
      this.repository.updateTask({ ...task, status: 'open', completedAt: null, updatedAt: now })
    );
  }

  remove(id: string, scope: TaskScope = 'single', now = Date.now()): void {
    this.driver.transaction(() => {
      const task = this.requireTask(id);
      this.repository.setDeletedAt(id, now);
      if (scope === 'single') {
        this.createNext(task, now);
      } else if (scope === 'this-and-future' && task.seriesId) {
        const series = this.repository.findSeriesById(task.seriesId);
        if (series) {
          series.stoppedAt = task.dueLocalDate ?? task.occurrenceKey ?? series.startsAt;
          series.updatedAt = now;
          this.repository.updateSeries(series);
        }
        for (const future of this.repository.listSeriesTasks(task.seriesId)) {
          if (
            future.id !== task.id &&
            future.status === 'open' &&
            future.deletedAt === null &&
            (future.dueLocalDate ?? '') >= (task.dueLocalDate ?? '')
          ) {
            this.repository.setDeletedAt(future.id, now);
          }
        }
        this.repository.insertAudit(
          randomUUID(),
          'task_series_stop',
          { taskId: task.id, seriesId: task.seriesId },
          now
        );
      } else {
        throw new Error('Invalid task removal scope');
      }
    })();
  }

  restore(id: string, now = Date.now()): Task {
    return this.withRecurrence(
      this.driver.transaction(() => {
        const task = this.requireTask(id);
        const series = task.seriesId ? this.repository.findSeriesById(task.seriesId) : null;
        const detachFromSeries = task.seriesId !== null && (!series || series.stoppedAt !== null);
        return this.repository.updateTask({
          ...task,
          seriesId: detachFromSeries ? null : task.seriesId,
          occurrenceKey: detachFromSeries ? null : task.occurrenceKey,
          deletedAt: null,
          updatedAt: now,
        });
      })()
    );
  }

  destroy(id: string, now = Date.now()): void {
    this.driver.transaction(() => {
      const task = this.requireTask(id);
      this.repository.purgeTask(id);
      if (task.seriesId && this.repository.listSeriesTasks(task.seriesId).length === 0)
        this.repository.deleteSeries(task.seriesId);
      this.repository.insertAudit(randomUUID(), 'task_destroy', { taskId: id, seriesId: task.seriesId }, now);
    })();
  }

  emptyTrash(now = Date.now()): number {
    return this.driver.transaction(() => {
      const trash = this.repository.list({ view: 'trash' });
      for (const task of trash) this.repository.purgeTask(task.id);
      const seriesIds = new Set(trash.map((task) => task.seriesId).filter((id): id is string => Boolean(id)));
      for (const seriesId of seriesIds)
        if (this.repository.listSeriesTasks(seriesId).length === 0) this.repository.deleteSeries(seriesId);
      this.repository.insertAudit(randomUUID(), 'task_trash_empty', { removed: trash.length }, now);
      return trash.length;
    })();
  }

  private requireTask(id: string): Task {
    const task = this.repository.findById(id);
    if (!task) throw new Error('Task not found');
    return task;
  }

  private withRecurrence(task: Task): Task {
    if (!task.seriesId) return { ...task, recurrence: null };
    const series = this.repository.findSeriesById(task.seriesId);
    return {
      ...task,
      recurrence: series ? { rule: series.rule, end: series.end, timezone: series.timezone } : null,
    };
  }

  private findNext(task: Task): Task | null {
    if (!task.seriesId || !task.dueLocalDate) return null;
    const series = this.repository.findSeriesById(task.seriesId);
    if (!series || series.stoppedAt) return null;
    const nextDate = nextOccurrenceDate(task.dueLocalDate, series.rule);
    const occurrenceNumber = this.repository.countSeriesOccurrences(series.id) + 1;
    if (!recurrenceAllowsOccurrence(nextDate, series.end, occurrenceNumber)) return null;
    return this.repository.findByOccurrence(series.id, nextDate);
  }

  private createNext(task: Task, now: number): Task | null {
    if (!task.seriesId || !task.dueLocalDate) return null;
    const series = this.repository.findSeriesById(task.seriesId);
    if (!series || series.stoppedAt) return null;
    const nextDate = nextOccurrenceDate(task.dueLocalDate, series.rule);
    const occurrenceNumber = this.repository.countSeriesOccurrences(series.id) + 1;
    if (!recurrenceAllowsOccurrence(nextDate, series.end, occurrenceNumber)) return null;
    const existing = this.repository.findByOccurrence(series.id, nextDate);
    if (existing) return existing;
    return this.repository.insertTask({
      ...task,
      id: randomUUID(),
      dueAt: task.dueAt ? replaceDate(task.dueAt, nextDate) : null,
      dueLocalDate: nextDate,
      status: 'open',
      completedAt: null,
      occurrenceKey: nextDate,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }
}

function taskFields(
  input: TaskCreateInput
): Pick<Task, 'title' | 'notes' | 'priority' | 'dueAt' | 'dueLocalDate' | 'estimatedMinutes'> {
  return {
    title: input.title,
    notes: input.notes ?? '',
    priority: input.priority ?? 'none',
    dueAt: input.dueAt ?? null,
    dueLocalDate: input.dueLocalDate ?? null,
    estimatedMinutes: input.estimatedMinutes ?? null,
  };
}

function replaceDate(value: string, date: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? `${date}${value.slice(10)}` : value;
}
