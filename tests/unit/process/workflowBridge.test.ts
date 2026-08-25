import { describe, expect, it, vi } from 'vitest';
import { initWorkflowBridge } from '@process/bridge/workflowBridge';

function makeService() {
  return {
    list: vi.fn(() => ({ workflows: [], total: 0 })),
    get: vi.fn(() => null),
    install: vi.fn(() => ({ workflow: { id: 'workflow-1' }, version: { id: 'version-1' } })),
    listVersions: vi.fn(() => []),
    setState: vi.fn(() => ({ id: 'workflow-1', state: 'disabled' })),
    rebindRuntimeJob: vi.fn(() => ({ id: 'workflow-1', state: 'active', runtimeJobId: 'cron-2' })),
    startRun: vi.fn(() => ({ id: 'run-1', state: 'pending' })),
    markRunDispatched: vi.fn(() => ({ id: 'run-1', state: 'running' })),
    completeRun: vi.fn(() => ({ id: 'run-1', state: 'succeeded' })),
    listRuns: vi.fn(() => ({ runs: [], total: 0 })),
    listApprovals: vi.fn(() => []),
    listGrants: vi.fn(() => []),
    saveGrant: vi.fn((grant) => grant),
    revokeGrant: vi.fn(),
  };
}

describe('workflow bridge', () => {
  it('forwards only workflow lifecycle, run, approval, and grant commands', async () => {
    const service = makeService();
    const handlers = initWorkflowBridge({ service: service as never });

    await handlers.list();
    await handlers.get('workflow-1');
    await handlers.listVersions('workflow-1');
    await handlers.setState('workflow-1', 'disabled');
    await handlers.rebindRuntimeJob('workflow-1', 'cron-2');
    await handlers.startRun('workflow-1', 'runtime-run-1', { source: 'manual' });
    await handlers.markRunDispatched('run-1', 'conversation-1');
    await handlers.completeRun('run-1', 'succeeded');
    await handlers.listRuns('workflow-1');
    await handlers.listApprovals('run-1');
    await handlers.listGrants('workflow-1');
    await handlers.revokeGrant('grant-1');

    expect(service.get).toHaveBeenCalledWith('workflow-1');
    expect(service.listVersions).toHaveBeenCalledWith('workflow-1');
    expect(service.setState).toHaveBeenCalledWith('workflow-1', 'disabled');
    expect(service.rebindRuntimeJob).toHaveBeenCalledWith('workflow-1', 'cron-2');
    expect(service.startRun).toHaveBeenCalledWith('workflow-1', 'runtime-run-1', { source: 'manual' });
    expect(service.markRunDispatched).toHaveBeenCalledWith('run-1', 'conversation-1');
    expect(service.completeRun).toHaveBeenCalledWith('run-1', 'succeeded', undefined);
    expect(service.listRuns).toHaveBeenCalledWith('workflow-1');
    expect(service.listApprovals).toHaveBeenCalledWith('run-1');
    expect(service.listGrants).toHaveBeenCalledWith('workflow-1');
    expect(service.revokeGrant).toHaveBeenCalledWith('grant-1');
    expect(handlers).not.toHaveProperty('driver');
    expect(handlers).not.toHaveProperty('executeSql');
    expect(handlers).not.toHaveProperty('cron');
  });
});
