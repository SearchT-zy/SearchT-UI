import { ipcBridge } from '@/common';
import type { InboxClient } from '@/common/types/searcht/inbox';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { browserCalendarConversionAdapter } from '../personal/calendarClient';
import { browserTaskConversionAdapter } from '../personal/taskClient';
import { createInboxConversionSaga } from './inboxConversionSaga';
import { type InboxDatabase, openInboxDatabase } from './inboxDb';

export type InboxDataClient = InboxClient;

function electronClient(): InboxDataClient {
  return {
    list: (query) => ipcBridge.inbox.list.invoke(query),
    get: (id) => ipcBridge.inbox.get.invoke({ id }),
    captureText: (input) => ipcBridge.inbox.captureText.invoke(input),
    captureLink: (input) => ipcBridge.inbox.captureLink.invoke(input),
    importFiles: (input) => ipcBridge.inbox.importFiles.invoke(input),
    update: (input) => ipcBridge.inbox.update.invoke(input),
    archive: (ids) => ipcBridge.inbox.archive.invoke({ ids }),
    remove: (ids) => ipcBridge.inbox.remove.invoke({ ids }),
    restore: (ids) => ipcBridge.inbox.restore.invoke({ ids }),
    destroy: (ids) => ipcBridge.inbox.destroy.invoke({ ids }),
    emptyTrash: () => ipcBridge.inbox.emptyTrash.invoke(),
    convertToTask: (input) => ipcBridge.inbox.convertToTask.invoke(input),
    convertToEvent: (input) => ipcBridge.inbox.convertToEvent.invoke(input),
    convertToNote: (input) => ipcBridge.inbox.convertToNote.invoke(input),
    convertToKnowledge: (input) => ipcBridge.inbox.convertToKnowledge.invoke(input),
    getPendingSummary: (limit) => ipcBridge.inbox.getPendingSummary.invoke({ limit }),
    getPreview: (id) => ipcBridge.inbox.getPreview.invoke({ id }),
    revealManagedFile: (id) => ipcBridge.inbox.revealManagedFile.invoke({ id }),
  };
}

function browserClient(): InboxDataClient {
  let database: Promise<InboxDatabase> | undefined;
  const getDatabase = () => (database ??= openInboxDatabase());
  const saga = getDatabase().then((openedDatabase) =>
    createInboxConversionSaga({
      database: openedDatabase,
      taskAdapter: browserTaskConversionAdapter,
      eventAdapter: browserCalendarConversionAdapter,
    })
  );
  const startupReconciliation = saga.then((conversionSaga) => conversionSaga.reconcile());
  void startupReconciliation.catch((): undefined => undefined);
  const getReadyDatabase = async () => {
    await startupReconciliation;
    return getDatabase();
  };
  return {
    list: async (query) => (await getReadyDatabase()).list(query),
    get: async (id) => (await getReadyDatabase()).get(id),
    captureText: async (input) => (await getReadyDatabase()).captureText(input),
    captureLink: async (input) => (await getReadyDatabase()).captureLink(input),
    importFiles: async (input) => (await getReadyDatabase()).importFiles(input),
    update: async (input) => (await getReadyDatabase()).update(input),
    archive: async (ids) => (await getReadyDatabase()).archive(ids),
    remove: async (ids) => (await getReadyDatabase()).remove(ids),
    restore: async (ids) => (await getReadyDatabase()).restore(ids),
    destroy: async (ids) => (await getReadyDatabase()).destroy(ids),
    emptyTrash: async () => (await getReadyDatabase()).emptyTrash(),
    convertToTask: async (input) => {
      await startupReconciliation;
      return (await saga).convertToTask(input);
    },
    convertToEvent: async (input) => {
      await startupReconciliation;
      return (await saga).convertToEvent(input);
    },
    convertToNote: async (input) => (await getReadyDatabase()).convertToNote(input),
    convertToKnowledge: async (input) => (await getReadyDatabase()).convertToKnowledge(input),
    getPendingSummary: async (limit) => (await getReadyDatabase()).getPendingSummary(limit),
    getPreview: async (id) => (await getReadyDatabase()).getPreview(id),
    revealManagedFile: async () => {
      throw new Error('INBOX_REVEAL_UNAVAILABLE');
    },
  };
}

export const inboxClient: InboxDataClient = isElectronDesktop() ? electronClient() : browserClient();
