import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from '@/common/types/searcht/workflow';
import { compileWorkflowPrompt } from '@/common/searcht/workflows/validation';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { WorkflowService } from '@process/services/personal-core/content/workflows/WorkflowService';

const directories: string[] = [];

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

function openService(): { database: PersonalDatabase; service: WorkflowService } {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-workflow-service-'));
  directories.push(directory);
  const database = PersonalDatabase.open(directory);
  let nextId = 0;
  let now = 1_000;
  return {
    database,
    service: new WorkflowService(database.driver, {
      now: () => ++now,
      randomUUID: () => `generated-${++nextId}`,
    }),
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('WorkflowService', () => {
  it('rebinds a repaired runtime job and returns the workflow to active state', () => {
    const { database, service } = openService();
    try {
      const localDefinition = definition();
      const installed = service.install({
        operationId: 'install-repair',
        templateId: localDefinition.id,
        runtimeJobId: 'cron-missing',
        definition: localDefinition,
        compiledPrompt: compileWorkflowPrompt(localDefinition),
        changeSummary: 'Initial version',
      });
      service.setState(installed.workflow.id, 'needs-repair');

      expect(service.rebindRuntimeJob(installed.workflow.id, 'cron-replacement')).toMatchObject({
        runtimeJobId: 'cron-replacement',
        state: 'active',
      });
    } finally {
      database.close();
    }
  });

  it('appends immutable versions and supports recoverable removal', () => {
    const { database, service } = openService();
    try {
      const firstDefinition = definition();
      const installed = service.install({
        operationId: 'install-lifecycle',
        templateId: firstDefinition.id,
        runtimeJobId: 'cron-lifecycle',
        definition: firstDefinition,
        compiledPrompt: compileWorkflowPrompt(firstDefinition),
        changeSummary: 'Initial version',
      });
      const nextDefinition = { ...firstDefinition, name: 'Updated planning', version: 2 };
      const next = service.createVersion({
        workflowId: installed.workflow.id,
        definition: nextDefinition,
        compiledPrompt: compileWorkflowPrompt(nextDefinition),
        changeSummary: 'Updated instructions',
      });
      expect(next.versionNumber).toBe(2);
      expect(service.listVersions(installed.workflow.id).map((version) => version.versionNumber)).toEqual([2, 1]);

      expect(service.remove(installed.workflow.id).state).toBe('deleted');
      expect(service.list().workflows).toEqual([]);
      expect(service.listDeleted().workflows).toEqual([expect.objectContaining({ id: installed.workflow.id })]);
      expect(service.restore(installed.workflow.id)).toMatchObject({ state: 'disabled', activeVersionId: next.id });
    } finally {
      database.close();
    }
  });

  it('installs idempotently and pins each run to an immutable active version', () => {
    const { database, service } = openService();
    try {
      const firstDefinition = definition();
      const input = {
        operationId: 'install-1',
        templateId: firstDefinition.id,
        runtimeJobId: 'cron-1',
        definition: firstDefinition,
        compiledPrompt: compileWorkflowPrompt(firstDefinition),
        changeSummary: 'Initial version',
      };
      const installed = service.install(input);
      expect(service.install(input)).toEqual(installed);
      expect(installed.version.versionNumber).toBe(1);

      const run = service.startRun(installed.workflow.id, 'runtime-run-1', { source: 'manual' });
      expect(run.workflowVersionId).toBe(installed.version.id);
      expect(run.state).toBe('pending');
      expect(service.startRun(installed.workflow.id, 'runtime-run-1', { source: 'retry' })).toEqual(run);

      const dispatched = service.markRunDispatched(run.id, 'conversation-1');
      expect(dispatched.state).toBe('running');
      const completed = service.completeRun(run.id, 'succeeded');
      expect(completed.state).toBe('succeeded');
      expect(service.completeRun(run.id, 'succeeded')).toEqual(completed);
    } finally {
      database.close();
    }
  });

  it('stops external writes at an approval checkpoint without a matching grant', () => {
    const { database, service } = openService();
    try {
      const external = definition(true);
      const installed = service.install({
        operationId: 'install-external',
        templateId: external.id,
        runtimeJobId: 'cron-mail',
        definition: external,
        compiledPrompt: compileWorkflowPrompt(external),
        changeSummary: 'Initial version',
      });

      const blocked = service.startRun(installed.workflow.id, 'runtime-mail-1', {
        recipients: ['team@example.com'],
      });
      expect(blocked.state).toBe('waiting-approval');
      expect(service.listApprovals(blocked.id)).toEqual([
        expect.objectContaining({ resource: 'mail:account:work', action: 'mail:send', state: 'pending' }),
      ]);
      const approval = service.listApprovals(blocked.id)[0];
      expect(service.decideApproval(approval.id, 'approved').state).toBe('approved');
      expect(service.listRuns(installed.workflow.id).runs[0].state).toBe('pending');

      service.saveGrant({
        id: 'grant-1',
        workflowId: installed.workflow.id,
        resource: 'mail:account:work',
        action: 'mail:send',
        constraints: { recipients: ['team@example.com'] },
        expiresAt: 2_000,
        revokedAt: null,
        createdAt: 1_000,
        lastUsedAt: null,
      });
      const allowed = service.startRun(installed.workflow.id, 'runtime-mail-2', {
        recipients: ['team@example.com'],
      });
      expect(allowed.state).toBe('pending');

      service.revokeGrant('grant-1');
      expect(
        service.startRun(installed.workflow.id, 'runtime-mail-3', { recipients: ['team@example.com'] }).state
      ).toBe('waiting-approval');
    } finally {
      database.close();
    }
  });
});
