import { ipcBridge } from '@/common';
import type {
  NoteCreateInput,
  NoteListQuery,
  NoteRevisionListQuery,
  NoteRevisionRestoreInput,
  NoteUpdateInput,
} from '@/common/types/searcht/notes';
import { getPersonalDatabase } from '@process/services/personal-core';
import { KnowledgeService } from '@process/services/personal-core/content/KnowledgeService';
import { NoteService } from '@process/services/personal-core/content/NoteService';

type NotesServiceContract = Pick<
  NoteService,
  | 'list'
  | 'get'
  | 'create'
  | 'update'
  | 'archive'
  | 'unarchive'
  | 'remove'
  | 'restore'
  | 'destroy'
  | 'emptyTrash'
  | 'listRevisions'
  | 'restoreRevision'
>;

export type NotesBridgeDependencies = { service: NotesServiceContract };

export function initNotesBridge(dependencies?: NotesBridgeDependencies) {
  const getService = (): NotesServiceContract => {
    if (dependencies) return dependencies.service;
    const driver = getPersonalDatabase().driver;
    return new NoteService(driver, new KnowledgeService(driver));
  };
  const handlers = {
    list: async (query: NoteListQuery) => getService().list(query),
    get: async (id: string) => getService().get(id),
    create: async (input: NoteCreateInput) => getService().create(input),
    update: async (input: NoteUpdateInput) => getService().update(input),
    archive: async (ids: string[]) => getService().archive(ids),
    unarchive: async (ids: string[]) => getService().unarchive(ids),
    remove: async (ids: string[]) => getService().remove(ids),
    restore: async (ids: string[]) => getService().restore(ids),
    destroy: async (ids: string[]) => getService().destroy(ids),
    emptyTrash: async () => getService().emptyTrash(),
    listRevisions: async (query: NoteRevisionListQuery) => getService().listRevisions(query),
    restoreRevision: async (input: NoteRevisionRestoreInput) => getService().restoreRevision(input),
  };

  ipcBridge.notes.list.provider(handlers.list);
  ipcBridge.notes.get.provider(({ id }) => handlers.get(id));
  ipcBridge.notes.create.provider(handlers.create);
  ipcBridge.notes.update.provider(handlers.update);
  ipcBridge.notes.archive.provider(({ ids }) => handlers.archive(ids));
  ipcBridge.notes.unarchive.provider(({ ids }) => handlers.unarchive(ids));
  ipcBridge.notes.remove.provider(({ ids }) => handlers.remove(ids));
  ipcBridge.notes.restore.provider(({ ids }) => handlers.restore(ids));
  ipcBridge.notes.destroy.provider(({ ids }) => handlers.destroy(ids));
  ipcBridge.notes.emptyTrash.provider(handlers.emptyTrash);
  ipcBridge.notes.listRevisions.provider(handlers.listRevisions);
  ipcBridge.notes.restoreRevision.provider(handlers.restoreRevision);
  return handlers;
}
