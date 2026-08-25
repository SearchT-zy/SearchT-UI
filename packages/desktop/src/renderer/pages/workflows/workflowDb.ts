import type {
  WorkflowApproval,
  WorkflowClient,
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
import {
  openPersonalWebDatabase,
  PERSONAL_WEB_DATABASE_NAME,
  PERSONAL_WEB_STORE_NAMES,
  requestResult,
  transactionDone,
} from '@renderer/pages/personal/personalDbSchema';

type WorkflowAuditRecord = {
  id: string;
  action: string;
  detail: Record<string, unknown>;
  createdAt: number;
};

type StoredWorkflow = WorkflowInstance & { operationId: string };

export type OpenWorkflowDatabaseOptions = {
  name?: string;
  factory?: IDBFactory;
  now?: () => number;
  randomUUID?: () => string;
};

const TERMINAL_STATES = new Set<WorkflowRunState>(['succeeded', 'failed', 'skipped', 'missed']);

export class WorkflowDatabase implements WorkflowClient {
  constructor(
    private readonly database: IDBDatabase,
    private readonly now: () => number,
    private readonly randomUUID: () => string
  ) {}

  close(): void {
    this.database.close();
  }

  async list(): Promise<WorkflowListResult> {
    const workflows = (await this.getAll<StoredWorkflow>(PERSONAL_WEB_STORE_NAMES.workflowInstances))
      .filter((workflow) => workflow.state !== 'deleted')
      .toSorted((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
      .map(stripOperationId);
    return { workflows, total: workflows.length };
  }

  async listDeleted(): Promise<WorkflowListResult> {
    const workflows = (await this.getAll<StoredWorkflow>(PERSONAL_WEB_STORE_NAMES.workflowInstances))
      .filter((workflow) => workflow.state === 'deleted')
      .toSorted((left, right) => (right.deletedAt ?? 0) - (left.deletedAt ?? 0) || left.id.localeCompare(right.id))
      .map(stripOperationId);
    return { workflows, total: workflows.length };
  }

  async get(id: string): Promise<WorkflowInstance | null> {
    const workflow = await this.getById<StoredWorkflow>(
      PERSONAL_WEB_STORE_NAMES.workflowInstances,
      normalizeId(id, 'WORKFLOW_ID_REQUIRED')
    );
    return workflow ? stripOperationId(workflow) : null;
  }

  async install(input: WorkflowInstallInput): Promise<{ workflow: WorkflowInstance; version: WorkflowVersion }> {
    const operationId = normalizeId(input.operationId, 'WORKFLOW_OPERATION_ID_REQUIRED');
    const runtimeJobId = normalizeId(input.runtimeJobId, 'WORKFLOW_RUNTIME_JOB_ID_REQUIRED');
    const report = validateWorkflowDefinition(input.definition);
    if (!report.valid || !report.definition) throw new Error(report.issues[0]?.code || 'WORKFLOW_INVALID');
    const compiledPrompt = compileWorkflowPrompt(report.definition);
    if (compiledPrompt !== input.compiledPrompt) throw new Error('WORKFLOW_COMPILED_PROMPT_MISMATCH');

    const transaction = this.database.transaction(
      [
        PERSONAL_WEB_STORE_NAMES.workflowInstances,
        PERSONAL_WEB_STORE_NAMES.workflowVersions,
        PERSONAL_WEB_STORE_NAMES.workflowAudit,
      ],
      'readwrite'
    );
    const done = transactionDone(transaction);
    try {
      const workflowStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.workflowInstances);
      const versionStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.workflowVersions);
      const existing = await requestResult<StoredWorkflow | undefined>(
        workflowStore.index('operationId').get(operationId)
      );
      if (existing) {
        const version = await requestResult<WorkflowVersion | undefined>(versionStore.get(existing.activeVersionId));
        if (!version) throw new Error('WORKFLOW_VERSION_NOT_FOUND');
        await done;
        return { workflow: stripOperationId(existing), version };
      }

      const now = this.now();
      const workflowId = this.randomUUID();
      const version: WorkflowVersion = {
        id: this.randomUUID(),
        workflowId,
        versionNumber: 1,
        definition: report.definition,
        compiledPrompt,
        changeSummary: input.changeSummary.trim(),
        createdAt: now,
      };
      const workflow: StoredWorkflow = {
        id: workflowId,
        operationId,
        templateId: input.templateId?.trim() || null,
        name: report.definition.name,
        description: report.definition.description,
        state: 'active',
        runtimeJobId,
        activeVersionId: version.id,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      workflowStore.add(workflow);
      versionStore.add(version);
      this.addAudit(transaction, 'workflow_install', { workflowId, versionId: version.id, runtimeJobId }, now);
      await done;
      return { workflow: stripOperationId(workflow), version };
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  async listVersions(workflowId: string): Promise<WorkflowVersion[]> {
    const transaction = this.database.transaction(PERSONAL_WEB_STORE_NAMES.workflowVersions, 'readonly');
    const done = transactionDone(transaction);
    const versions = await requestResult<WorkflowVersion[]>(
      transaction
        .objectStore(PERSONAL_WEB_STORE_NAMES.workflowVersions)
        .index('workflowId')
        .getAll(normalizeId(workflowId, 'WORKFLOW_ID_REQUIRED'))
    );
    await done;
    return versions.toSorted(
      (left, right) => right.versionNumber - left.versionNumber || left.id.localeCompare(right.id)
    );
  }

  async createVersion(input: WorkflowVersionCreateInput): Promise<WorkflowVersion> {
    const workflowId = normalizeId(input.workflowId, 'WORKFLOW_ID_REQUIRED');
    const report = validateWorkflowDefinition(input.definition);
    if (!report.valid || !report.definition) throw new Error(report.issues[0]?.code || 'WORKFLOW_INVALID');
    const compiledPrompt = compileWorkflowPrompt(report.definition);
    if (compiledPrompt !== input.compiledPrompt) throw new Error('WORKFLOW_COMPILED_PROMPT_MISMATCH');
    const transaction = this.database.transaction(
      [
        PERSONAL_WEB_STORE_NAMES.workflowInstances,
        PERSONAL_WEB_STORE_NAMES.workflowVersions,
        PERSONAL_WEB_STORE_NAMES.workflowAudit,
      ],
      'readwrite'
    );
    const done = transactionDone(transaction);
    try {
      const workflowStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.workflowInstances);
      const versionStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.workflowVersions);
      const workflow = await requestResult<StoredWorkflow | undefined>(workflowStore.get(workflowId));
      if (!workflow || workflow.state === 'deleted') throw new Error('WORKFLOW_NOT_FOUND');
      const versions = await requestResult<WorkflowVersion[]>(versionStore.index('workflowId').getAll(workflowId));
      const now = this.now();
      const version: WorkflowVersion = {
        id: this.randomUUID(),
        workflowId,
        versionNumber: Math.max(0, ...versions.map((item) => item.versionNumber)) + 1,
        definition: report.definition,
        compiledPrompt,
        changeSummary: input.changeSummary.trim(),
        createdAt: now,
      };
      versionStore.add(version);
      workflowStore.put({
        ...workflow,
        name: report.definition.name,
        description: report.definition.description,
        activeVersionId: version.id,
        updatedAt: now,
      });
      this.addAudit(transaction, 'workflow_version_create', { workflowId, versionId: version.id }, now);
      await done;
      return version;
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  async setState(id: string, state: Exclude<WorkflowInstanceState, 'deleted'>): Promise<WorkflowInstance> {
    if (!['active', 'disabled', 'needs-repair'].includes(state)) throw new Error('WORKFLOW_STATE_INVALID');
    const workflowId = normalizeId(id, 'WORKFLOW_ID_REQUIRED');
    const transaction = this.database.transaction(PERSONAL_WEB_STORE_NAMES.workflowInstances, 'readwrite');
    const done = transactionDone(transaction);
    try {
      const store = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.workflowInstances);
      const current = await requestResult<StoredWorkflow | undefined>(store.get(workflowId));
      if (!current) throw new Error('WORKFLOW_NOT_FOUND');
      const updated = { ...current, state, updatedAt: this.now() };
      store.put(updated);
      await done;
      return stripOperationId(updated);
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  async rebindRuntimeJob(idValue: string, runtimeJobIdValue: string): Promise<WorkflowInstance> {
    const id = normalizeId(idValue, 'WORKFLOW_ID_REQUIRED');
    const runtimeJobId = normalizeId(runtimeJobIdValue, 'WORKFLOW_RUNTIME_JOB_ID_REQUIRED');
    const transaction = this.database.transaction(
      [PERSONAL_WEB_STORE_NAMES.workflowInstances, PERSONAL_WEB_STORE_NAMES.workflowAudit],
      'readwrite'
    );
    const done = transactionDone(transaction);
    try {
      const store = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.workflowInstances);
      const workflow = await requestResult<StoredWorkflow | undefined>(store.get(id));
      if (!workflow) throw new Error('WORKFLOW_NOT_FOUND');
      const now = this.now();
      const updated: StoredWorkflow = { ...workflow, runtimeJobId, state: 'active', updatedAt: now };
      store.put(updated);
      this.addAudit(transaction, 'workflow_runtime_rebind', { workflowId: id, runtimeJobId }, now);
      await done;
      return stripOperationId(updated);
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  async remove(idValue: string): Promise<WorkflowInstance> {
    return this.updateWorkflowLifecycle(idValue, 'remove');
  }

  async restore(idValue: string): Promise<WorkflowInstance> {
    return this.updateWorkflowLifecycle(idValue, 'restore');
  }

  async startRun(
    workflowIdValue: string,
    runtimeRunKeyValue: string,
    input: Record<string, unknown>
  ): Promise<WorkflowRun> {
    const workflowId = normalizeId(workflowIdValue, 'WORKFLOW_ID_REQUIRED');
    const runtimeRunKey = normalizeId(runtimeRunKeyValue, 'WORKFLOW_RUNTIME_RUN_KEY_REQUIRED');
    const transaction = this.database.transaction(
      [
        PERSONAL_WEB_STORE_NAMES.workflowInstances,
        PERSONAL_WEB_STORE_NAMES.workflowVersions,
        PERSONAL_WEB_STORE_NAMES.workflowRuns,
        PERSONAL_WEB_STORE_NAMES.workflowApprovals,
        PERSONAL_WEB_STORE_NAMES.workflowGrants,
        PERSONAL_WEB_STORE_NAMES.workflowAudit,
      ],
      'readwrite'
    );
    const done = transactionDone(transaction);
    try {
      const runStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.workflowRuns);
      const existing = await requestResult<WorkflowRun | undefined>(
        runStore.index('workflowRun').get([workflowId, runtimeRunKey])
      );
      if (existing) {
        await done;
        return existing;
      }
      const workflow = await requestResult<StoredWorkflow | undefined>(
        transaction.objectStore(PERSONAL_WEB_STORE_NAMES.workflowInstances).get(workflowId)
      );
      if (!workflow) throw new Error('WORKFLOW_NOT_FOUND');
      if (workflow.state !== 'active') throw new Error('WORKFLOW_NOT_ACTIVE');
      const version = await requestResult<WorkflowVersion | undefined>(
        transaction.objectStore(PERSONAL_WEB_STORE_NAMES.workflowVersions).get(workflow.activeVersionId)
      );
      if (!version) throw new Error('WORKFLOW_VERSION_NOT_FOUND');
      const grants = await requestResult<WorkflowGrant[]>(
        transaction.objectStore(PERSONAL_WEB_STORE_NAMES.workflowGrants).index('workflowId').getAll(workflowId)
      );
      const now = this.now();
      const context = normalizeGrantContext(input);
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
      runStore.add(run);
      const approvalStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.workflowApprovals);
      for (const action of missingActions) {
        approvalStore.add({
          id: this.randomUUID(),
          runId: run.id,
          resource: action.resource,
          action: action.action,
          state: 'pending',
          decidedAt: null,
          createdAt: now,
        } satisfies WorkflowApproval);
      }
      this.addAudit(transaction, 'workflow_run_start', { workflowId, runId: run.id, state: run.state }, now);
      await done;
      return run;
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  async markRunDispatched(runIdValue: string, conversationIdValue: string): Promise<WorkflowRun> {
    const runId = normalizeId(runIdValue, 'WORKFLOW_RUN_ID_REQUIRED');
    const conversationId = normalizeId(conversationIdValue, 'WORKFLOW_CONVERSATION_ID_REQUIRED');
    return this.updateRun(runId, (run) => {
      if (run.state === 'running' && run.conversationId === conversationId) return run;
      if (run.state === 'waiting-approval') throw new Error('WORKFLOW_APPROVAL_REQUIRED');
      if (run.state !== 'pending') throw new Error('WORKFLOW_RUN_STATE_INVALID');
      return { ...run, state: 'running', conversationId, startedAt: this.now() };
    });
  }

  async completeRun(
    runIdValue: string,
    state: Extract<WorkflowRunState, 'succeeded' | 'failed' | 'skipped' | 'missed'>,
    errorCode?: string
  ): Promise<WorkflowRun> {
    if (!TERMINAL_STATES.has(state)) throw new Error('WORKFLOW_RUN_STATE_INVALID');
    return this.updateRun(normalizeId(runIdValue, 'WORKFLOW_RUN_ID_REQUIRED'), (run) => {
      if (run.state === state) return run;
      if (run.state !== 'running' && run.state !== 'pending') throw new Error('WORKFLOW_RUN_STATE_INVALID');
      return { ...run, state, errorCode: errorCode?.trim() || null, finishedAt: this.now() };
    });
  }

  async listRuns(workflowId?: string): Promise<WorkflowRunListResult> {
    const runs = workflowId
      ? await this.getAllByIndex<WorkflowRun>(
          PERSONAL_WEB_STORE_NAMES.workflowRuns,
          'workflowId',
          normalizeId(workflowId, 'WORKFLOW_ID_REQUIRED')
        )
      : await this.getAll<WorkflowRun>(PERSONAL_WEB_STORE_NAMES.workflowRuns);
    const sorted = runs.toSorted((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id));
    return { runs: sorted, total: sorted.length };
  }

  async listApprovals(runId: string): Promise<WorkflowApproval[]> {
    return this.getAllByIndex(
      PERSONAL_WEB_STORE_NAMES.workflowApprovals,
      'runId',
      normalizeId(runId, 'WORKFLOW_RUN_ID_REQUIRED')
    );
  }

  async decideApproval(idValue: string, decision: 'approved' | 'rejected'): Promise<WorkflowApproval> {
    const id = normalizeId(idValue, 'WORKFLOW_APPROVAL_ID_REQUIRED');
    if (!['approved', 'rejected'].includes(decision)) throw new Error('WORKFLOW_APPROVAL_DECISION_INVALID');
    const transaction = this.database.transaction(
      [
        PERSONAL_WEB_STORE_NAMES.workflowApprovals,
        PERSONAL_WEB_STORE_NAMES.workflowRuns,
        PERSONAL_WEB_STORE_NAMES.workflowAudit,
      ],
      'readwrite'
    );
    const done = transactionDone(transaction);
    try {
      const approvalStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.workflowApprovals);
      const runStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.workflowRuns);
      const approval = await requestResult<WorkflowApproval | undefined>(approvalStore.get(id));
      if (!approval) throw new Error('WORKFLOW_APPROVAL_NOT_FOUND');
      if (approval.state !== 'pending') {
        await done;
        return approval;
      }
      const run = await requestResult<WorkflowRun | undefined>(runStore.get(approval.runId));
      if (!run || run.state !== 'waiting-approval') throw new Error('WORKFLOW_RUN_STATE_INVALID');
      const now = this.now();
      const updated: WorkflowApproval = { ...approval, state: decision, decidedAt: now };
      approvalStore.put(updated);
      const approvals = (await requestResult<WorkflowApproval[]>(approvalStore.index('runId').getAll(run.id))).map(
        (item) => (item.id === id ? updated : item)
      );
      if (decision === 'rejected') {
        runStore.put({ ...run, state: 'skipped', errorCode: 'WORKFLOW_APPROVAL_REJECTED', finishedAt: now });
      } else if (approvals.every((item) => item.state === 'approved')) {
        runStore.put({ ...run, state: 'pending' });
      }
      this.addAudit(
        transaction,
        'workflow_approval_decide',
        { workflowId: run.workflowId, runId: run.id, approvalId: id, decision },
        now
      );
      await done;
      return updated;
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  async listGrants(workflowId?: string): Promise<WorkflowGrant[]> {
    return workflowId
      ? this.getAllByIndex(
          PERSONAL_WEB_STORE_NAMES.workflowGrants,
          'workflowId',
          normalizeId(workflowId, 'WORKFLOW_ID_REQUIRED')
        )
      : this.getAll(PERSONAL_WEB_STORE_NAMES.workflowGrants);
  }

  async saveGrant(grant: WorkflowGrant): Promise<WorkflowGrant> {
    if (!(await this.get(grant.workflowId))) throw new Error('WORKFLOW_NOT_FOUND');
    const normalized = {
      ...grant,
      id: normalizeId(grant.id, 'WORKFLOW_GRANT_ID_REQUIRED'),
      workflowId: normalizeId(grant.workflowId, 'WORKFLOW_ID_REQUIRED'),
      resource: normalizeId(grant.resource, 'WORKFLOW_GRANT_RESOURCE_REQUIRED'),
      action: normalizeId(grant.action, 'WORKFLOW_GRANT_ACTION_REQUIRED'),
      constraints: structuredClone(grant.constraints),
    };
    const transaction = this.database.transaction(PERSONAL_WEB_STORE_NAMES.workflowGrants, 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(PERSONAL_WEB_STORE_NAMES.workflowGrants).put(normalized);
    await done;
    return normalized;
  }

  async revokeGrant(idValue: string): Promise<void> {
    const id = normalizeId(idValue, 'WORKFLOW_GRANT_ID_REQUIRED');
    const transaction = this.database.transaction(PERSONAL_WEB_STORE_NAMES.workflowGrants, 'readwrite');
    const done = transactionDone(transaction);
    try {
      const store = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.workflowGrants);
      const grant = await requestResult<WorkflowGrant | undefined>(store.get(id));
      if (!grant) throw new Error('WORKFLOW_GRANT_NOT_FOUND');
      store.put({ ...grant, revokedAt: this.now() });
      await done;
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  private async updateRun(runId: string, update: (run: WorkflowRun) => WorkflowRun): Promise<WorkflowRun> {
    const transaction = this.database.transaction(PERSONAL_WEB_STORE_NAMES.workflowRuns, 'readwrite');
    const done = transactionDone(transaction);
    try {
      const store = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.workflowRuns);
      const run = await requestResult<WorkflowRun | undefined>(store.get(runId));
      if (!run) throw new Error('WORKFLOW_RUN_NOT_FOUND');
      const updated = update(run);
      store.put(updated);
      await done;
      return updated;
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  private async updateWorkflowLifecycle(idValue: string, action: 'remove' | 'restore'): Promise<WorkflowInstance> {
    const id = normalizeId(idValue, 'WORKFLOW_ID_REQUIRED');
    const transaction = this.database.transaction(
      [PERSONAL_WEB_STORE_NAMES.workflowInstances, PERSONAL_WEB_STORE_NAMES.workflowAudit],
      'readwrite'
    );
    const done = transactionDone(transaction);
    try {
      const store = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.workflowInstances);
      const workflow = await requestResult<StoredWorkflow | undefined>(store.get(id));
      if (!workflow) throw new Error('WORKFLOW_NOT_FOUND');
      if (
        (action === 'remove' && workflow.state === 'deleted') ||
        (action === 'restore' && workflow.state !== 'deleted')
      ) {
        await done;
        return stripOperationId(workflow);
      }
      const now = this.now();
      const updated: StoredWorkflow =
        action === 'remove'
          ? { ...workflow, state: 'deleted', deletedAt: now, updatedAt: now }
          : { ...workflow, state: 'disabled', deletedAt: null, updatedAt: now };
      store.put(updated);
      this.addAudit(transaction, `workflow_${action}`, { workflowId: id }, now);
      await done;
      return stripOperationId(updated);
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  private addAudit(
    transaction: IDBTransaction,
    action: string,
    detail: Record<string, unknown>,
    createdAt: number
  ): void {
    transaction.objectStore(PERSONAL_WEB_STORE_NAMES.workflowAudit).add({
      id: this.randomUUID(),
      action,
      detail,
      createdAt,
    } satisfies WorkflowAuditRecord);
  }

  private async getById<T>(storeName: string, id: string): Promise<T | null> {
    const transaction = this.database.transaction(storeName, 'readonly');
    const done = transactionDone(transaction);
    const value = await requestResult<T | undefined>(transaction.objectStore(storeName).get(id));
    await done;
    return value ?? null;
  }

  private async getAll<T>(storeName: string): Promise<T[]> {
    const transaction = this.database.transaction(storeName, 'readonly');
    const done = transactionDone(transaction);
    const values = await requestResult<T[]>(transaction.objectStore(storeName).getAll());
    await done;
    return values;
  }

  private async getAllByIndex<T>(storeName: string, index: string, value: IDBValidKey): Promise<T[]> {
    const transaction = this.database.transaction(storeName, 'readonly');
    const done = transactionDone(transaction);
    const values = await requestResult<T[]>(transaction.objectStore(storeName).index(index).getAll(value));
    await done;
    return values;
  }
}

export async function openWorkflowDatabase(options: OpenWorkflowDatabaseOptions = {}): Promise<WorkflowDatabase> {
  const factory = options.factory ?? globalThis.indexedDB;
  if (!factory) throw new Error('WORKFLOW_INDEXEDDB_UNAVAILABLE');
  const database = await openPersonalWebDatabase(factory, options.name ?? PERSONAL_WEB_DATABASE_NAME);
  return new WorkflowDatabase(
    database,
    options.now ?? Date.now,
    options.randomUUID ?? (() => globalThis.crypto.randomUUID())
  );
}

function stripOperationId(workflow: StoredWorkflow): WorkflowInstance {
  const { operationId: _operationId, ...value } = workflow;
  return value;
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

async function abortTransaction(transaction: IDBTransaction, done: Promise<void>): Promise<void> {
  try {
    transaction.abort();
  } catch {
    // A failed request may already have aborted or completed the transaction.
  }
  await done.catch((): undefined => undefined);
}
