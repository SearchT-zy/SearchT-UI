import { ipcBridge } from '@/common';
import type {
  SkillCandidateListQuery,
  SkillCandidateSubmitInput,
  SkillCandidateUpdateInput,
  SkillPublishInput,
  SkillRollbackInput,
  SkillStateUpdateInput,
} from '@/common/types/searcht/skillConsolidation';
import { getPersonalDatabase } from '@process/services/personal-core';
import { SkillService } from '@process/services/personal-core/content/skills/SkillService';

type SkillServiceContract = Pick<
  SkillService,
  | 'listCandidates'
  | 'getCandidate'
  | 'submitCandidate'
  | 'updateCandidate'
  | 'rejectCandidate'
  | 'listManagedSkills'
  | 'getManagedSkill'
  | 'listVersions'
  | 'getVersion'
  | 'publishCandidate'
  | 'rollback'
  | 'updateState'
  | 'getStatus'
>;

export type SkillLifecycleBridgeDependencies = { service: SkillServiceContract };

export function initSkillLifecycleBridge(dependencies?: SkillLifecycleBridgeDependencies) {
  const getService = (): SkillServiceContract =>
    dependencies?.service ?? new SkillService(getPersonalDatabase().driver);
  const handlers = {
    listCandidates: async (query: SkillCandidateListQuery) => getService().listCandidates(query),
    getCandidate: async (id: string) => getService().getCandidate(id),
    submitCandidate: async (input: SkillCandidateSubmitInput) => getService().submitCandidate(input),
    updateCandidate: async (input: SkillCandidateUpdateInput) => getService().updateCandidate(input),
    rejectCandidate: async (id: string) => getService().rejectCandidate(id),
    listManagedSkills: async () => getService().listManagedSkills(),
    getManagedSkill: async (idOrSlug: string) => getService().getManagedSkill(idOrSlug),
    listVersions: async (skillId: string) => getService().listVersions(skillId),
    getVersion: async (id: string) => getService().getVersion(id),
    publishCandidate: async (input: SkillPublishInput) => getService().publishCandidate(input),
    rollback: async (input: SkillRollbackInput) => getService().rollback(input),
    updateState: async (input: SkillStateUpdateInput) => getService().updateState(input),
    getStatus: async () => getService().getStatus(),
  };

  ipcBridge.skillLifecycle.listCandidates.provider(handlers.listCandidates);
  ipcBridge.skillLifecycle.getCandidate.provider(({ id }) => handlers.getCandidate(id));
  ipcBridge.skillLifecycle.submitCandidate.provider(handlers.submitCandidate);
  ipcBridge.skillLifecycle.updateCandidate.provider(handlers.updateCandidate);
  ipcBridge.skillLifecycle.rejectCandidate.provider(({ id }) => handlers.rejectCandidate(id));
  ipcBridge.skillLifecycle.listManagedSkills.provider(handlers.listManagedSkills);
  ipcBridge.skillLifecycle.getManagedSkill.provider(({ idOrSlug }) => handlers.getManagedSkill(idOrSlug));
  ipcBridge.skillLifecycle.listVersions.provider(({ skillId }) => handlers.listVersions(skillId));
  ipcBridge.skillLifecycle.getVersion.provider(({ id }) => handlers.getVersion(id));
  ipcBridge.skillLifecycle.publishCandidate.provider(handlers.publishCandidate);
  ipcBridge.skillLifecycle.rollback.provider(handlers.rollback);
  ipcBridge.skillLifecycle.updateState.provider(handlers.updateState);
  ipcBridge.skillLifecycle.getStatus.provider(handlers.getStatus);
  return handlers;
}
