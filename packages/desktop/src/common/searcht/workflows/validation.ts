import {
  WORKFLOW_CAPABILITIES,
  type WorkflowActionRequest,
  type WorkflowDefinition,
  type WorkflowGrant,
  type WorkflowGrantConstraintValue,
  type WorkflowValidationIssue,
  type WorkflowValidationIssueCode,
  type WorkflowValidationReport,
} from '../../types/searcht/workflow';

const WORKFLOW_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CRON_PATTERN = /^\S+\s+\S+\s+\S+\s+\S+\s+\S+(?:\s+\S+\s+\S+)?$/u;
const MAX_STEPS = 32;

const ISSUE_ORDER: readonly WorkflowValidationIssueCode[] = [
  'WORKFLOW_ID_REQUIRED',
  'WORKFLOW_ID_INVALID',
  'WORKFLOW_NAME_REQUIRED',
  'WORKFLOW_DESCRIPTION_REQUIRED',
  'WORKFLOW_VERSION_INVALID',
  'WORKFLOW_STEPS_REQUIRED',
  'WORKFLOW_STEPS_TOO_MANY',
  'WORKFLOW_SCHEDULE_INVALID',
  'WORKFLOW_TIMEZONE_REQUIRED',
  'WORKFLOW_STEP_ID_REQUIRED',
  'WORKFLOW_STEP_ID_DUPLICATE',
  'WORKFLOW_STEP_TITLE_REQUIRED',
  'WORKFLOW_STEP_INSTRUCTION_REQUIRED',
  'WORKFLOW_CAPABILITY_UNSUPPORTED',
  'WORKFLOW_RISK_MISMATCH',
  'WORKFLOW_EXTERNAL_APPROVAL_REQUIRED',
  'WORKFLOW_EXTERNAL_ACTION_REQUIRED',
];

function addIssue(issues: WorkflowValidationIssue[], code: WorkflowValidationIssueCode, path: string): void {
  if (!issues.some((issue) => issue.code === code && issue.path === path)) issues.push({ code, path });
}

function cloneDefinition(definition: WorkflowDefinition): WorkflowDefinition {
  return {
    ...definition,
    id: definition.id.trim(),
    name: definition.name.trim(),
    description: definition.description.trim(),
    suggestedSchedule: { ...definition.suggestedSchedule },
    steps: definition.steps.map((step) => ({
      ...step,
      id: step.id.trim(),
      title: step.title.trim(),
      instruction: step.instruction.trim(),
      capabilities: [...new Set(step.capabilities.map((capability) => capability.trim()).filter(Boolean))],
      ...(step.externalAction
        ? {
            externalAction: {
              resource: step.externalAction.resource.trim(),
              action: step.externalAction.action.trim(),
            },
          }
        : {}),
    })),
  };
}

export function validateWorkflowDefinition(input: WorkflowDefinition): WorkflowValidationReport {
  const definition = cloneDefinition(input);
  const issues: WorkflowValidationIssue[] = [];

  if (!definition.id) addIssue(issues, 'WORKFLOW_ID_REQUIRED', 'id');
  else if (!WORKFLOW_ID_PATTERN.test(definition.id) || definition.id.length > 64) {
    addIssue(issues, 'WORKFLOW_ID_INVALID', 'id');
  }
  if (!definition.name || definition.name.length > 120) addIssue(issues, 'WORKFLOW_NAME_REQUIRED', 'name');
  if (!definition.description || definition.description.length > 500) {
    addIssue(issues, 'WORKFLOW_DESCRIPTION_REQUIRED', 'description');
  }
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    addIssue(issues, 'WORKFLOW_VERSION_INVALID', 'version');
  }
  if (!definition.steps.length) addIssue(issues, 'WORKFLOW_STEPS_REQUIRED', 'steps');
  if (definition.steps.length > MAX_STEPS) addIssue(issues, 'WORKFLOW_STEPS_TOO_MANY', 'steps');

  if (definition.suggestedSchedule.kind === 'cron') {
    if (!CRON_PATTERN.test(definition.suggestedSchedule.expr.trim())) {
      addIssue(issues, 'WORKFLOW_SCHEDULE_INVALID', 'suggestedSchedule.expr');
    }
    if (!definition.suggestedSchedule.timezone.trim()) {
      addIssue(issues, 'WORKFLOW_TIMEZONE_REQUIRED', 'suggestedSchedule.timezone');
    }
  }

  const stepIds = new Set<string>();
  definition.steps.forEach((step, index) => {
    const path = `steps.${index}`;
    if (!step.id) addIssue(issues, 'WORKFLOW_STEP_ID_REQUIRED', `${path}.id`);
    else if (stepIds.has(step.id)) addIssue(issues, 'WORKFLOW_STEP_ID_DUPLICATE', `${path}.id`);
    else stepIds.add(step.id);
    if (!step.title) addIssue(issues, 'WORKFLOW_STEP_TITLE_REQUIRED', `${path}.title`);
    if (!step.instruction) addIssue(issues, 'WORKFLOW_STEP_INSTRUCTION_REQUIRED', `${path}.instruction`);
    if (step.capabilities.some((capability) => !WORKFLOW_CAPABILITIES.includes(capability as never))) {
      addIssue(issues, 'WORKFLOW_CAPABILITY_UNSUPPORTED', `${path}.capabilities`);
    }
    if (step.risk === 'external-write' && (!step.externalAction?.resource || !step.externalAction.action)) {
      addIssue(issues, 'WORKFLOW_EXTERNAL_ACTION_REQUIRED', `${path}.externalAction`);
    }
  });

  const hasExternalStep = definition.steps.some((step) => step.risk === 'external-write');
  if (definition.risk === 'external-write' || hasExternalStep) {
    if (definition.approvalPolicy === 'none') {
      addIssue(issues, 'WORKFLOW_EXTERNAL_APPROVAL_REQUIRED', 'approvalPolicy');
    }
  }
  if (hasExternalStep && definition.risk !== 'external-write') {
    addIssue(issues, 'WORKFLOW_RISK_MISMATCH', 'risk');
  }

  const ordered = issues.toSorted((left, right) => ISSUE_ORDER.indexOf(left.code) - ISSUE_ORDER.indexOf(right.code));
  return { valid: ordered.length === 0, issues: ordered, definition: ordered.length === 0 ? definition : null };
}

export function compileWorkflowPrompt(definition: WorkflowDefinition): string {
  const report = validateWorkflowDefinition(definition);
  if (!report.valid || !report.definition) throw new Error(report.issues[0]?.code || 'WORKFLOW_INVALID');

  const stepText = report.definition.steps
    .map((step, index) => {
      const capabilities = step.capabilities.length ? `\n   可用能力：${step.capabilities.join('、')}` : '';
      return `${index + 1}. ${step.title}\n   ${step.instruction}${capabilities}`;
    })
    .join('\n\n');

  return [
    `# ${report.definition.name}`,
    report.definition.description,
    '请严格按以下顺序执行，并在结果中保留可核对的来源：',
    stepText,
    '安全边界：不要执行模板未声明的外部写入、发送、删除或覆盖操作。需要确认的写入先展示草案并等待用户批准。',
  ].join('\n\n');
}

function constraintMatches(allowed: WorkflowGrantConstraintValue, requested: WorkflowGrantConstraintValue): boolean {
  if (Array.isArray(allowed)) {
    return Array.isArray(requested) && requested.every((value) => allowed.includes(value));
  }
  return !Array.isArray(requested) && allowed === requested;
}

export function grantAllowsAction(grant: WorkflowGrant, request: WorkflowActionRequest, now: number): boolean {
  if (
    grant.workflowId !== request.workflowId ||
    grant.resource !== request.resource ||
    grant.action !== request.action
  ) {
    return false;
  }
  if (grant.revokedAt !== null || (grant.expiresAt !== null && grant.expiresAt <= now)) return false;
  return Object.entries(grant.constraints).every(([key, allowed]) => {
    const requested = request.context[key];
    return requested !== undefined && constraintMatches(allowed, requested);
  });
}
