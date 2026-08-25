// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ipcBridge } from '@/common';
import { createElectronSkillLifecycleClient } from '@renderer/pages/settings/SkillsSettings/consolidation/skillLifecycleClient';

describe('skill lifecycle client', () => {
  it('maps renderer calls to typed Electron providers', async () => {
    const listCandidates = vi
      .spyOn(ipcBridge.skillLifecycle.listCandidates, 'invoke')
      .mockResolvedValue({ candidates: [], total: 0 });
    const getManagedSkill = vi.spyOn(ipcBridge.skillLifecycle.getManagedSkill, 'invoke').mockResolvedValue(null);
    const listVersions = vi
      .spyOn(ipcBridge.skillLifecycle.listVersions, 'invoke')
      .mockResolvedValue({ versions: [], total: 0 });
    const getStatus = vi.spyOn(ipcBridge.skillLifecycle.getStatus, 'invoke').mockResolvedValue({
      pendingCount: 0,
      activeCount: 0,
      disabledCount: 0,
    });
    const client = createElectronSkillLifecycleClient();

    await client.listCandidates({ limit: 20 });
    await client.getManagedSkill('weekly-report');
    await client.listVersions('skill-1');
    await client.getStatus();

    expect(listCandidates).toHaveBeenCalledWith({ limit: 20 });
    expect(getManagedSkill).toHaveBeenCalledWith({ idOrSlug: 'weekly-report' });
    expect(listVersions).toHaveBeenCalledWith({ skillId: 'skill-1' });
    expect(getStatus).toHaveBeenCalledOnce();
  });
});
