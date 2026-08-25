import nodePath from 'node:path';
import { shell } from 'electron';
import { ipcBridge } from '@/common';
import type {
  InboxEventConversionInput,
  InboxFileImportInput,
  InboxKnowledgeConversionInput,
  InboxLinkCaptureInput,
  InboxListQuery,
  InboxNoteConversionInput,
  InboxTaskConversionInput,
  InboxTextCaptureInput,
  InboxUpdateInput,
} from '@/common/types/searcht/inbox';
import { getPersonalDatabase } from '@process/services/personal-core';
import { InboxFileStore } from '@process/services/personal-core/InboxFileStore';
import { InboxService } from '@process/services/personal-core/InboxService';

type InboxServiceContract = Pick<
  InboxService,
  | 'list'
  | 'get'
  | 'captureText'
  | 'captureLink'
  | 'importFiles'
  | 'update'
  | 'archive'
  | 'remove'
  | 'restore'
  | 'destroy'
  | 'emptyTrash'
  | 'convertToTask'
  | 'convertToEvent'
  | 'convertToNote'
  | 'convertToKnowledge'
  | 'getPendingSummary'
  | 'getPreview'
  | 'getManagedFilePath'
>;

export type InboxBridgeDependencies = { service: InboxServiceContract; revealFile?: (path: string) => void };

export function initInboxBridge(dependencies?: InboxBridgeDependencies) {
  const getService = (): InboxServiceContract => {
    if (dependencies) return dependencies.service;
    const database = getPersonalDatabase();
    return new InboxService(
      database.driver,
      new InboxFileStore(nodePath.join(nodePath.dirname(database.path), 'inbox'))
    );
  };
  const handlers = {
    list: async (query: InboxListQuery) => getService().list(query),
    get: async (id: string) => getService().get(id),
    captureText: async (input: InboxTextCaptureInput) => getService().captureText(input),
    captureLink: async (input: InboxLinkCaptureInput) => getService().captureLink(input),
    importFiles: async (input: InboxFileImportInput) => {
      if (input.files.some((source) => source.kind !== 'path')) throw new Error('INBOX_DESKTOP_PATH_REQUIRED');
      return getService().importFiles(input);
    },
    update: async (input: InboxUpdateInput) => getService().update(input),
    archive: async (ids: string[]) => getService().archive(ids),
    remove: async (ids: string[]) => getService().remove(ids),
    restore: async (ids: string[]) => getService().restore(ids),
    destroy: async (ids: string[]) => getService().destroy(ids),
    emptyTrash: async () => getService().emptyTrash(),
    convertToTask: async (input: InboxTaskConversionInput) => getService().convertToTask(input),
    convertToEvent: async (input: InboxEventConversionInput) => getService().convertToEvent(input),
    convertToNote: async (input: InboxNoteConversionInput) => getService().convertToNote(input),
    convertToKnowledge: async (input: InboxKnowledgeConversionInput) => getService().convertToKnowledge(input),
    getPendingSummary: async (limit: number) => getService().getPendingSummary(limit),
    getPreview: async (id: string) => getService().getPreview(id),
    revealManagedFile: async (id: string) => {
      const managedPath = getService().getManagedFilePath(id);
      (dependencies?.revealFile ?? shell.showItemInFolder)(managedPath);
    },
  };

  ipcBridge.inbox.list.provider(handlers.list);
  ipcBridge.inbox.get.provider(({ id }) => handlers.get(id));
  ipcBridge.inbox.captureText.provider(handlers.captureText);
  ipcBridge.inbox.captureLink.provider(handlers.captureLink);
  ipcBridge.inbox.importFiles.provider(handlers.importFiles);
  ipcBridge.inbox.update.provider(handlers.update);
  ipcBridge.inbox.archive.provider(({ ids }) => handlers.archive(ids));
  ipcBridge.inbox.remove.provider(({ ids }) => handlers.remove(ids));
  ipcBridge.inbox.restore.provider(({ ids }) => handlers.restore(ids));
  ipcBridge.inbox.destroy.provider(({ ids }) => handlers.destroy(ids));
  ipcBridge.inbox.emptyTrash.provider(handlers.emptyTrash);
  ipcBridge.inbox.convertToTask.provider(handlers.convertToTask);
  ipcBridge.inbox.convertToEvent.provider(handlers.convertToEvent);
  ipcBridge.inbox.convertToNote.provider(handlers.convertToNote);
  ipcBridge.inbox.convertToKnowledge.provider(handlers.convertToKnowledge);
  ipcBridge.inbox.getPendingSummary.provider(({ limit }) => handlers.getPendingSummary(limit));
  ipcBridge.inbox.getPreview.provider(({ id }) => handlers.getPreview(id));
  ipcBridge.inbox.revealManagedFile.provider(({ id }) => handlers.revealManagedFile(id));
  return handlers;
}
