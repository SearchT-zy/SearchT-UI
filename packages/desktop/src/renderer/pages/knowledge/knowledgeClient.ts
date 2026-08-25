import { ipcBridge } from '@/common';
import type { KnowledgeClient } from '@/common/types/searcht/knowledge';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { type NotesDatabase, openNotesDatabase } from '../notes/notesDb';

export function createBrowserKnowledgeClient(database: NotesDatabase): KnowledgeClient {
  return {
    search: (query) => database.searchKnowledge(query),
    getStatus: () => database.getKnowledgeStatus(),
    rebuild: () => database.rebuildKnowledge(),
    removeSource: (id) => database.removeKnowledgeSource(id),
    indexInbox: async () => {
      throw new Error('KNOWLEDGE_INDEX_INBOX_USE_INBOX_CLIENT');
    },
  };
}

function electronKnowledgeClient(): KnowledgeClient {
  return {
    search: (query) => ipcBridge.knowledge.search.invoke(query),
    getStatus: () => ipcBridge.knowledge.getStatus.invoke(),
    rebuild: () => ipcBridge.knowledge.rebuild.invoke(),
    removeSource: (id) => ipcBridge.knowledge.removeSource.invoke({ id }),
    indexInbox: async () => {
      throw new Error('KNOWLEDGE_INDEX_INBOX_USE_INBOX_CLIENT');
    },
  };
}

const browserDatabase = isElectronDesktop() ? null : openNotesDatabase();

export const knowledgeClient: KnowledgeClient = isElectronDesktop()
  ? electronKnowledgeClient()
  : {
      search: async (query) => (await browserDatabase!).searchKnowledge(query),
      getStatus: async () => (await browserDatabase!).getKnowledgeStatus(),
      rebuild: async () => (await browserDatabase!).rebuildKnowledge(),
      removeSource: async (id) => (await browserDatabase!).removeKnowledgeSource(id),
      indexInbox: async () => {
        throw new Error('KNOWLEDGE_INDEX_INBOX_USE_INBOX_CLIENT');
      },
    };
