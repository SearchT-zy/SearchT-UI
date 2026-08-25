import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  WorkflowApproval,
  WorkflowClient,
  WorkflowGrant,
  WorkflowInstance,
  WorkflowRun,
} from '@/common/types/searcht/workflow';
import WorkflowGrantModal from '@renderer/pages/workflows/WorkflowGrantModal';
import WorkflowGrantSettings from '@renderer/pages/workflows/WorkflowGrantSettings';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${Object.values(values).join(',')}` : key),
  }),
}));

const workflow: WorkflowInstance = {
  id: 'workflow-1',
  templateId: 'inbox-triage',
  name: 'Inbox triage',
  description: 'Classify new files',
  state: 'active',
  runtimeJobId: 'cron-1',
  activeVersionId: 'version-1',
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};

const run: WorkflowRun = {
  id: 'run-1',
  workflowId: workflow.id,
  workflowVersionId: workflow.activeVersionId,
  runtimeRunKey: 'manual-1',
  state: 'waiting-approval',
  inputSnapshot: { folder: 'Inbox', count: 5, ignored: { nested: true } },
  conversationId: null,
  errorCode: null,
  createdAt: 1,
  startedAt: null,
  finishedAt: null,
};

const approval: WorkflowApproval = {
  id: 'approval-1',
  runId: run.id,
  resource: 'cloud-drive/inbox',
  action: 'file.move',
  state: 'pending',
  decidedAt: null,
  createdAt: 1,
};

const grant: WorkflowGrant = {
  id: 'grant-1',
  workflowId: workflow.id,
  resource: approval.resource,
  action: approval.action,
  constraints: { folder: 'Inbox', count: 5 },
  expiresAt: Date.UTC(2026, 8, 15),
  revokedAt: null,
  createdAt: Date.UTC(2026, 7, 16),
  lastUsedAt: Date.UTC(2026, 7, 17),
};

function createClient(overrides: Partial<WorkflowClient> = {}): WorkflowClient {
  return {
    list: vi.fn(async () => ({ workflows: [workflow], total: 1 })),
    listDeleted: vi.fn(async () => ({ workflows: [], total: 0 })),
    get: vi.fn(async () => workflow),
    install: vi.fn(),
    listVersions: vi.fn(async () => []),
    createVersion: vi.fn(),
    setState: vi.fn(async () => workflow),
    rebindRuntimeJob: vi.fn(async () => workflow),
    remove: vi.fn(async () => workflow),
    restore: vi.fn(async () => workflow),
    startRun: vi.fn(),
    markRunDispatched: vi.fn(),
    completeRun: vi.fn(),
    listRuns: vi.fn(async () => ({ runs: [{ ...run, state: 'running' }], total: 1 })),
    listApprovals: vi.fn(async () => [approval]),
    decideApproval: vi.fn(async (_id, decision) => ({ ...approval, state: decision })),
    listGrants: vi.fn(async () => [grant]),
    saveGrant: vi.fn(async (value) => value),
    revokeGrant: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('workflow authorization controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 7, 16));
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
  });

  afterEach(() => vi.restoreAllMocks());

  it('approves only this run without creating a saved grant', async () => {
    const client = createClient();
    const runtime = { resumeRun: vi.fn(async () => run) };

    render(
      <WorkflowGrantModal
        visible
        workflow={workflow}
        run={run}
        client={client}
        runtime={runtime}
        onClose={vi.fn()}
        onCompleted={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'personal.workflows.grants.allow' }));

    await waitFor(() => expect(client.decideApproval).toHaveBeenCalledWith(approval.id, 'approved'));
    expect(client.saveGrant).not.toHaveBeenCalled();
    expect(runtime.resumeRun).toHaveBeenCalledWith(workflow, expect.objectContaining({ id: run.id }));
  });

  it('creates a constrained saved grant before continuing the same run', async () => {
    const client = createClient();
    const runtime = { resumeRun: vi.fn(async () => run) };

    render(
      <WorkflowGrantModal
        visible
        workflow={workflow}
        run={run}
        client={client}
        runtime={runtime}
        onClose={vi.fn()}
        onCompleted={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByText('personal.workflows.grants.remember'));
    fireEvent.click(screen.getByRole('button', { name: 'personal.workflows.grants.allow' }));

    await waitFor(() =>
      expect(client.saveGrant).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: workflow.id,
          resource: approval.resource,
          action: approval.action,
          constraints: { folder: 'Inbox', count: 5 },
          expiresAt: Date.UTC(2026, 7, 23),
        })
      )
    );
    expect(client.decideApproval).toHaveBeenCalledWith(approval.id, 'approved');
    expect(runtime.resumeRun).toHaveBeenCalled();
  });

  it('rejects pending actions without dispatching or saving a grant', async () => {
    const client = createClient();
    const runtime = { resumeRun: vi.fn(async () => run) };
    const onClose = vi.fn();

    render(
      <WorkflowGrantModal
        visible
        workflow={workflow}
        run={run}
        client={client}
        runtime={runtime}
        onClose={onClose}
        onCompleted={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'personal.workflows.grants.reject' }));

    await waitFor(() => expect(client.decideApproval).toHaveBeenCalledWith(approval.id, 'rejected'));
    expect(client.saveGrant).not.toHaveBeenCalled();
    expect(runtime.resumeRun).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows understandable grant details and removes a revoked grant immediately', async () => {
    const client = createClient();

    render(<WorkflowGrantSettings client={client} />);

    expect(await screen.findByText(workflow.name)).toBeInTheDocument();
    expect(screen.getByText(approval.action)).toBeInTheDocument();
    expect(screen.getByText(approval.resource)).toBeInTheDocument();
    expect(screen.getByText(/folder: Inbox/)).toBeInTheDocument();
    expect(screen.getByText(/personal\.workflows\.grants\.lastUsed/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'personal.workflows.grants.revoke' }));

    await waitFor(() => expect(client.revokeGrant).toHaveBeenCalledWith(grant.id));
    expect(screen.queryByText(approval.action)).not.toBeInTheDocument();
  });
});
