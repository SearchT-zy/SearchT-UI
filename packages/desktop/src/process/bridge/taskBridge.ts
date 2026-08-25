import { ipcBridge } from '@/common';
import type { TaskCreateInput, TaskListQuery, TaskScope, TaskUpdateInput } from '@/common/types/searcht/tasks';
import { getPersonalDatabase } from '@process/services/personal-core';
import { TaskService } from '@process/services/personal-core/TaskService';

type TaskServiceContract = Pick<
  TaskService,
  'list' | 'create' | 'update' | 'complete' | 'reopen' | 'remove' | 'restore' | 'destroy' | 'emptyTrash'
>;

export type TaskBridgeDependencies = { service: TaskServiceContract };

export type TaskBridgeHandlers = {
  list: (query: TaskListQuery) => Promise<ReturnType<TaskServiceContract['list']>>;
  create: (input: TaskCreateInput) => Promise<ReturnType<TaskServiceContract['create']>>;
  update: (input: TaskUpdateInput, scope?: TaskScope) => Promise<ReturnType<TaskServiceContract['update']>>;
  complete: (id: string) => Promise<ReturnType<TaskServiceContract['complete']>>;
  reopen: (id: string) => Promise<ReturnType<TaskServiceContract['reopen']>>;
  remove: (id: string, scope?: TaskScope) => Promise<void>;
  restore: (id: string) => Promise<ReturnType<TaskServiceContract['restore']>>;
  destroy: (id: string) => Promise<void>;
  emptyTrash: () => Promise<{ removed: number }>;
};

export function initTaskBridge(dependencies?: TaskBridgeDependencies): TaskBridgeHandlers {
  const getService = (): TaskServiceContract => dependencies?.service ?? new TaskService(getPersonalDatabase().driver);
  const handlers: TaskBridgeHandlers = {
    list: async (query) => getService().list(query),
    create: async (input) => getService().create(input),
    update: async (input, scope) => getService().update(input, scope),
    complete: async (id) => getService().complete(id),
    reopen: async (id) => getService().reopen(id),
    remove: async (id, scope) => getService().remove(id, scope),
    restore: async (id) => getService().restore(id),
    destroy: async (id) => getService().destroy(id),
    emptyTrash: async () => ({ removed: getService().emptyTrash() }),
  };

  ipcBridge.task.list.provider(handlers.list);
  ipcBridge.task.create.provider(handlers.create);
  ipcBridge.task.update.provider((input: TaskUpdateInput & { scope?: TaskScope }) =>
    handlers.update(input, input.scope)
  );
  ipcBridge.task.complete.provider(({ id }) => handlers.complete(id));
  ipcBridge.task.reopen.provider(({ id }) => handlers.reopen(id));
  ipcBridge.task.remove.provider(({ id, scope }) => handlers.remove(id, scope));
  ipcBridge.task.restore.provider(({ id }) => handlers.restore(id));
  ipcBridge.task.destroy.provider(({ id }) => handlers.destroy(id));
  ipcBridge.task.emptyTrash.provider(handlers.emptyTrash);
  return handlers;
}
