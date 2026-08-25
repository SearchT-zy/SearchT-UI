import type { WorkflowDefinition } from '../../types/searcht/workflow';

const BUILTIN_TEMPLATES: readonly WorkflowDefinition[] = [
  {
    id: 'daily-planning',
    name: '每日规划',
    description: '结合今天的日程、待办和收件箱，形成一份有顺序的行动计划。',
    nameKey: 'personal.workflows.templates.dailyPlanning.name',
    descriptionKey: 'personal.workflows.templates.dailyPlanning.description',
    version: 1,
    risk: 'read',
    approvalPolicy: 'none',
    suggestedSchedule: { kind: 'cron', expr: '0 8 * * *', timezone: 'Asia/Shanghai', description: '每天 08:00' },
    steps: [
      {
        id: 'collect',
        title: '收集今天的信息',
        instruction: '读取今天的日程、未完成待办和待整理收件箱，保留来源。',
        capabilities: ['calendar:read', 'tasks:read', 'inbox:read'],
        risk: 'read',
      },
      {
        id: 'prioritize',
        title: '形成行动顺序',
        instruction: '结合截止时间、依赖关系和重要程度，输出一份可执行的今日计划。',
        capabilities: [],
        risk: 'read',
      },
    ],
  },
  {
    id: 'inbox-triage',
    name: '收件箱整理',
    description: '判断内容更适合变成待办、日程、笔记还是知识，并先给出整理草案。',
    nameKey: 'personal.workflows.templates.inboxTriage.name',
    descriptionKey: 'personal.workflows.templates.inboxTriage.description',
    version: 1,
    risk: 'local-write',
    approvalPolicy: 'per-run',
    suggestedSchedule: { kind: 'manual' },
    steps: [
      {
        id: 'classify',
        title: '分类待整理内容',
        instruction: '读取待整理收件箱，为每一项判断最合适的去向并说明理由。',
        capabilities: ['inbox:read'],
        risk: 'read',
      },
      {
        id: 'draft-actions',
        title: '生成整理草案',
        instruction: '生成待办、日程、笔记或知识条目草案；提交前展示变更，不静默写入。',
        capabilities: ['tasks:write', 'calendar:write', 'notes:write', 'inbox:organize'],
        risk: 'local-write',
      },
    ],
  },
  {
    id: 'weekly-review',
    name: '每周复盘',
    description: '汇总本周完成、延期和关键进展，生成一份可继续编辑的复盘笔记。',
    nameKey: 'personal.workflows.templates.weeklyReview.name',
    descriptionKey: 'personal.workflows.templates.weeklyReview.description',
    version: 1,
    risk: 'local-write',
    approvalPolicy: 'per-run',
    suggestedSchedule: { kind: 'cron', expr: '0 18 * * FRI', timezone: 'Asia/Shanghai', description: '每周五 18:00' },
    steps: [
      {
        id: 'review',
        title: '回顾本周',
        instruction: '读取本周完成和未完成待办、日程以及相关笔记，引用来源并识别延期原因。',
        capabilities: ['tasks:read', 'calendar:read', 'notes:read', 'knowledge:read'],
        risk: 'read',
      },
      {
        id: 'draft-note',
        title: '生成复盘笔记',
        instruction: '生成包含成果、问题、经验和下周重点的笔记草案，等待用户确认保存。',
        capabilities: ['notes:write'],
        risk: 'local-write',
      },
    ],
  },
  {
    id: 'meeting-follow-up',
    name: '会议跟进',
    description: '从会议记录中提取决定、负责人、截止时间和需要起草的跟进内容。',
    nameKey: 'personal.workflows.templates.meetingFollowUp.name',
    descriptionKey: 'personal.workflows.templates.meetingFollowUp.description',
    version: 1,
    risk: 'local-write',
    approvalPolicy: 'per-run',
    suggestedSchedule: { kind: 'manual' },
    steps: [
      {
        id: 'extract',
        title: '提取会议结论',
        instruction: '读取用户指定的会议笔记，提取决定、待确认问题、负责人和截止时间。',
        capabilities: ['notes:read', 'knowledge:read'],
        risk: 'read',
      },
      {
        id: 'draft-follow-up',
        title: '生成跟进草案',
        instruction: '生成待办和邮件草稿，不发送邮件；所有写入内容先展示给用户确认。',
        capabilities: ['tasks:write', 'mail:draft'],
        risk: 'local-write',
      },
    ],
  },
];

function cloneDefinition(definition: WorkflowDefinition): WorkflowDefinition {
  return {
    ...definition,
    suggestedSchedule: { ...definition.suggestedSchedule },
    steps: definition.steps.map((step) => ({
      ...step,
      capabilities: [...step.capabilities],
      ...(step.externalAction ? { externalAction: { ...step.externalAction } } : {}),
    })),
  };
}

export function getBuiltinWorkflowTemplates(): WorkflowDefinition[] {
  return BUILTIN_TEMPLATES.map(cloneDefinition);
}
