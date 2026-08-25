import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { TaskRepository } from '@process/services/personal-core/TaskRepository';

let directory: string;
let database: PersonalDatabase;
let repository: TaskRepository;

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-task-repository-'));
  database = PersonalDatabase.open(directory);
  repository = new TaskRepository(database.driver);
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('TaskRepository', () => {
  it('stores and maps a task row', () => {
    const task = repository.insertTask({
      id: 'task-1',
      title: 'Review inbox',
      notes: '',
      priority: 'high',
      dueAt: null,
      dueLocalDate: '2026-08-13',
      estimatedMinutes: 30,
      status: 'open',
      completedAt: null,
      seriesId: null,
      occurrenceKey: null,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    });

    expect(task).toEqual(expect.objectContaining({ id: 'task-1', title: 'Review inbox', priority: 'high' }));
    expect(repository.findById('task-1')).toEqual(task);
  });

  it('lists today and trash views without mixing deleted rows', () => {
    repository.insertTask({
      id: 'today',
      title: 'Today',
      notes: '',
      priority: 'none',
      dueAt: null,
      dueLocalDate: '2026-08-13',
      estimatedMinutes: null,
      status: 'open',
      completedAt: null,
      seriesId: null,
      occurrenceKey: null,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    });
    repository.insertTask({
      id: 'trash',
      title: 'Trash',
      notes: '',
      priority: 'none',
      dueAt: null,
      dueLocalDate: '2026-08-13',
      estimatedMinutes: null,
      status: 'open',
      completedAt: null,
      seriesId: null,
      occurrenceKey: null,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: 2,
    });

    expect(repository.list({ view: 'today', todayLocalDate: '2026-08-13' }).map((task) => task.id)).toEqual(['today']);
    expect(repository.list({ view: 'trash', todayLocalDate: '2026-08-13' }).map((task) => task.id)).toEqual(['trash']);
  });

  it('updates soft-delete state and can purge a task', () => {
    repository.insertTask({
      id: 'task-1',
      title: 'Task',
      notes: '',
      priority: 'none',
      dueAt: null,
      dueLocalDate: null,
      estimatedMinutes: null,
      status: 'open',
      completedAt: null,
      seriesId: null,
      occurrenceKey: null,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    });
    repository.setDeletedAt('task-1', 2);
    expect(repository.findById('task-1')?.deletedAt).toBe(2);
    repository.purgeTask('task-1');
    expect(repository.findById('task-1')).toBeNull();
  });

  it('orders open tasks by urgency before priority', () => {
    const insert = (id: string, dueLocalDate: string | null, priority: 'none' | 'low' | 'medium' | 'high') =>
      repository.insertTask({
        id,
        title: id,
        notes: '',
        priority,
        dueAt: null,
        dueLocalDate,
        estimatedMinutes: null,
        status: 'open',
        completedAt: null,
        seriesId: null,
        occurrenceKey: null,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null,
      });
    insert('no-date', null, 'high');
    insert('future', '2026-08-15', 'medium');
    insert('today', '2026-08-13', 'low');
    insert('overdue-low', '2026-08-12', 'low');
    insert('overdue-high', '2026-08-12', 'high');

    expect(repository.list({ view: 'all', todayLocalDate: '2026-08-13' }).map((task) => task.id)).toEqual([
      'overdue-high',
      'overdue-low',
      'today',
      'future',
      'no-date',
    ]);
  });
});
