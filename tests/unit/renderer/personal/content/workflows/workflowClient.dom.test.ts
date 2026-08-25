// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ipcBridge } from '@/common';
import { createElectronWorkflowClient } from '@renderer/pages/workflows/workflowClient';

describe('workflow client', () => {
  it('maps renderer calls to narrow Electron workflow providers', async () => {
    const list = vi.spyOn(ipcBridge.workflow.list, 'invoke').mockResolvedValue({ workflows: [], total: 0 });
    const listRuns = vi.spyOn(ipcBridge.workflow.listRuns, 'invoke').mockResolvedValue({ runs: [], total: 0 });
    const setState = vi.spyOn(ipcBridge.workflow.setState, 'invoke').mockResolvedValue({ state: 'disabled' } as never);
    const rebindRuntimeJob = vi
      .spyOn(ipcBridge.workflow.rebindRuntimeJob, 'invoke')
      .mockResolvedValue({ state: 'active', runtimeJobId: 'cron-2' } as never);
    const client = createElectronWorkflowClient();

    await client.list();
    await client.listRuns('workflow-1');
    await client.setState('workflow-1', 'disabled');
    await client.rebindRuntimeJob('workflow-1', 'cron-2');

    expect(list).toHaveBeenCalledOnce();
    expect(listRuns).toHaveBeenCalledWith({ workflowId: 'workflow-1' });
    expect(setState).toHaveBeenCalledWith({ id: 'workflow-1', state: 'disabled' });
    expect(rebindRuntimeJob).toHaveBeenCalledWith({ id: 'workflow-1', runtimeJobId: 'cron-2' });
  });
});
