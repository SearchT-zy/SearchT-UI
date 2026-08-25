import { ipcBridge } from '@/common';
import type {
  MemoryCandidateConfirmInput,
  MemoryCandidateListQuery,
  MemoryCandidateSubmitInput,
  MemoryCreateInput,
  MemoryListQuery,
  MemoryRetrieveInput,
  MemoryUpdateInput,
} from '@/common/types/searcht/memory';
import { getPersonalDatabase } from '@process/services/personal-core';
import { MemoryService } from '@process/services/personal-core/memory/MemoryService';

type MemoryServiceContract = Pick<
  MemoryService,
  | 'listCandidates'
  | 'submitCandidate'
  | 'confirmCandidate'
  | 'rejectCandidate'
  | 'listMemories'
  | 'getMemory'
  | 'createMemory'
  | 'updateMemory'
  | 'forgetMemory'
  | 'retrieve'
  | 'getStatus'
  | 'exportMemories'
>;

export type MemoryBridgeDependencies = { service: MemoryServiceContract };

export function initMemoryBridge(dependencies?: MemoryBridgeDependencies) {
  const getService = (): MemoryServiceContract =>
    dependencies?.service ?? new MemoryService(getPersonalDatabase().driver);
  const handlers = {
    listCandidates: async (query: MemoryCandidateListQuery) => getService().listCandidates(query),
    submitCandidate: async (input: MemoryCandidateSubmitInput) => getService().submitCandidate(input),
    confirmCandidate: async (input: MemoryCandidateConfirmInput) => getService().confirmCandidate(input),
    rejectCandidate: async (id: string) => getService().rejectCandidate(id),
    listMemories: async (query: MemoryListQuery) => getService().listMemories(query),
    getMemory: async (id: string) => getService().getMemory(id),
    createMemory: async (input: MemoryCreateInput) => getService().createMemory(input),
    updateMemory: async (input: MemoryUpdateInput) => getService().updateMemory(input),
    forgetMemory: async (id: string) => getService().forgetMemory(id),
    retrieve: async (input: MemoryRetrieveInput) => getService().retrieve(input),
    getStatus: async () => getService().getStatus(),
    exportMemories: async () => getService().exportMemories(),
  };

  ipcBridge.memory.listCandidates.provider(handlers.listCandidates);
  ipcBridge.memory.submitCandidate.provider(handlers.submitCandidate);
  ipcBridge.memory.confirmCandidate.provider(handlers.confirmCandidate);
  ipcBridge.memory.rejectCandidate.provider(({ id }) => handlers.rejectCandidate(id));
  ipcBridge.memory.listMemories.provider(handlers.listMemories);
  ipcBridge.memory.getMemory.provider(({ id }) => handlers.getMemory(id));
  ipcBridge.memory.createMemory.provider(handlers.createMemory);
  ipcBridge.memory.updateMemory.provider(handlers.updateMemory);
  ipcBridge.memory.forgetMemory.provider(({ id }) => handlers.forgetMemory(id));
  ipcBridge.memory.retrieve.provider(handlers.retrieve);
  ipcBridge.memory.getStatus.provider(handlers.getStatus);
  ipcBridge.memory.exportMemories.provider(handlers.exportMemories);
  return handlers;
}
