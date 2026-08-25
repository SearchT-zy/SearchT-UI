import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { TaskRepository } from '@process/services/personal-core/TaskRepository';
import { TaskService } from '@process/services/personal-core/TaskService';

let directory: string;
let database: PersonalDatabase;
let service: TaskService;

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-task-service-'));
  database = PersonalDatabase.open(directory);
  service = new TaskService(database.driver);
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('TaskService', () => {
  it('creates and completes a normal task', () => {
    const task = service.create({ title: '  Ship release  ', dueLocalDate: '2026-08-13' }, 100);
    expect(task.title).toBe('Ship release');
    const result = service.complete(task.id, 200);
    expect(result.task.status).toBe('completed');
    expect(result.nextTask).toBeUndefined();
  });

  it('completing a recurring task creates the next instance and is idempotent', () => {
    const task = service.create(
      {
        title: 'Standup',
        dueLocalDate: '2026-08-13',
        recurrence: { rule: { frequency: 'weekly', interval: 1, weekdays: [4] }, end: { kind: 'never' } },
      },
      100
    );
    const first = service.complete(task.id, 200);
    expect(first.nextTask?.dueLocalDate).toBe('2026-08-20');
    const second = service.complete(task.id, 300);
    expect(second.nextTask?.id).toBe(first.nextTask?.id);
    expect(new TaskRepository(database.driver).listSeriesTasks(task.seriesId!)).toHaveLength(2);
  });

  it('returns recurrence metadata after completing and reopening a recurring task', () => {
    const task = service.create(
      {
        title: 'Plan day',
        dueLocalDate: '2026-08-13',
        recurrence: { rule: { frequency: 'daily', interval: 1 }, end: { kind: 'never' } },
      },
      100
    );

    const completed = service.complete(task.id, 200).task;
    const reopened = service.reopen(task.id, 300);

    expect(completed.recurrence).toEqual(task.recurrence);
    expect(reopened.recurrence).toEqual(task.recurrence);
  });

  it('supports reopen and soft-delete recovery', () => {
    const task = service.create({ title: 'Inbox' }, 100);
    service.complete(task.id, 200);
    expect(service.reopen(task.id, 300).status).toBe('open');
    service.remove(task.id, 'single', 400);
    expect(service.list({ view: 'trash' }).map((item) => item.id)).toEqual([task.id]);
    expect(service.restore(task.id, 500).deletedAt).toBeNull();
  });

  it('splits a recurring series for this-and-future updates', () => {
    const first = service.create(
      {
        title: 'Review',
        dueLocalDate: '2026-08-13',
        recurrence: { rule: { frequency: 'daily', interval: 1 }, end: { kind: 'never' } },
      },
      100
    );
    const next = service.complete(first.id, 200).nextTask!;
    const updated = service.update({ id: next.id, title: 'Deep review', priority: 'high' }, 'this-and-future', 300);
    expect(updated.title).toBe('Deep review');
    expect(updated.seriesId).not.toBe(first.seriesId);
    expect(new TaskRepository(database.driver).findById(first.id)?.title).toBe('Review');
  });

  it('turns a normal task into a recurring series when recurrence is added', () => {
    const task = service.create({ title: 'Plan day', dueLocalDate: '2026-08-13' }, 100);

    const recurring = service.update(
      {
        id: task.id,
        recurrence: { rule: { frequency: 'daily', interval: 1 }, end: { kind: 'never' } },
      },
      'single',
      200
    );

    expect(recurring.seriesId).not.toBeNull();
    expect(recurring.recurrence?.rule).toEqual({ frequency: 'daily', interval: 1 });
    expect(service.complete(recurring.id, 300).nextTask?.dueLocalDate).toBe('2026-08-14');
  });

  it('stops recurrence from this instance forward when recurrence is removed', () => {
    const first = service.create(
      {
        title: 'Plan day',
        dueLocalDate: '2026-08-13',
        recurrence: { rule: { frequency: 'daily', interval: 1 }, end: { kind: 'never' } },
      },
      100
    );
    const current = service.complete(first.id, 200).nextTask!;

    const normal = service.update({ id: current.id, recurrence: null }, 'this-and-future', 300);

    expect(normal).toEqual(expect.objectContaining({ seriesId: null, occurrenceKey: null, recurrence: null }));
    expect(service.complete(normal.id, 400).nextTask).toBeUndefined();
    expect(service.list({ view: 'completed' }).map((task) => task.id)).toContain(first.id);
  });

  it('stops and removes this and future instances while keeping history', () => {
    const first = service.create(
      {
        title: 'Journal',
        dueLocalDate: '2026-08-13',
        recurrence: { rule: { frequency: 'daily', interval: 1 }, end: { kind: 'never' } },
      },
      100
    );
    const next = service.complete(first.id, 200).nextTask!;
    service.remove(next.id, 'this-and-future', 300);
    expect(service.list({ view: 'trash' }).map((item) => item.id)).toContain(next.id);
    expect(service.list({ view: 'completed' }).map((item) => item.id)).toContain(first.id);
  });

  it('keeps a recurring series moving after deleting only one instance', () => {
    const current = service.create(
      {
        title: 'Stretch',
        dueLocalDate: '2026-08-13',
        recurrence: { rule: { frequency: 'daily', interval: 1 }, end: { kind: 'never' } },
      },
      100
    );

    service.remove(current.id, 'single', 200);

    expect(service.list({ view: 'trash' }).map((item) => item.id)).toContain(current.id);
    expect(service.list({ view: 'all' })).toEqual([
      expect.objectContaining({ dueLocalDate: '2026-08-14', status: 'open', seriesId: current.seriesId }),
    ]);
  });

  it('rolls back a single recurring deletion when generating the next instance fails', () => {
    const current = service.create(
      {
        title: 'Stretch',
        dueLocalDate: '2026-08-13',
        recurrence: { rule: { frequency: 'daily', interval: 1 }, end: { kind: 'never' } },
      },
      100
    );
    database.driver.exec(`CREATE TRIGGER fail_next_task BEFORE INSERT ON tasks
      WHEN NEW.id != '${current.id}' BEGIN SELECT RAISE(ABORT, 'next task failed'); END`);

    expect(() => service.remove(current.id, 'single', 200)).toThrow('next task failed');
    expect(new TaskRepository(database.driver).findById(current.id)?.deletedAt).toBeNull();
  });

  it('restores an instance from a stopped series as a normal task', () => {
    const first = service.create(
      {
        title: 'Journal',
        dueLocalDate: '2026-08-13',
        recurrence: { rule: { frequency: 'daily', interval: 1 }, end: { kind: 'never' } },
      },
      100
    );
    const next = service.complete(first.id, 200).nextTask!;

    service.remove(next.id, 'this-and-future', 300);
    const restored = service.restore(next.id, 400);

    expect(restored).toEqual(expect.objectContaining({ deletedAt: null, seriesId: null, occurrenceKey: null }));
    expect(restored.recurrence).toBeNull();
  });

  it('permanently deletes one task and empties trash', () => {
    const first = service.create({ title: 'A' }, 100);
    const second = service.create({ title: 'B' }, 100);
    service.remove(first.id, 'single', 200);
    service.remove(second.id, 'single', 200);
    service.destroy(first.id);
    expect(service.list({ view: 'trash' }).map((item) => item.id)).toEqual([second.id]);
    expect(service.emptyTrash()).toBe(1);
    expect(service.list({ view: 'trash' })).toEqual([]);
  });

  it('audits destructive and recurring-series lifecycle actions', () => {
    const first = service.create(
      {
        title: 'Review',
        dueLocalDate: '2026-08-13',
        recurrence: { rule: { frequency: 'daily', interval: 1 }, end: { kind: 'never' } },
      },
      100
    );
    const next = service.complete(first.id, 200).nextTask!;
    service.update({ id: next.id, title: 'Deep review' }, 'this-and-future', 300);
    service.remove(next.id, 'this-and-future', 400);
    service.destroy(next.id);
    const trash = service.create({ title: 'Discard' }, 500);
    service.remove(trash.id, 'single', 600);
    service.emptyTrash();

    const actions = (
      database.driver.prepare('SELECT action FROM personal_audit_log ORDER BY created_at, rowid').all() as {
        action: string;
      }[]
    ).map((row) => row.action);
    expect(actions).toEqual(['task_series_split', 'task_series_stop', 'task_destroy', 'task_trash_empty']);
  });
});
