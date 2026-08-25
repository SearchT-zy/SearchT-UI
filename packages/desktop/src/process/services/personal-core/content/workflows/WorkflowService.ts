import type {
  WorkflowApproval,
  WorkflowGrant,
  WorkflowGrantConstraintValue,
  WorkflowInstallInput,
  WorkflowInstance,
  WorkflowInstanceState,
  WorkflowListResult,
  WorkflowRun,
  WorkflowRunListResult,
  WorkflowRunState,
  WorkflowVersion,
  WorkflowVersionCreateInput,
} from '@/common/types/searcht/workflow';
import {
  compileWorkflowPrompt,
  grantAllowsAction,
  validateWorkflowDefinition,
} from '@/common/searcht/workflows/validation';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import { WorkflowRepository } from './WorkflowRepository';

export type WorkflowServiceOptions = {
  now?: () => number;
  randomUUID?: () => string;
};

const TERMINAL_STATES = new Set<WorkflowRunState>(['succeeded', 'failed', 'skipped', 'missed']);

export class WorkflowService {
  private readonly repository: WorkflowRepository;
  private readonly now: () => number;
  private readonly randomUUID: () => string;

  constructor(driver: ISqliteDriver, options: WorkflowServiceOptions = {}) {
    this.repository = new WorkflowRepository(driver);
    this.now = options.now ?? Date.now;
    this.randomUUID = options.randomUUID ?? crypto.randomUUID;
  }

  list(): WorkflowListResult {
    const workflows = this.repository.listWorkflows();
    return { workflows, total: workflows.length };
  }

  listDeleted(): WorkflowListResult {
    const workflows = this.repository.listDeletedWorkflows();
    return { workflows, total: workflows.length };
  }

  get(id: string): WorkflowInstance | null {
    return this.repository.findWorkflowById(normalizeId(id, 'WORKFLOW_ID_REQUIRED'));
  }

  install(input: WorkflowInstallInput): { workflow: WorkflowInstance; version: WorkflowVersion } {
    const operationId = normalizeId(input.operationId, 'WORKFLOW_OPERATION_ID_REQUIRED');
    const runtimeJobId = normalizeId(input.runtimeJobId, 'WORKFLOW_RUNTIME_JOB_ID_REQUIRED');
    const report = validateWorkflowDefinition(input.definition);
    if (!report.valid || !report.definition) throw new Error(report.issues[0]?.code || 'WORKFLOW_INVALID');
    const compiledPrompt = compileWorkflowPrompt(report.definition);
    if (input.compiledPrompt !== compiledPrompt) throw new Error('WORKFLOW_COMPILED_PROMPT_MISMATCH');

    return this.repository.transaction(() => {
      const existing = this.repository.findWorkflowByOperationId(operationId);
      if (existing) {
        const version = this.repository.findVersionById(existing.activeVersionId);
        if (!version) throw new Error('WORKFLOW_VERSION_NOT_FOUND');
        return { workflow: existing, version };
      }

      const now = this.now();
      const workflowId = this.randomUUID();
      this.repository.insertWorkflow(operationId, {
        id: workflowId,
        templateId: input.templateId?.trim() || null,
        name: report.definition.name,
        description: report.definition.description,
        state: 'active',
        runtimeJobId,
        activeVersionId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      const version: WorkflowVersion = {
        id: this.randomUUID(),
        workflowId,
        versionNumber: 1,
        definition: report.definition,
        compiledPrompt,
        changeSummary: input.changeSummary.trim(),
        createdAt: now,
      };
      this.repository.insertVersion(version);
      this.repository.updateWorkflow({
        id: workflowId,
        templateId: input.templateId?.trim() || null,
        name: report.definition.name,
        description: report.definition.description,
        state: 'active',
        runtimeJobId,
        activeVersionId: version.id,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      const workflow = this.repository.findWorkflowById(workflowId)!;
      this.repository.insertAudit(
        this.randomUUID(),
        'workflow_install',
        { workflowId, runtimeJobId, versionId: version.id, templateId: workflow.templateId },
        now
      );
      return { workflow, version };
    });
  }

  listVersions(workflowId: string): WorkflowVersion[] {
    return this.repository.listVersions(normalizeId(workflowId, 'WORKFLOW_ID_REQUIRED'));
  }

  createVersion(input: WorkflowVersionCreateInput): WorkflowVersion {
    const workflowId = normalizeId(input.workflowId, 'WORKFLOW_ID_REQUIRED');
    const report = validateWorkflowDefinition(input.definition);
    if (!report.valid || !report.definition) throw new Error(report.issues[0]?.code || 'WORKFLOW_INVALID');
    const compiledPrompt = compileWorkflowPrompt(report.definition);
    if (compiledPrompt !== input.compiledPrompt) throw new Error('WORKFLOW_COMPILED_PROMPT_MISMATCH');
    return this.repository.transaction(() => {
      const workflow = this.repository.findWorkflowById(workflowId);
      if (!workflow || workflow.state === 'deleted') throw new Error('WORKFLOW_NOT_FOUND');
      const now = this.now();
      const version: WorkflowVersion = {
        id: this.randomUUID(),
        workflowId,
        versionNumber: (this.repository.listVersions(workflowId)[0]?.versionNumber ?? 0) + 1,
        definition: report.definition,
        compiledPrompt,
        changeSummary: input.changeSummary.trim(),
        createdAt: now,
      };
      this.repository.insertVersion(version);
      this.repository.updateWorkflow({
        ...workflow,
        name: report.definition.name,
        description: report.definition.description,
        activeVersionId: version.id,
        updatedAt: now,
      });
      this.repository.insertAudit(
        this.randomUUID(),
        'workflow_version_create',
        { workflowId, versionId: version.id },
        now
      );
      return version;
    });
  }

  setState(id: string, state: Exclude<WorkflowInstanceState, 'deleted'>): WorkflowInstance {
    const workflowId = normalizeId(id, 'WORKFLOW_ID_REQUIRED');
    if (!['active', 'disabled', 'needs-repair'].includes(state)) throw new Error('WORKFLOW_STATE_INVALID');
    return this.repository.transaction(() => {
      const workflow = this.repository.findWorkflowById(workflowId);
      if (!workflow) throw new Error('WORKFLOW_NOT_FOUND');
      const now = this.now();
      this.repository.updateWorkflow({ ...workflow, state, updatedAt: now });
      this.repository.insertAudit(this.randomUUID(), 'workflow_state_update', { workflowId, state }, now);
      return this.repository.findWorkflowById(workflowId)!;
    });
  }

  rebindRuntimeJob(idValue: string, runtimeJobIdValue: string): WorkflowInstance {
    const id = normalizeId(idValue, 'WORKFLOW_ID_REQUIRED');
    const runtimeJobId = normalizeId(runtimeJobIdValue, 'WORKFLOW_RUNTIME_JOB_ID_REQUIRED');
    return this.repository.transaction(() => {
      const workflow = this.repository.findWorkflowById(id);
      if (!workflow) throw new Error('WORKFLOW_NOT_FOUND');
      const now = this.now();
      this.repository.updateWorkflow({ ...workflow, runtimeJobId, state: 'active', updatedAt: now });
      this.repository.insertAudit(this.randomUUID(), 'workflow_runtime_rebind', { workflowId: id, runtimeJobId }, now);
      return this.repository.findWorkflowById(id)!;
    });
  }

  remove(idValue: string): WorkflowInstance {
    const id = normalizeId(idValue, 'WORKFLOW_ID_REQUIRED');
    return this.repository.transaction(() => {
      const workflow = this.repository.findWorkflowById(id);
      if (!workflow) throw new Error('WORKFLOW_NOT_FOUND');
      if (workflow.state === 'deleted') return workflow;
      const now = this.now();
      this.repository.updateWorkflow({ ...workflow, state: 'deleted', deletedAt: now, updatedAt: now });
      this.repository.insertAudit(this.randomUUID(), 'workflow_remove', { workflowId: id }, now);
      return this.repository.findWorkflowById(id)!;
    });
  }

  restore(idValue: string): WorkflowInstance {
    const id = normalizeId(idValue, 'WORKFLOW_ID_REQUIRED');
    return this.repository.transaction(() => {
      const workflow = this.repository.findWorkflowById(id);
      if (!workflow) throw new Error('WORKFLOW_NOT_FOUND');
      if (workflow.state !== 'deleted') return workflow;
      const now = this.now();
      this.repository.updateWorkflow({ ...workflow, state: 'disabled', deletedAt: null, updatedAt: now });
      this.repository.insertAudit(this.randomUUID(), 'workflow_restore', { workflowId: id }, now);
      return this.repository.findWorkflowById(id)!;
    });
  }

  startRun(workflowIdValue: string, runtimeRunKeyValue: string, input: Record<string, unknown>): WorkflowRun {
    const workflowId = normalizeId(workflowIdValue, 'WORKFLOW_ID_REQUIRED');
    const runtimeRunKey = normalizeId(runtimeRunKeyValue, 'WORKFLOW_RUNTIME_RUN_KEY_REQUIRED');
    return this.repository.transaction(() => {
      const existing = this.repository.findRunByRuntimeKey(workflowId, runtimeRunKey);
      if (existing) return existing;
      const workflow = this.repository.findWorkflowById(workflowId);
      if (!workflow) throw new Error('WORKFLOW_NOT_FOUND');
      if (workflow.state !== 'active') throw new Error('WORKFLOW_NOT_ACTIVE');
      const version = this.repository.findVersionById(workflow.activeVersionId);
      if (!version) throw new Error('WORKFLOW_VERSION_NOT_FOUND');

      const now = this.now();
      const context = normalizeGrantContext(input);
      const grants = this.repository.listGrants(workflowId);
      const missingActions = version.definition.steps
        .filter((step) => step.risk === 'external-write' && step.externalAction)
        .map((step) => step.externalAction!)
        .filter(
          (action) =>
            !grants.some((grant) =>
              grantAllowsAction(grant, { workflowId, resource: action.resource, action: action.action, context }, now)
            )
        );
      const run: WorkflowRun = {
        id: this.randomUUID(),
        workflowId,
        workflowVersionId: version.id,
        runtimeRunKey,
        state: missingActions.length ? 'waiting-approval' : 'pending',
        inputSnapshot: structuredClone(input),
        conversationId: null,
        errorCode: null,
        createdAt: now,
        startedAt: null,
        finishedAt: null,
      };
      this.repository.insertRun(run);
      for (const action of missingActions) {
        this.repository.insertApproval({
          id: this.randomUUID(),
          runId: run.id,
          resource: action.resource,
          action: action.action,
          state: 'pending',
          decidedAt: null,
          createdAt: now,
        });
      }
      this.repository.insertAudit(
        this.randomUUID(),
        'workflow_run_start',
        { workflowId, runId: run.id, versionId: version.id, state: run.state },
        now
      );
      return this.repository.findRunById(run.id)!;
    });
  }

  markRunDispatched(runIdValue: string, conversationIdValue: string): WorkflowRun {
    const runId = normalizeId(runIdValue, 'WORKFLOW_RUN_ID_REQUIRED');
    const conversationId = normalizeId(conversationIdValue, 'WORKFLOW_CONVERSATION_ID_REQUIRED');
    return this.repository.transaction(() => {
      const run = this.repository.findRunById(runId);
      if (!run) throw new Error('WORKFLOW_RUN_NOT_FOUND');
      if (run.state === 'running' && run.conversationId === conversationId) return run;
      if (run.state === 'waiting-approval') throw new Error('WORKFLOW_APPROVAL_REQUIRED');
      if (run.state !== 'pending') throw new Error('WORKFLOW_RUN_STATE_INVALID');
      const updated = { ...run, state: 'running' as const, conversationId, startedAt: this.now() };
      this.repository.updateRun(updated);
      return this.repository.findRunById(runId)!;
    });
  }

  completeRun(
    runIdValue: string,
    state: Extract<WorkflowRunState, 'succeeded' | 'failed' | 'skipped' | 'missed'>,
    errorCode?: string
  ): WorkflowRun {
    const runId = normalizeId(runIdValue, 'WORKFLOW_RUN_ID_REQUIRED');
    if (!TERMINAL_STATES.has(state)) throw new Error('WORKFLOW_RUN_STATE_INVALID');
    return this.repository.transaction(() => {
      const run = this.repository.findRunById(runId);
      if (!run) throw new Error('WORKFLOW_RUN_NOT_FOUND');
      if (run.state === state) return run;
      if (run.state !== 'running' && run.state !== 'pending') throw new Error('WORKFLOW_RUN_STATE_INVALID');
      const updated = { ...run, state, errorCode: errorCode?.trim() || null, finishedAt: this.now() };
      this.repository.updateRun(updated);
      return this.repository.findRunById(runId)!;
    });
  }

  listRuns(workflowId?: string): WorkflowRunListResult {
    const normalized = workflowId ? normalizeId(workflowId, 'WORKFLOW_ID_REQUIRED') : undefined;
    const runs = this.repository.listRuns(normalized);
    return { runs, total: runs.length };
  }

  listApprovals(runId: string): WorkflowApproval[] {
    return this.repository.listApprovals(normalizeId(runId, 'WORKFLOW_RUN_ID_REQUIRED'));
  }

  decideApproval(idValue: string, decision: 'approved' | 'rejected'): WorkflowApproval {
    const id = normalizeId(idValue, 'WORKFLOW_APPROVAL_ID_REQUIRED');
    if (!['approved', 'rejected'].includes(decision)) throw new Error('WORKFLOW_APPROVAL_DECISION_INVALID');
    return this.repository.transaction(() => {
      const approval = this.repository.findApprovalById(id);
      if (!approval) throw new Error('WORKFLOW_APPROVAL_NOT_FOUND');
      if (approval.state !== 'pending') return approval;
      const run = this.repository.findRunById(approval.runId);
      if (!run || run.state !== 'waiting-approval') throw new Error('WORKFLOW_RUN_STATE_INVALID');
      const now = this.now();
      const updated: WorkflowApproval = { ...approval, state: decision, decidedAt: now };
      this.repository.updateApproval(updated);
      const approvals = this.repository.listApprovals(run.id);
      if (decision === 'rejected') {
        this.repository.updateRun({
          ...run,
          state: 'skipped',
          errorCode: 'WORKFLOW_APPROVAL_REJECTED',
          finishedAt: now,
        });
      } else if (approvals.every((item) => item.state === 'approved')) {
        this.repository.updateRun({ ...run, state: 'pending' });
      }
      this.repository.insertAudit(
        this.randomUUID(),
        'workflow_approval_decide',
        { workflowId: run.workflowId, runId: run.id, approvalId: id, decision },
        now
      );
      return this.repository.findApprovalById(id)!;
    });
  }

  listGrants(workflowId?: string): WorkflowGrant[] {
    return this.repository.listGrants(workflowId ? normalizeId(workflowId, 'WORKFLOW_ID_REQUIRED') : undefined);
  }

  saveGrant(grant: WorkflowGrant): WorkflowGrant {
    const workflowId = normalizeId(grant.workflowId, 'WORKFLOW_ID_REQUIRED');
    if (!this.repository.findWorkflowById(workflowId)) throw new Error('WORKFLOW_NOT_FOUND');
    const normalized: WorkflowGrant = {
      ...grant,
      id: normalizeId(grant.id, 'WORKFLOW_GRANT_ID_REQUIRED'),
      workflowId,
      resource: normalizeId(grant.resource, 'WORKFLOW_GRANT_RESOURCE_REQUIRED'),
      action: normalizeId(grant.action, 'WORKFLOW_GRANT_ACTION_REQUIRED'),
      constraints: structuredClone(grant.constraints),
    };
    this.repository.upsertGrant(normalized);
    return this.repository.findGrantById(normalized.id)!;
  }

  revokeGrant(idValue: string): void {
    const id = normalizeId(idValue, 'WORKFLOW_GRANT_ID_REQUIRED');
    if (!this.repository.findGrantById(id)) throw new Error('WORKFLOW_GRANT_NOT_FOUND');
    this.repository.revokeGrant(id, this.now());
  }
}

function normalizeId(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function normalizeGrantContext(input: Record<string, unknown>): Record<string, WorkflowGrantConstraintValue> {
  const result: Record<string, WorkflowGrantConstraintValue> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') result[key] = value;
    else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) result[key] = value;
  }
  return result;
}
