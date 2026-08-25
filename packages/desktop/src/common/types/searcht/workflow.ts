export const WORKFLOW_RISK_LEVELS = ['read', 'local-write', 'external-write'] as const;
export type WorkflowRiskLevel = (typeof WORKFLOW_RISK_LEVELS)[number];

export const WORKFLOW_APPROVAL_POLICIES = ['none', 'per-run', 'grant-required'] as const;
export type WorkflowApprovalPolicy = (typeof WORKFLOW_APPROVAL_POLICIES)[number];

export const WORKFLOW_CAPABILITIES = [
  'calendar:read',
  'calendar:write',
  'tasks:read',
  'tasks:write',
  'inbox:read',
  'inbox:organize',
  'notes:read',
  'notes:write',
  'knowledge:read',
  'mail:draft',
  'mail:send',
  'files:read',
  'files:delete',
] as const;
export type WorkflowCapability = (typeof WORKFLOW_CAPABILITIES)[number];

export type WorkflowSchedule =
  | { kind: 'manual' }
  | { kind: 'cron'; expr: string; timezone: string; description: string };

export type WorkflowExternalAction = {
  resource: string;
  action: string;
};

export type WorkflowStep = {
  id: string;
  title: string;
  instruction: string;
  capabilities: string[];
  risk: WorkflowRiskLevel;
  externalAction?: WorkflowExternalAction;
};

export type WorkflowDefinition = {
  id: string;
  name: string;
  description: string;
  nameKey?: string;
  descriptionKey?: string;
  version: number;
  risk: WorkflowRiskLevel;
  approvalPolicy: WorkflowApprovalPolicy;
  suggestedSchedule: WorkflowSchedule;
  steps: WorkflowStep[];
};

export type WorkflowValidationIssueCode =
  | 'WORKFLOW_ID_REQUIRED'
  | 'WORKFLOW_ID_INVALID'
  | 'WORKFLOW_NAME_REQUIRED'
  | 'WORKFLOW_DESCRIPTION_REQUIRED'
  | 'WORKFLOW_VERSION_INVALID'
  | 'WORKFLOW_STEPS_REQUIRED'
  | 'WORKFLOW_STEPS_TOO_MANY'
  | 'WORKFLOW_SCHEDULE_INVALID'
  | 'WORKFLOW_TIMEZONE_REQUIRED'
  | 'WORKFLOW_STEP_ID_REQUIRED'
  | 'WORKFLOW_STEP_ID_DUPLICATE'
  | 'WORKFLOW_STEP_TITLE_REQUIRED'
  | 'WORKFLOW_STEP_INSTRUCTION_REQUIRED'
  | 'WORKFLOW_CAPABILITY_UNSUPPORTED'
  | 'WORKFLOW_RISK_MISMATCH'
  | 'WORKFLOW_EXTERNAL_APPROVAL_REQUIRED'
  | 'WORKFLOW_EXTERNAL_ACTION_REQUIRED';

export type WorkflowValidationIssue = {
  code: WorkflowValidationIssueCode;
  path: string;
};

export type WorkflowValidationReport = {
  valid: boolean;
  issues: WorkflowValidationIssue[];
  definition: WorkflowDefinition | null;
};

export type WorkflowInstanceState = 'active' | 'disabled' | 'needs-repair' | 'deleted';
export type WorkflowRunState =
  | 'pending'
  | 'waiting-approval'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'missed';

export type WorkflowInstance = {
  id: string;
  templateId: string | null;
  name: string;
  description: string;
  state: WorkflowInstanceState;
  runtimeJobId: string;
  activeVersionId: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type WorkflowVersion = {
  id: string;
  workflowId: string;
  versionNumber: number;
  definition: WorkflowDefinition;
  compiledPrompt: string;
  changeSummary: string;
  createdAt: number;
};

export type WorkflowRun = {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  runtimeRunKey: string;
  state: WorkflowRunState;
  inputSnapshot: Record<string, unknown>;
  conversationId: string | null;
  errorCode: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
};

export type WorkflowApproval = {
  id: string;
  runId: string;
  resource: string;
  action: string;
  state: 'pending' | 'approved' | 'rejected';
  decidedAt: number | null;
  createdAt: number;
};

export type WorkflowGrantConstraintValue = string | number | boolean | string[];
export type WorkflowGrant = {
  id: string;
  workflowId: string;
  resource: string;
  action: string;
  constraints: Record<string, WorkflowGrantConstraintValue>;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
  lastUsedAt: number | null;
};

export type WorkflowActionRequest = {
  workflowId: string;
  resource: string;
  action: string;
  context: Record<string, WorkflowGrantConstraintValue>;
};

export type WorkflowListResult = { workflows: WorkflowInstance[]; total: number };
export type WorkflowRunListResult = { runs: WorkflowRun[]; total: number };

export type WorkflowInstallInput = {
  operationId: string;
  templateId: string | null;
  runtimeJobId: string;
  definition: WorkflowDefinition;
  compiledPrompt: string;
  changeSummary: string;
};

export type WorkflowVersionCreateInput = {
  workflowId: string;
  definition: WorkflowDefinition;
  compiledPrompt: string;
  changeSummary: string;
};

export type WorkflowClient = {
  list(): Promise<WorkflowListResult>;
  listDeleted(): Promise<WorkflowListResult>;
  get(id: string): Promise<WorkflowInstance | null>;
  install(input: WorkflowInstallInput): Promise<{ workflow: WorkflowInstance; version: WorkflowVersion }>;
  listVersions(workflowId: string): Promise<WorkflowVersion[]>;
  createVersion(input: WorkflowVersionCreateInput): Promise<WorkflowVersion>;
  setState(id: string, state: Exclude<WorkflowInstanceState, 'deleted'>): Promise<WorkflowInstance>;
  rebindRuntimeJob(id: string, runtimeJobId: string): Promise<WorkflowInstance>;
  remove(id: string): Promise<WorkflowInstance>;
  restore(id: string): Promise<WorkflowInstance>;
  startRun(workflowId: string, runtimeRunKey: string, input: Record<string, unknown>): Promise<WorkflowRun>;
  markRunDispatched(runId: string, conversationId: string): Promise<WorkflowRun>;
  completeRun(
    runId: string,
    state: Extract<WorkflowRunState, 'succeeded' | 'failed' | 'skipped' | 'missed'>,
    errorCode?: string
  ): Promise<WorkflowRun>;
  listRuns(workflowId?: string): Promise<WorkflowRunListResult>;
  listApprovals(runId: string): Promise<WorkflowApproval[]>;
  decideApproval(id: string, decision: 'approved' | 'rejected'): Promise<WorkflowApproval>;
  listGrants(workflowId?: string): Promise<WorkflowGrant[]>;
  saveGrant(grant: WorkflowGrant): Promise<WorkflowGrant>;
  revokeGrant(id: string): Promise<void>;
};
