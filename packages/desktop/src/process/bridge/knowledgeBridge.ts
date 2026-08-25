import nodePath from 'node:path';
import { ipcBridge } from '@/common';
import type { KnowledgeSearchQuery } from '@/common/types/searcht/knowledge';
import { getPersonalDatabase } from '@process/services/personal-core';
import { InboxFileStore } from '@process/services/personal-core/InboxFileStore';
import { InboxService } from '@process/services/personal-core/InboxService';
import { KnowledgeService } from '@process/services/personal-core/content/KnowledgeService';

type KnowledgeServiceContract = Pick<KnowledgeService, 'search' | 'getStatus' | 'rebuild' | 'removeSource'>;

export type KnowledgeBridgeDependencies = { service: KnowledgeServiceContract };

export function initKnowledgeBridge(dependencies?: KnowledgeBridgeDependencies) {
  const getService = (): KnowledgeServiceContract => {
    if (dependencies) return dependencies.service;
    const database = getPersonalDatabase();
    const inbox = new InboxService(
      database.driver,
      new InboxFileStore(nodePath.join(nodePath.dirname(database.path), 'inbox'))
    );
    return new KnowledgeService(database.driver, { read: (sourceId) => inbox.getKnowledgeDocument(sourceId) });
  };
  const handlers = {
    search: async (query: KnowledgeSearchQuery) => getService().search(query),
    getStatus: async () => getService().getStatus(),
    rebuild: async () => getService().rebuild(),
    removeSource: async (id: string) => getService().removeSource(id),
  };

  ipcBridge.knowledge.search.provider(handlers.search);
  ipcBridge.knowledge.getStatus.provider(handlers.getStatus);
  ipcBridge.knowledge.rebuild.provider(handlers.rebuild);
  ipcBridge.knowledge.removeSource.provider(({ id }) => handlers.removeSource(id));
  return handlers;
}
