import { describe, expect, it } from 'vitest';
import type { WorkflowDefinition, WorkflowGrant } from '@/common/types/searcht/workflow';
import { getBuiltinWorkflowTemplates } from '@/common/searcht/workflows/catalog';
import {
  compileWorkflowPrompt,
  grantAllowsAction,
  validateWorkflowDefinition,
} from '@/common/searcht/workflows/validation';

function validDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: 'daily-planning',
    name: '每日规划',
    description: '整理今天的日程、待办和收件箱。',
    version: 1,
    risk: 'read',
    approvalPolicy: 'none',
    suggestedSchedule: {
      kind: 'cron',
      expr: '0 8 * * *',
      timezone: 'Asia/Shanghai',
      description: '每天 08:00',
    },
    steps: [
      {
        id: 'collect',
        title: '收集今天的信息',
        instruction: '读取今天的日程、未完成待办和待整理收件箱。',
        capabilities: ['calendar:read', 'tasks:read', 'inbox:read'],
        risk: 'read',
      },
      {
        id: 'plan',
        title: '形成计划',
        instruction: '按重要性和时间约束输出一份可执行计划。',
        capabilities: [],
        risk: 'read',
      },
    ],
    ...overrides,
  };
}

function grant(overrides: Partial<WorkflowGrant> = {}): WorkflowGrant {
  return {
    id: 'grant-1',
    workflowId: 'mail-follow-up',
    resource: 'mail:account:work',
    action: 'mail:send',
    constraints: { recipients: ['team@example.com'] },
    expiresAt: 2_000,
    revokedAt: null,
    createdAt: 1_000,
    lastUsedAt: null,
    ...overrides,
  };
}

describe('workflow definitions', () => {
  it('ships a stable valid catalog without leaking mutable template objects', () => {
    const first = getBuiltinWorkflowTemplates();
    const second = getBuiltinWorkflowTemplates();

    expect(first.map((template) => template.id)).toEqual([
      'daily-planning',
      'inbox-triage',
      'weekly-review',
      'meeting-follow-up',
    ]);
    expect(first.every((template) => validateWorkflowDefinition(template).valid)).toBe(true);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
  });

  it('compiles ordered steps and safety boundaries into a deterministic prompt', () => {
    const prompt = compileWorkflowPrompt(validDefinition());

    expect(prompt).toContain('1. 收集今天的信息');
    expect(prompt).toContain('2. 形成计划');
    expect(prompt.indexOf('1. 收集今天的信息')).toBeLessThan(prompt.indexOf('2. 形成计划'));
    expect(prompt).toContain('不要执行模板未声明的外部写入、发送、删除或覆盖操作');
  });

  it('reports duplicate steps, unsupported capabilities, and invalid schedules in stable order', () => {
    const report = validateWorkflowDefinition(
      validDefinition({
        suggestedSchedule: { kind: 'cron', expr: '* *', timezone: '', description: '' },
        steps: [
          {
            id: 'same',
            title: '第一步',
            instruction: '读取资料。',
            capabilities: ['calendar:read', 'unknown:capability'],
            risk: 'read',
          },
          {
            id: 'same',
            title: '第二步',
            instruction: '生成摘要。',
            capabilities: [],
            risk: 'read',
          },
        ],
      })
    );

    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual([
      'WORKFLOW_SCHEDULE_INVALID',
      'WORKFLOW_TIMEZONE_REQUIRED',
      'WORKFLOW_STEP_ID_DUPLICATE',
      'WORKFLOW_CAPABILITY_UNSUPPORTED',
    ]);
  });

  it('requires approval policy and an action declaration for external writes', () => {
    const report = validateWorkflowDefinition(
      validDefinition({
        risk: 'external-write',
        approvalPolicy: 'none',
        steps: [
          {
            id: 'send',
            title: '发送跟进邮件',
            instruction: '向参会者发送会议结论。',
            capabilities: ['mail:send'],
            risk: 'external-write',
          },
        ],
      })
    );

    expect(report.issues.map((issue) => issue.code)).toEqual([
      'WORKFLOW_EXTERNAL_APPROVAL_REQUIRED',
      'WORKFLOW_EXTERNAL_ACTION_REQUIRED',
    ]);
  });
});

describe('workflow grants', () => {
  it('allows only a matching active and unexpired scoped grant', () => {
    const request = {
      workflowId: 'mail-follow-up',
      resource: 'mail:account:work',
      action: 'mail:send',
      context: { recipients: ['team@example.com'] },
    };

    expect(grantAllowsAction(grant(), request, 1_500)).toBe(true);
    expect(grantAllowsAction(grant({ expiresAt: 1_500 }), request, 1_500)).toBe(false);
    expect(grantAllowsAction(grant({ revokedAt: 1_200 }), request, 1_500)).toBe(false);
    expect(grantAllowsAction(grant({ action: 'mail:draft' }), request, 1_500)).toBe(false);
    expect(grantAllowsAction(grant(), { ...request, context: { recipients: ['other@example.com'] } }, 1_500)).toBe(
      false
    );
  });
});
