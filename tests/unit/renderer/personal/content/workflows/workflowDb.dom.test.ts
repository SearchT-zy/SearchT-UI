import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from '@/common/types/searcht/workflow';
import { compileWorkflowPrompt } from '@/common/searcht/workflows/validation';
import { openWorkflowDatabase } from '@renderer/pages/workflows/workflowDb';

const DATABASE_NAME = 'searcht-workflow-db-test';

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.addEventListener('success', () => resolve(), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
    request.addEventListener('blocked', () => resolve(), { once: true });
  });
}

function createVersion4Database(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 4);
    request.addEventListener('upgradeneeded', () => {
      request.result.createObjectStore('inboxItems', { keyPath: 'id' }).add({ id: 'inbox-1', title: 'Inbox row' });
      request.result
        .createObjectStore('managedSkills', { keyPath: 'id' })
        .add({ id: 'skill-1', slug: 'existing-skill' });
    });
    request.addEventListener('success', () => {
      request.result.close();
      resolve();
    });
    request.addEventListener('error', () => reject(request.error));
  });
}

function definition(external = false): WorkflowDefinition {
  return {
    id: external ? 'mail-follow-up' : 'daily-planning',
    name: external ? '邮件跟进' : '每日规划',
    description: 'A test workflow',
    version: 1,
    risk: external ? 'external-write' : 'read',
    approvalPolicy: external ? 'grant-required' : 'none',
    suggestedSchedule: { kind: 'manual' },
    steps: [
      {
        id: 'step-1',
        title: external ? '发送邮件' : '形成计划',
        instruction: external ? '发送已确认的邮件。' : '读取今日信息并形成计划。',
        capabilities: external ? ['mail:send'] : ['tasks:read'],
        risk: external ? 'external-write' : 'read',
        ...(external ? { externalAction: { resource: 'mail:account:work', action: 'mail:send' } } : {}),
      },
    ],
  };
}

function options() {
  let nextId = 0;
  let now = 1_000;
  return {
    name: DATABASE_NAME,
    factory: indexedDB,
    now: () => ++now,
    randomUUID: () => `generated-${++nextId}`,
  };
}

beforeEach(deleteDatabase);
afterEach(deleteDatabase);

describe('WebUI workflow database', () => {
  it('upgrades v4 to the current schema without losing existing personal or skill rows', async () => {
    await createVersion4Database();
    const workflows = await openWorkflowDatabase(options());
    workflows.close();

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME);
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
    });
    expect(database.version).toBe(7);
    expect(Array.from(database.objectStoreNames)).toEqual(
      expect.arrayContaining([
        'collaborationDeliveries',
        'collaborationInviteCodes',
        'collaborationMembers',
        'collaborationMessages',
        'inboxItems',
        'managedSkills',
        'workflowInstances',
        'workflowVersions',
        'workflowRuns',
        'workflowApprovals',
        'workflowGrants',
      ])
    );
    const transaction = database.transaction(['inboxItems', 'managedSkills'], 'readonly');
    const rows = await Promise.all(
      ['inboxItems', 'managedSkills'].map(
        (name) =>
          new Promise<Record<string, string>>((resolve, reject) => {
            const request = transaction.objectStore(name).getAll();
            request.addEventListener('success', () => resolve(request.result[0]), { once: true });
            request.addEventListener('error', () => reject(request.error), { once: true });
          })
      )
    );
    expect(rows).toEqual([
      expect.objectContaining({ title: 'Inbox row' }),
      expect.objectContaining({ slug: 'existing-skill' }),
    ]);
    database.close();
  });

  it('matches Electron install, run, approval, and grant behavior', async () => {
    const workflows = await openWorkflowDatabase(options());
    const local = definition();
    const installed = await workflows.install({
      operationId: 'install-1',
      templateId: local.id,
      runtimeJobId: 'cron-1',
      definition: local,
      compiledPrompt: compileWorkflowPrompt(local),
      changeSummary: 'Initial version',
    });
    await expect(
      workflows.install({
        operationId: 'install-1',
        templateId: local.id,
        runtimeJobId: 'cron-1',
        definition: local,
        compiledPrompt: compileWorkflowPrompt(local),
        changeSummary: 'Retry',
      })
    ).resolves.toEqual(installed);
    await workflows.setState(installed.workflow.id, 'needs-repair');
    await expect(workflows.rebindRuntimeJob(installed.workflow.id, 'cron-repaired')).resolves.toMatchObject({
      runtimeJobId: 'cron-repaired',
      state: 'active',
    });
    const nextDefinition = { ...local, name: 'Updated planning', version: 2 };
    const nextVersion = await workflows.createVersion({
      workflowId: installed.workflow.id,
      definition: nextDefinition,
      compiledPrompt: compileWorkflowPrompt(nextDefinition),
      changeSummary: 'Updated instructions',
    });
    expect(nextVersion.versionNumber).toBe(2);
    expect((await workflows.remove(installed.workflow.id)).state).toBe('deleted');
    expect(await workflows.list()).toEqual({ workflows: [], total: 0 });
    expect(await workflows.listDeleted()).toEqual({
      workflows: [expect.objectContaining({ id: installed.workflow.id, state: 'deleted' })],
      total: 1,
    });
    expect(await workflows.restore(installed.workflow.id)).toMatchObject({
      state: 'disabled',
      activeVersionId: nextVersion.id,
    });
    await workflows.setState(installed.workflow.id, 'active');

    const run = await workflows.startRun(installed.workflow.id, 'runtime-run-1', { source: 'manual' });
    expect(run.workflowVersionId).toBe(nextVersion.id);
    expect((await workflows.markRunDispatched(run.id, 'conversation-1')).state).toBe('running');
    expect((await workflows.completeRun(run.id, 'succeeded')).state).toBe('succeeded');

    const external = definition(true);
    const mailWorkflow = await workflows.install({
      operationId: 'install-mail',
      templateId: external.id,
      runtimeJobId: 'cron-mail',
      definition: external,
      compiledPrompt: compileWorkflowPrompt(external),
      changeSummary: 'Initial version',
    });
    const blocked = await workflows.startRun(mailWorkflow.workflow.id, 'runtime-mail-1', {
      recipients: ['team@example.com'],
    });
    expect(blocked.state).toBe('waiting-approval');
    expect(await workflows.listApprovals(blocked.id)).toEqual([
      expect.objectContaining({ resource: 'mail:account:work', action: 'mail:send', state: 'pending' }),
    ]);
    const approval = (await workflows.listApprovals(blocked.id))[0];
    await expect(workflows.decideApproval(approval.id, 'approved')).resolves.toMatchObject({ state: 'approved' });
    expect((await workflows.listRuns(mailWorkflow.workflow.id)).runs[0].state).toBe('pending');

    await workflows.saveGrant({
      id: 'grant-1',
      workflowId: mailWorkflow.workflow.id,
      resource: 'mail:account:work',
      action: 'mail:send',
      constraints: { recipients: ['team@example.com'] },
      expiresAt: 2_000,
      revokedAt: null,
      createdAt: 1_000,
      lastUsedAt: null,
    });
    expect(
      (
        await workflows.startRun(mailWorkflow.workflow.id, 'runtime-mail-2', {
          recipients: ['team@example.com'],
        })
      ).state
    ).toBe('pending');
    workflows.close();
  });
});
