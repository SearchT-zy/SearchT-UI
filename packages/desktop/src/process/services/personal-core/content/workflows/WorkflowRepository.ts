import type {
  WorkflowApproval,
  WorkflowDefinition,
  WorkflowGrant,
  WorkflowInstance,
  WorkflowInstanceState,
  WorkflowRun,
  WorkflowRunState,
  WorkflowVersion,
} from '@/common/types/searcht/workflow';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';

type WorkflowRow = {
  id: string;
  operation_id: string;
  template_id: string | null;
  name: string;
  description: string;
  state: WorkflowInstanceState;
  runtime_job_id: string;
  active_version_id: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

type VersionRow = {
  id: string;
  workflow_id: string;
  version_number: number;
  definition_json: string;
  compiled_prompt: string;
  change_summary: string;
  created_at: number;
};

type RunRow = {
  id: string;
  workflow_id: string;
  workflow_version_id: string;
  runtime_run_key: string;
  state: WorkflowRunState;
  input_json: string;
  conversation_id: string | null;
  error_code: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
};

type ApprovalRow = {
  id: string;
  run_id: string;
  resource: string;
  action: string;
  state: WorkflowApproval['state'];
  decided_at: number | null;
  created_at: number;
};

type GrantRow = {
  id: string;
  workflow_id: string;
  resource: string;
  action: string;
  constraints_json: string;
  expires_at: number | null;
  revoked_at: number | null;
  created_at: number;
  last_used_at: number | null;
};

type StoredWorkflow = Omit<WorkflowInstance, 'activeVersionId'> & { activeVersionId: string | null };

export class WorkflowRepository {
  constructor(private readonly driver: ISqliteDriver) {}

  transaction<T>(operation: () => T): T {
    return this.driver.transaction(operation)();
  }

  insertWorkflow(operationId: string, workflow: StoredWorkflow): void {
    this.driver
      .prepare(`INSERT INTO workflow_instances (
        id, operation_id, template_id, name, description, state, runtime_job_id,
        active_version_id, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) `)
      .run(
        workflow.id,
        operationId,
        workflow.templateId,
        workflow.name,
        workflow.description,
        workflow.state,
        workflow.runtimeJobId,
        workflow.activeVersionId,
        workflow.createdAt,
        workflow.updatedAt,
        workflow.deletedAt
      );
  }

  updateWorkflow(workflow: StoredWorkflow): void {
    this.driver
      .prepare(`UPDATE workflow_instances SET template_id = ?, name = ?, description = ?, state = ?,
        runtime_job_id = ?, active_version_id = ?, updated_at = ?, deleted_at = ? WHERE id = ?`)
      .run(
        workflow.templateId,
        workflow.name,
        workflow.description,
        workflow.state,
        workflow.runtimeJobId,
        workflow.activeVersionId,
        workflow.updatedAt,
        workflow.deletedAt,
        workflow.id
      );
  }

  findWorkflowById(id: string): WorkflowInstance | null {
    const row = this.driver.prepare('SELECT * FROM workflow_instances WHERE id = ?').get(id) as WorkflowRow | undefined;
    return row ? mapWorkflow(row) : null;
  }

  findWorkflowByOperationId(operationId: string): WorkflowInstance | null {
    const row = this.driver.prepare('SELECT * FROM workflow_instances WHERE operation_id = ?').get(operationId) as
      | WorkflowRow
      | undefined;
    return row ? mapWorkflow(row) : null;
  }

  listWorkflows(): WorkflowInstance[] {
    return (
      this.driver
        .prepare("SELECT * FROM workflow_instances WHERE state <> 'deleted' ORDER BY updated_at DESC, id")
        .all() as WorkflowRow[]
    ).map(mapWorkflow);
  }

  listDeletedWorkflows(): WorkflowInstance[] {
    return (
      this.driver
        .prepare("SELECT * FROM workflow_instances WHERE state = 'deleted' ORDER BY deleted_at DESC, id")
        .all() as WorkflowRow[]
    ).map(mapWorkflow);
  }

  insertVersion(version: WorkflowVersion): void {
    this.driver
      .prepare(`INSERT INTO workflow_versions (
        id, workflow_id, version_number, definition_json, compiled_prompt, change_summary, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?) `)
      .run(
        version.id,
        version.workflowId,
        version.versionNumber,
        JSON.stringify(version.definition),
        version.compiledPrompt,
        version.changeSummary,
        version.createdAt
      );
  }

  findVersionById(id: string): WorkflowVersion | null {
    const row = this.driver.prepare('SELECT * FROM workflow_versions WHERE id = ?').get(id) as VersionRow | undefined;
    return row ? mapVersion(row) : null;
  }

  listVersions(workflowId: string): WorkflowVersion[] {
    return (
      this.driver
        .prepare('SELECT * FROM workflow_versions WHERE workflow_id = ? ORDER BY version_number DESC, id')
        .all(workflowId) as VersionRow[]
    ).map(mapVersion);
  }

  nextVersionNumber(workflowId: string): number {
    return (
      this.driver
        .prepare('SELECT COALESCE(MAX(version_number), 0) + 1 AS value FROM workflow_versions WHERE workflow_id = ?')
        .get(workflowId) as { value: number }
    ).value;
  }

  insertRun(run: WorkflowRun): void {
    this.driver
      .prepare(`INSERT INTO workflow_runs (
        id, workflow_id, workflow_version_id, runtime_run_key, state, input_json,
        conversation_id, error_code, created_at, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) `)
      .run(
        run.id,
        run.workflowId,
        run.workflowVersionId,
        run.runtimeRunKey,
        run.state,
        JSON.stringify(run.inputSnapshot),
        run.conversationId,
        run.errorCode,
        run.createdAt,
        run.startedAt,
        run.finishedAt
      );
  }

  updateRun(run: WorkflowRun): void {
    this.driver
      .prepare(`UPDATE workflow_runs SET state = ?, conversation_id = ?, error_code = ?,
        started_at = ?, finished_at = ? WHERE id = ?`)
      .run(run.state, run.conversationId, run.errorCode, run.startedAt, run.finishedAt, run.id);
  }

  findRunById(id: string): WorkflowRun | null {
    const row = this.driver.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id) as RunRow | undefined;
    return row ? mapRun(row) : null;
  }

  findRunByRuntimeKey(workflowId: string, key: string): WorkflowRun | null {
    const row = this.driver
      .prepare('SELECT * FROM workflow_runs WHERE workflow_id = ? AND runtime_run_key = ?')
      .get(workflowId, key) as RunRow | undefined;
    return row ? mapRun(row) : null;
  }

  listRuns(workflowId?: string): WorkflowRun[] {
    const rows = workflowId
      ? (this.driver
          .prepare('SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY created_at DESC, id')
          .all(workflowId) as RunRow[])
      : (this.driver.prepare('SELECT * FROM workflow_runs ORDER BY created_at DESC, id').all() as RunRow[]);
    return rows.map(mapRun);
  }

  insertApproval(approval: WorkflowApproval): void {
    this.driver
      .prepare(`INSERT INTO workflow_approvals (
        id, run_id, resource, action, state, decided_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?) `)
      .run(
        approval.id,
        approval.runId,
        approval.resource,
        approval.action,
        approval.state,
        approval.decidedAt,
        approval.createdAt
      );
  }

  listApprovals(runId: string): WorkflowApproval[] {
    return (
      this.driver
        .prepare('SELECT * FROM workflow_approvals WHERE run_id = ? ORDER BY created_at, id')
        .all(runId) as ApprovalRow[]
    ).map(mapApproval);
  }

  findApprovalById(id: string): WorkflowApproval | null {
    const row = this.driver.prepare('SELECT * FROM workflow_approvals WHERE id = ?').get(id) as ApprovalRow | undefined;
    return row ? mapApproval(row) : null;
  }

  updateApproval(approval: WorkflowApproval): void {
    this.driver
      .prepare('UPDATE workflow_approvals SET state = ?, decided_at = ? WHERE id = ?')
      .run(approval.state, approval.decidedAt, approval.id);
  }

  upsertGrant(grant: WorkflowGrant): void {
    this.driver
      .prepare(`INSERT INTO workflow_grants (
        id, workflow_id, resource, action, constraints_json, expires_at, revoked_at, created_at, last_used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET resource = excluded.resource, action = excluded.action,
        constraints_json = excluded.constraints_json, expires_at = excluded.expires_at,
        revoked_at = excluded.revoked_at, last_used_at = excluded.last_used_at`)
      .run(
        grant.id,
        grant.workflowId,
        grant.resource,
        grant.action,
        JSON.stringify(grant.constraints),
        grant.expiresAt,
        grant.revokedAt,
        grant.createdAt,
        grant.lastUsedAt
      );
  }

  findGrantById(id: string): WorkflowGrant | null {
    const row = this.driver.prepare('SELECT * FROM workflow_grants WHERE id = ?').get(id) as GrantRow | undefined;
    return row ? mapGrant(row) : null;
  }

  listGrants(workflowId?: string): WorkflowGrant[] {
    const rows = workflowId
      ? (this.driver
          .prepare('SELECT * FROM workflow_grants WHERE workflow_id = ? ORDER BY created_at DESC, id')
          .all(workflowId) as GrantRow[])
      : (this.driver.prepare('SELECT * FROM workflow_grants ORDER BY created_at DESC, id').all() as GrantRow[]);
    return rows.map(mapGrant);
  }

  revokeGrant(id: string, now: number): void {
    this.driver.prepare('UPDATE workflow_grants SET revoked_at = ? WHERE id = ?').run(now, id);
  }

  insertAudit(id: string, action: string, detail: Record<string, unknown>, now: number): void {
    this.driver
      .prepare('INSERT INTO personal_audit_log (id, action, outcome, detail_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, action, 'success', JSON.stringify(detail), now);
  }
}

function mapWorkflow(row: WorkflowRow): WorkflowInstance {
  if (!row.active_version_id) throw new Error('WORKFLOW_ACTIVE_VERSION_REQUIRED');
  return {
    id: row.id,
    templateId: row.template_id,
    name: row.name,
    description: row.description,
    state: row.state,
    runtimeJobId: row.runtime_job_id,
    activeVersionId: row.active_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function mapVersion(row: VersionRow): WorkflowVersion {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    versionNumber: row.version_number,
    definition: parseJson<WorkflowDefinition>(row.definition_json, 'WORKFLOW_DEFINITION_CORRUPT'),
    compiledPrompt: row.compiled_prompt,
    changeSummary: row.change_summary,
    createdAt: row.created_at,
  };
}

function mapRun(row: RunRow): WorkflowRun {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowVersionId: row.workflow_version_id,
    runtimeRunKey: row.runtime_run_key,
    state: row.state,
    inputSnapshot: parseJson<Record<string, unknown>>(row.input_json, 'WORKFLOW_INPUT_CORRUPT'),
    conversationId: row.conversation_id,
    errorCode: row.error_code,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function mapApproval(row: ApprovalRow): WorkflowApproval {
  return {
    id: row.id,
    runId: row.run_id,
    resource: row.resource,
    action: row.action,
    state: row.state,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

function mapGrant(row: GrantRow): WorkflowGrant {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    resource: row.resource,
    action: row.action,
    constraints: parseJson<WorkflowGrant['constraints']>(row.constraints_json, 'WORKFLOW_GRANT_CORRUPT'),
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

function parseJson<T>(value: string, code: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(code);
  }
}
