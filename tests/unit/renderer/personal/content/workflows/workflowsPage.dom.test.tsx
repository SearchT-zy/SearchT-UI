import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowClient, WorkflowInstance, WorkflowRun, WorkflowVersion } from '@/common/types/searcht/workflow';
import WorkflowsPage from '@renderer/pages/workflows';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const workflow: WorkflowInstance = {
  id: 'workflow-1',
  templateId: 'daily-planning',
  name: 'Daily planning',
  description: 'Build a useful plan',
  state: 'active',
  runtimeJobId: 'cron-1',
  activeVersionId: 'version-1',
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};

const deletedWorkflow: WorkflowInstance = {
  ...workflow,
  state: 'deleted',
  deletedAt: 2,
};

function client(overrides: Partial<WorkflowClient> = {}): WorkflowClient {
  return {
    list: vi.fn(async () => ({ workflows: [workflow], total: 1 })),
    listDeleted: vi.fn(async () => ({ workflows: [], total: 0 })),
    get: vi.fn(async () => workflow),
    install: vi.fn(),
    listVersions: vi.fn(async () => []),
    createVersion: vi.fn(),
    setState: vi.fn(async (_id, state) => ({ ...workflow, state })),
    rebindRuntimeJob: vi.fn(async (_id, runtimeJobId) => ({ ...workflow, runtimeJobId })),
    remove: vi.fn(async () => ({ ...workflow, state: 'deleted' })),
    restore: vi.fn(async () => ({ ...workflow, state: 'disabled' })),
    startRun: vi.fn(),
    markRunDispatched: vi.fn(),
    completeRun: vi.fn(),
    listRuns: vi.fn(async () => ({ runs: [], total: 0 })),
    listApprovals: vi.fn(async () => []),
    decideApproval: vi.fn(),
    listGrants: vi.fn(async () => []),
    saveGrant: vi.fn(async (grant) => grant),
    revokeGrant: vi.fn(async () => undefined),
    ...overrides,
  };
}

function runtime() {
  return {
    bindCreatedJob: vi.fn(),
    runNow: vi.fn(
      async (): Promise<WorkflowRun> => ({
        id: 'run-1',
        workflowId: workflow.id,
        workflowVersionId: workflow.activeVersionId,
        runtimeRunKey: 'manual-1',
        state: 'running',
        inputSnapshot: {},
        conversationId: 'conversation-1',
        errorCode: null,
        createdAt: 1,
        startedAt: 1,
        finishedAt: null,
      })
    ),
    resumeRun: vi.fn(),
    setEnabled: vi.fn(async (_workflow, enabled) => ({ ...workflow, state: enabled ? 'active' : 'disabled' })),
    repair: vi.fn(async () => workflow),
    reconcile: vi.fn(async () => undefined),
    handleExecuted: vi.fn(async () => undefined),
  };
}

describe('workflows page', () => {
  beforeEach(() => vi.clearAllMocks());

  it('presents built-in templates and ordinary-user tabs', async () => {
    render(<WorkflowsPage client={client()} runtime={runtime()} />);

    expect(await screen.findByText('personal.workflows.templates.dailyPlanning.name')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'personal.workflows.tabs.catalog' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'personal.workflows.tabs.mine' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'personal.workflows.tabs.history' })).toBeInTheDocument();
  });

  it('runs an installed workflow and refreshes its history', async () => {
    const localClient = client();
    const localRuntime = runtime();
    render(<WorkflowsPage client={localClient} runtime={localRuntime} />);

    fireEvent.click(await screen.findByRole('tab', { name: 'personal.workflows.tabs.mine' }));
    fireEvent.click(await screen.findByRole('button', { name: 'personal.workflows.actions.runNow' }));

    await waitFor(() => expect(localRuntime.runNow).toHaveBeenCalledWith(workflow, { source: 'manual' }));
    expect(localClient.listRuns).toHaveBeenCalled();
    expect(screen.getByTestId('workflow-actions')).toHaveClass('workflowActions');
  });

  it('offers a retry when local workflow data cannot be loaded', async () => {
    const error = new Error('offline');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const localClient = client({
      list: vi.fn().mockRejectedValueOnce(error).mockResolvedValue({ workflows: [], total: 0 }),
    });
    render(<WorkflowsPage client={localClient} runtime={runtime()} />);

    expect(await screen.findByText('personal.workflows.errors.load')).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith('[WorkflowsPage] Failed to load workflows', error);
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    await waitFor(() => expect(localClient.list).toHaveBeenCalledTimes(2));
    consoleError.mockRestore();
  });

  it('keeps the latest immutable version visible in the recycle bin', async () => {
    const localClient = client({
      list: vi.fn(async () => ({ workflows: [], total: 0 })),
      listDeleted: vi.fn(async () => ({ workflows: [deletedWorkflow], total: 1 })),
      listVersions: vi.fn(async () => [{ versionNumber: 2 } as WorkflowVersion]),
    });
    render(<WorkflowsPage client={localClient} runtime={runtime()} />);

    fireEvent.click(await screen.findByRole('tab', { name: 'personal.workflows.tabs.mine' }));
    fireEvent.click(screen.getByText('personal.workflows.views.trash'));

    expect(await screen.findByText('v2')).toBeInTheDocument();
    expect(localClient.listVersions).toHaveBeenCalledWith(deletedWorkflow.id);
  });
});
