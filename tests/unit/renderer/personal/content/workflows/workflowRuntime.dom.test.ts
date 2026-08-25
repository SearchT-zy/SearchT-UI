import { describe, expect, it, vi } from 'vitest';
import type { ICronJob, ICreateCronJobParams } from '@/common/adapter/ipcBridge';
import type { WorkflowDefinition, WorkflowInstance, WorkflowRun } from '@/common/types/searcht/workflow';
import { createWorkflowRuntime, type WorkflowRuntimeClient } from '@renderer/pages/workflows/workflowRuntime';

const definition: WorkflowDefinition = {
  id: 'daily-planning',
  name: 'Daily planning',
  description: 'Build a daily plan',
  version: 1,
  risk: 'read',
  approvalPolicy: 'none',
  suggestedSchedule: { kind: 'manual' },
  steps: [
    {
      id: 'plan',
      title: 'Plan',
      instruction: 'Review today and produce a plan.',
      capabilities: ['tasks:read'],
      risk: 'read',
    },
  ],
};

const workflow: WorkflowInstance = {
  id: 'workflow-1',
  templateId: definition.id,
  name: definition.name,
  description: definition.description,
  state: 'active',
  runtimeJobId: 'cron-1',
  activeVersionId: 'version-1',
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};

const cronJob = {
  id: 'cron-1',
  name: definition.name,
  enabled: true,
  schedule: { kind: 'cron', expr: '', description: 'Manual' },
  target: { payload: { kind: 'message', text: 'prompt' }, execution_mode: 'new_conversation' },
  metadata: { conversation_id: '', agent_type: 'acp', created_by: 'user', created_at: 1, updated_at: 1 },
  state: { run_count: 0, retry_count: 0, max_retries: 0, queue_enabled: false },
} satisfies ICronJob;

function client(overrides: Partial<WorkflowRuntimeClient> = {}): WorkflowRuntimeClient {
  return {
    install: vi.fn(async () => ({
      workflow,
      version: {
        id: 'version-1',
        workflowId: workflow.id,
        versionNumber: 1,
        definition,
        compiledPrompt: 'compiled',
        changeSummary: 'Initial version',
        createdAt: 1,
      },
    })),
    list: vi.fn(async () => ({ workflows: [workflow], total: 1 })),
    listVersions: vi.fn(async () => []),
    setState: vi.fn(async (_id, state) => ({ ...workflow, state })),
    rebindRuntimeJob: vi.fn(async (_id, runtimeJobId) => ({ ...workflow, runtimeJobId, state: 'active' })),
    startRun: vi.fn(async (_workflowId, runtimeRunKey) => run(runtimeRunKey)),
    markRunDispatched: vi.fn(async (runId, conversationId) => ({
      ...run('manual-1'),
      id: runId,
      state: 'running',
      conversationId,
    })),
    completeRun: vi.fn(async (runId, state, errorCode) => ({
      ...run('manual-1'),
      id: runId,
      state,
      errorCode: errorCode ?? null,
    })),
    listRuns: vi.fn(async () => ({ runs: [], total: 0 })),
    ...overrides,
  };
}

function run(runtimeRunKey: string, state: WorkflowRun['state'] = 'pending'): WorkflowRun {
  return {
    id: `run-${runtimeRunKey}`,
    workflowId: workflow.id,
    workflowVersionId: workflow.activeVersionId,
    runtimeRunKey,
    state,
    inputSnapshot: {},
    conversationId: null,
    errorCode: null,
    createdAt: 1,
    startedAt: null,
    finishedAt: null,
  };
}

function cron(overrides: Record<string, unknown> = {}) {
  return {
    addJob: vi.fn(async (_input: ICreateCronJobParams) => cronJob),
    removeJob: vi.fn(async (_jobId: string) => undefined),
    runNow: vi.fn(async (_jobId: string) => ({ conversation_id: 'conversation-1' })),
    updateJob: vi.fn(async (_jobId: string, _enabled: boolean) => cronJob),
    listJobs: vi.fn(async () => [cronJob]),
    getJob: vi.fn(async (_jobId: string) => cronJob),
    ...overrides,
  };
}

describe('workflow AionCore runtime', () => {
  it('removes only the newly created Cron job when local installation fails', async () => {
    const localClient = client({ install: vi.fn(async () => Promise.reject(new Error('WRITE_FAILED'))) });
    const localCron = cron();
    const runtime = createWorkflowRuntime({ client: localClient, cron: localCron, randomUUID: () => 'operation-1' });

    await expect(runtime.install(definition, cronDraft())).rejects.toThrow('WRITE_FAILED');
    expect(localCron.removeJob).toHaveBeenCalledWith('cron-1');
  });

  it('records a run before dispatch and leaves approval-blocked runs undispatched', async () => {
    const allowedClient = client();
    const allowedCron = cron();
    const runtime = createWorkflowRuntime({ client: allowedClient, cron: allowedCron, randomUUID: () => 'manual-1' });
    await expect(runtime.runNow(workflow, { source: 'manual' })).resolves.toMatchObject({ state: 'running' });
    expect(allowedClient.startRun).toHaveBeenCalledBefore(allowedCron.runNow);

    const blockedClient = client({
      startRun: vi.fn(async (_workflowId, runtimeRunKey) => run(runtimeRunKey, 'waiting-approval')),
    });
    const blockedCron = cron();
    const blockedRuntime = createWorkflowRuntime({
      client: blockedClient,
      cron: blockedCron,
      randomUUID: () => 'manual-2',
    });
    await expect(blockedRuntime.runNow(workflow, {})).resolves.toMatchObject({ state: 'waiting-approval' });
    expect(blockedCron.runNow).not.toHaveBeenCalled();
  });

  it('dispatches the same run after the user approves it once', async () => {
    const localClient = client();
    const localCron = cron();
    const runtime = createWorkflowRuntime({ client: localClient, cron: localCron });

    await expect(runtime.resumeRun(workflow, run('approved-run'))).resolves.toMatchObject({ state: 'running' });
    expect(localCron.runNow).toHaveBeenCalledWith(workflow.runtimeJobId);
    expect(localClient.markRunDispatched).toHaveBeenCalledWith('run-approved-run', 'conversation-1');
  });

  it('reconciles execution events idempotently into immutable run history', async () => {
    const localClient = client();
    const executedJob = { ...cronJob, state: { ...cronJob.state, run_count: 3, last_run_at_ms: 500 } };
    const localCron = cron({ getJob: vi.fn(async () => executedJob) });
    const runtime = createWorkflowRuntime({ client: localClient, cron: localCron, randomUUID: () => 'unused' });

    await runtime.handleExecuted({ job_id: cronJob.id, status: 'ok' });
    await runtime.handleExecuted({ job_id: cronJob.id, status: 'ok' });

    expect(localClient.startRun).toHaveBeenNthCalledWith(1, workflow.id, 'cron:cron-1:500', {
      source: 'schedule',
    });
    expect(localClient.startRun).toHaveBeenNthCalledWith(2, workflow.id, 'cron:cron-1:500', {
      source: 'schedule',
    });
    expect(localClient.completeRun).toHaveBeenCalledTimes(2);
  });

  it('ignores stale execution state while a restored workflow remains disabled', async () => {
    const disabledWorkflow = { ...workflow, state: 'disabled' as const };
    const startRun = vi.fn(async () => Promise.reject(new Error('WORKFLOW_NOT_ACTIVE')));
    const localClient = client({
      list: vi.fn(async () => ({ workflows: [disabledWorkflow], total: 1 })),
      startRun,
    });
    const disabledJob = {
      ...cronJob,
      enabled: false,
      state: { ...cronJob.state, run_count: 1, last_run_at_ms: 500, last_status: 'ok' as const },
    };
    const localCron = cron({
      listJobs: vi.fn(async () => [disabledJob]),
      getJob: vi.fn(async () => disabledJob),
    });
    const runtime = createWorkflowRuntime({ client: localClient, cron: localCron });

    await expect(runtime.reconcile()).resolves.toBeUndefined();
    expect(startRun).not.toHaveBeenCalled();
  });

  it('marks missing jobs for repair and rebinds a replacement job', async () => {
    const localClient = client();
    const localCron = cron({ listJobs: vi.fn(async () => []) });
    const runtime = createWorkflowRuntime({ client: localClient, cron: localCron, randomUUID: () => 'repair-1' });

    await runtime.reconcile();
    expect(localClient.setState).toHaveBeenCalledWith(workflow.id, 'needs-repair');

    const repaired = await runtime.repair(workflow, cronDraft());
    expect(repaired.runtimeJobId).toBe('cron-1');
    expect(localClient.rebindRuntimeJob).toHaveBeenCalledWith(workflow.id, 'cron-1');
  });
});

function cronDraft(): ICreateCronJobParams {
  return {
    name: definition.name,
    schedule: { kind: 'cron', expr: '', description: 'Manual' },
    prompt: 'placeholder',
    conversation_id: '',
    created_by: 'user',
    execution_mode: 'new_conversation',
  };
}
