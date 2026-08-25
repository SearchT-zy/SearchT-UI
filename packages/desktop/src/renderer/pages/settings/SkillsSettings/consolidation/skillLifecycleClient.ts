import { ipcBridge } from '@/common';
import type { SkillLifecycleClient } from '@/common/types/searcht/skillConsolidation';
import { isElectronDesktop } from '@renderer/utils/platform';
import { openSkillLifecycleDatabase, type SkillLifecycleDatabase } from './skillLifecycleDb';

export function createElectronSkillLifecycleClient(): SkillLifecycleClient {
  return {
    listCandidates: (query = {}) => ipcBridge.skillLifecycle.listCandidates.invoke(query),
    getCandidate: (id) => ipcBridge.skillLifecycle.getCandidate.invoke({ id }),
    submitCandidate: (input) => ipcBridge.skillLifecycle.submitCandidate.invoke(input),
    updateCandidate: (input) => ipcBridge.skillLifecycle.updateCandidate.invoke(input),
    rejectCandidate: (id) => ipcBridge.skillLifecycle.rejectCandidate.invoke({ id }),
    listManagedSkills: () => ipcBridge.skillLifecycle.listManagedSkills.invoke(),
    getManagedSkill: (idOrSlug) => ipcBridge.skillLifecycle.getManagedSkill.invoke({ idOrSlug }),
    listVersions: (skillId) => ipcBridge.skillLifecycle.listVersions.invoke({ skillId }),
    getVersion: (id) => ipcBridge.skillLifecycle.getVersion.invoke({ id }),
    publishCandidate: (input) => ipcBridge.skillLifecycle.publishCandidate.invoke(input),
    rollback: (input) => ipcBridge.skillLifecycle.rollback.invoke(input),
    updateState: (input) => ipcBridge.skillLifecycle.updateState.invoke(input),
    getStatus: () => ipcBridge.skillLifecycle.getStatus.invoke(),
  };
}

export function createBrowserSkillLifecycleClient(
  database: Promise<SkillLifecycleDatabase> = openSkillLifecycleDatabase()
): SkillLifecycleClient {
  return {
    listCandidates: async (query = {}) => (await database).listCandidates(query),
    getCandidate: async (id) => (await database).getCandidate(id),
    submitCandidate: async (input) => (await database).submitCandidate(input),
    updateCandidate: async (input) => (await database).updateCandidate(input),
    rejectCandidate: async (id) => (await database).rejectCandidate(id),
    listManagedSkills: async () => (await database).listManagedSkills(),
    getManagedSkill: async (idOrSlug) => (await database).getManagedSkill(idOrSlug),
    listVersions: async (skillId) => (await database).listVersions(skillId),
    getVersion: async (id) => (await database).getVersion(id),
    publishCandidate: async (input) => (await database).publishCandidate(input),
    rollback: async (input) => (await database).rollback(input),
    updateState: async (input) => (await database).updateState(input),
    getStatus: async () => (await database).getStatus(),
  };
}

export const skillLifecycleClient: SkillLifecycleClient = isElectronDesktop()
  ? createElectronSkillLifecycleClient()
  : createBrowserSkillLifecycleClient();
