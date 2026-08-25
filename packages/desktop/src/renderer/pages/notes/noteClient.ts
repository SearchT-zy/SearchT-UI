import { ipcBridge } from '@/common';
import type { NoteClient } from '@/common/types/searcht/notes';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { openNotesDatabase } from './notesDb';

function electronNoteClient(): NoteClient {
  return {
    list: (query) => ipcBridge.notes.list.invoke(query),
    get: (id) => ipcBridge.notes.get.invoke({ id }),
    create: (input) => ipcBridge.notes.create.invoke(input),
    update: (input) => ipcBridge.notes.update.invoke(input),
    archive: (ids) => ipcBridge.notes.archive.invoke({ ids }),
    unarchive: (ids) => ipcBridge.notes.unarchive.invoke({ ids }),
    remove: (ids) => ipcBridge.notes.remove.invoke({ ids }),
    restore: (ids) => ipcBridge.notes.restore.invoke({ ids }),
    destroy: (ids) => ipcBridge.notes.destroy.invoke({ ids }),
    emptyTrash: () => ipcBridge.notes.emptyTrash.invoke(),
    listRevisions: (query) => ipcBridge.notes.listRevisions.invoke(query),
    restoreRevision: (input) => ipcBridge.notes.restoreRevision.invoke(input),
  };
}

function browserNoteClient(): NoteClient {
  const database = openNotesDatabase();
  return {
    list: async (query) => (await database).list(query),
    get: async (id) => (await database).get(id),
    create: async (input) => (await database).create(input),
    update: async (input) => (await database).update(input),
    archive: async (ids) => (await database).archive(ids),
    unarchive: async (ids) => (await database).unarchive(ids),
    remove: async (ids) => (await database).remove(ids),
    restore: async (ids) => (await database).restore(ids),
    destroy: async (ids) => (await database).destroy(ids),
    emptyTrash: async () => (await database).emptyTrash(),
    listRevisions: async (query) => (await database).listRevisions(query),
    restoreRevision: async (input) => (await database).restoreRevision(input),
  };
}

export const noteClient: NoteClient = isElectronDesktop() ? electronNoteClient() : browserNoteClient();
