import { describe, expect, it, vi } from 'vitest';
import { initSkillLifecycleBridge } from '@process/bridge/skillLifecycleBridge';

function makeService() {
  return {
    listCandidates: vi.fn(() => ({ candidates: [], total: 0 })),
    getCandidate: vi.fn(() => null),
    submitCandidate: vi.fn(() => ({ id: 'candidate-1' })),
    updateCandidate: vi.fn(() => ({ id: 'candidate-1' })),
    rejectCandidate: vi.fn(),
    listManagedSkills: vi.fn(() => ({ skills: [], total: 0 })),
    getManagedSkill: vi.fn(() => null),
    listVersions: vi.fn(() => ({ versions: [], total: 0 })),
    getVersion: vi.fn(() => null),
    publishCandidate: vi.fn(() => ({ skill: { id: 'skill-1' }, version: { id: 'version-1' } })),
    rollback: vi.fn(() => ({ skill: { id: 'skill-1' }, version: { id: 'version-2' } })),
    updateState: vi.fn(() => ({ id: 'skill-1', state: 'disabled' })),
    getStatus: vi.fn(() => ({ pendingCount: 0, activeCount: 0, disabledCount: 0 })),
  };
}

describe('skill lifecycle bridge', () => {
  it('forwards only candidate review and managed lifecycle commands', async () => {
    const service = makeService();
    const handlers = initSkillLifecycleBridge({ service: service as never });

    await handlers.listCandidates({ limit: 20 });
    await handlers.getCandidate('candidate-1');
    await handlers.rejectCandidate('candidate-1');
    await handlers.listManagedSkills();
    await handlers.getManagedSkill('weekly-report');
    await handlers.listVersions('skill-1');
    await handlers.getVersion('version-1');
    await handlers.updateState({ skillId: 'skill-1', state: 'disabled' });
    await handlers.getStatus();

    expect(service.listCandidates).toHaveBeenCalledWith({ limit: 20 });
    expect(service.getCandidate).toHaveBeenCalledWith('candidate-1');
    expect(service.rejectCandidate).toHaveBeenCalledWith('candidate-1');
    expect(service.listManagedSkills).toHaveBeenCalledOnce();
    expect(service.getManagedSkill).toHaveBeenCalledWith('weekly-report');
    expect(service.listVersions).toHaveBeenCalledWith('skill-1');
    expect(service.getVersion).toHaveBeenCalledWith('version-1');
    expect(service.updateState).toHaveBeenCalledWith({ skillId: 'skill-1', state: 'disabled' });
    expect(service.getStatus).toHaveBeenCalledOnce();
    expect(handlers).not.toHaveProperty('driver');
    expect(handlers).not.toHaveProperty('executeSql');
  });
});
