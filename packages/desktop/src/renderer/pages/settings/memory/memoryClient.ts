import { ipcBridge } from '@/common';
import type { MemoryClient } from '@/common/types/searcht/memory';
import { isElectronDesktop } from '@renderer/utils/platform';
import { openMemoryDatabase, type MemoryDatabase } from './memoryDb';

export function createElectronMemoryClient(): MemoryClient {
  return {
    listCandidates: (query = {}) => ipcBridge.memory.listCandidates.invoke(query),
    submitCandidate: (input) => ipcBridge.memory.submitCandidate.invoke(input),
    confirmCandidate: (input) => ipcBridge.memory.confirmCandidate.invoke(input),
    rejectCandidate: (id) => ipcBridge.memory.rejectCandidate.invoke({ id }),
    listMemories: (query) => ipcBridge.memory.listMemories.invoke(query),
    getMemory: (id) => ipcBridge.memory.getMemory.invoke({ id }),
    createMemory: (input) => ipcBridge.memory.createMemory.invoke(input),
    updateMemory: (input) => ipcBridge.memory.updateMemory.invoke(input),
    forgetMemory: (id) => ipcBridge.memory.forgetMemory.invoke({ id }),
    retrieve: (input) => ipcBridge.memory.retrieve.invoke(input),
    getStatus: () => ipcBridge.memory.getStatus.invoke(),
    exportMemories: () => ipcBridge.memory.exportMemories.invoke(),
  };
}

export function createBrowserMemoryClient(database: Promise<MemoryDatabase> = openMemoryDatabase()): MemoryClient {
  return {
    listCandidates: async (query = {}) => (await database).listCandidates(query),
    submitCandidate: async (input) => (await database).submitCandidate(input),
    confirmCandidate: async (input) => (await database).confirmCandidate(input),
    rejectCandidate: async (id) => (await database).rejectCandidate(id),
    listMemories: async (query) => (await database).listMemories(query),
    getMemory: async (id) => (await database).getMemory(id),
    createMemory: async (input) => (await database).createMemory(input),
    updateMemory: async (input) => (await database).updateMemory(input),
    forgetMemory: async (id) => (await database).forgetMemory(id),
    retrieve: async (input) => (await database).retrieve(input),
    getStatus: async () => (await database).getStatus(),
    exportMemories: async () => (await database).exportMemories(),
  };
}

export const memoryClient: MemoryClient = isElectronDesktop()
  ? createElectronMemoryClient()
  : createBrowserMemoryClient();
