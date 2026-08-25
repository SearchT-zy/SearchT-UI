import { describe, expect, it, vi } from 'vitest';
import type { Task, TaskCreateInput, TaskListQuery, TaskScope, TaskUpdateInput } from '@/common/types/searcht/tasks';
import { initTaskBridge } from '@process/bridge/taskBridge';

const sampleTask: Task = {
  id: 'task-1',
  title: 'Review inbox',
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
};

function makeService() {
  return {
    list: vi.fn((_query: TaskListQuery) => [sampleTask]),
    create: vi.fn((_input: TaskCreateInput) => sampleTask),
    update: vi.fn((_input: TaskUpdateInput, _scope?: TaskScope) => sampleTask),
    complete: vi.fn((_id: string) => ({ task: sampleTask })),
    reopen: vi.fn((_id: string) => sampleTask),
    remove: vi.fn((_id: string, _scope?: TaskScope) => undefined),
    restore: vi.fn((_id: string) => sampleTask),
    destroy: vi.fn((_id: string) => undefined),
    emptyTrash: vi.fn(() => 2),
  };
}

describe('taskBridge', () => {
  it('forwards task queries and commands through narrow handlers', async () => {
    const service = makeService();
    const handlers = initTaskBridge({ service });
    const query = { view: 'today', todayLocalDate: '2026-08-13' } as const;

    await expect(handlers.list(query)).resolves.toEqual([sampleTask]);
    await expect(handlers.create({ title: 'Review inbox' })).resolves.toEqual(sampleTask);
    await expect(handlers.update({ id: sampleTask.id, title: 'Review all' }, 'this-and-future')).resolves.toEqual(
      sampleTask
    );
    await handlers.remove(sampleTask.id, 'single');
    await expect(handlers.emptyTrash()).resolves.toEqual({ removed: 2 });

    expect(service.list).toHaveBeenCalledWith(query);
    expect(service.update).toHaveBeenCalledWith({ id: sampleTask.id, title: 'Review all' }, 'this-and-future');
    expect(service.remove).toHaveBeenCalledWith(sampleTask.id, 'single');
  });

  it('rejects callers when the task service fails', async () => {
    const service = makeService();
    service.create.mockImplementation(() => {
      throw new Error('Task title must not be empty');
    });
    const handlers = initTaskBridge({ service });

    await expect(handlers.create({ title: ' ' })).rejects.toThrow('Task title must not be empty');
  });
});
