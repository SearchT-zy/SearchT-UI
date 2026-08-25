import type { ICronJob, ICreateCronJobParams } from '@/common/adapter/ipcBridge';
import type {
  WorkflowDefinition,
  WorkflowInstallInput,
  WorkflowInstance,
  WorkflowListResult,
  WorkflowRun,
  WorkflowRunListResult,
  WorkflowRunState,
  WorkflowVersion,
} from '@/common/types/searcht/workflow';
import { compileWorkflowPrompt } from '@/common/searcht/workflows/validation';

export type WorkflowRuntimeClient = {
  install(input: WorkflowInstallInput): Promise<{ workflow: WorkflowInstance; version: WorkflowVersion }>;
  list(): Promise<WorkflowListResult>;
  listVersions(workflowId: string): Promise<WorkflowVersion[]>;
  setState(id: string, state: 'active' | 'disabled' | 'needs-repair'): Promise<WorkflowInstance>;
  rebindRuntimeJob(id: string, runtimeJobId: string): Promise<WorkflowInstance>;
  startRun(workflowId: string, runtimeRunKey: string, input: Record<string, unknown>): Promise<WorkflowRun>;
  markRunDispatched(runId: string, conversationId: string): Promise<WorkflowRun>;
  completeRun(
    runId: string,
    state: Extract<WorkflowRunState, 'succeeded' | 'failed' | 'skipped' | 'missed'>,
    errorCode?: string
  ): Promise<WorkflowRun>;
  listRuns(workflowId?: string): Promise<WorkflowRunListResult>;
};

export type WorkflowCronRuntime = {
  addJob(input: ICreateCronJobParams): Promise<ICronJob>;
  removeJob(jobId: string): Promise<void>;
  runNow(jobId: string): Promise<{ conversation_id: string }>;
  updateJob(jobId: string, enabled: boolean): Promise<ICronJob>;
  listJobs(): Promise<ICronJob[]>;
  getJob(jobId: string): Promise<ICronJob | null>;
};

export type WorkflowExecutedEvent = {
  job_id: string;
  status: 'ok' | 'error' | 'skipped' | 'missed';
  error?: string;
};

export type WorkflowRuntimeDependencies = {
  client: WorkflowRuntimeClient;
  cron: WorkflowCronRuntime;
  randomUUID?: () => string;
};

const TERMINAL_STATES = new Set<WorkflowRunState>(['succeeded', 'failed', 'skipped', 'missed']);

export function createWorkflowRuntime(dependencies: WorkflowRuntimeDependencies) {
  const randomUUID = dependencies.randomUUID ?? (() => globalThis.crypto.randomUUID());

  async function install(definition: WorkflowDefinition, draft: ICreateCronJobParams) {
    const compiledPrompt = compileWorkflowPrompt(definition);
    const job = await dependencies.cron.addJob({ ...draft, name: definition.name, prompt: compiledPrompt });
    try {
      return await dependencies.client.install({
        operationId: randomUUID(),
        templateId: definition.id,
        runtimeJobId: job.id,
        definition,
        compiledPrompt,
        changeSummary: 'Initial version',
      });
    } catch (error) {
      await dependencies.cron.removeJob(job.id).catch((): undefined => undefined);
      throw error;
    }
  }

  async function bindCreatedJob(definition: WorkflowDefinition, job: ICronJob, operationId = randomUUID()) {
    const compiledPrompt = compileWorkflowPrompt(definition);
    try {
      return await dependencies.client.install({
        operationId,
        templateId: definition.id,
        runtimeJobId: job.id,
        definition,
        compiledPrompt,
        changeSummary: 'Initial version',
      });
    } catch (error) {
      await dependencies.cron.removeJob(job.id).catch((): undefined => undefined);
      throw error;
    }
  }

  async function runNow(workflow: WorkflowInstance, input: Record<string, unknown>): Promise<WorkflowRun> {
    const run = await dependencies.client.startRun(workflow.id, randomUUID(), input);
    if (run.state === 'waiting-approval' || TERMINAL_STATES.has(run.state)) return run;
    try {
      const dispatched = await dependencies.cron.runNow(workflow.runtimeJobId);
      return await dependencies.client.markRunDispatched(run.id, dispatched.conversation_id);
    } catch (error) {
      await dependencies.client
        .completeRun(run.id, 'failed', 'WORKFLOW_DISPATCH_FAILED')
        .catch((): undefined => undefined);
      throw error;
    }
  }

  async function resumeRun(workflow: WorkflowInstance, run: WorkflowRun): Promise<WorkflowRun> {
    if (run.state !== 'pending') throw new Error('WORKFLOW_RUN_STATE_INVALID');
    try {
      const dispatched = await dependencies.cron.runNow(workflow.runtimeJobId);
      return await dependencies.client.markRunDispatched(run.id, dispatched.conversation_id);
    } catch (error) {
      await dependencies.client
        .completeRun(run.id, 'failed', 'WORKFLOW_DISPATCH_FAILED')
        .catch((): undefined => undefined);
      throw error;
    }
  }

  async function setEnabled(workflow: WorkflowInstance, enabled: boolean): Promise<WorkflowInstance> {
    await dependencies.cron.updateJob(workflow.runtimeJobId, enabled);
    try {
      return await dependencies.client.setState(workflow.id, enabled ? 'active' : 'disabled');
    } catch (error) {
      await dependencies.cron.updateJob(workflow.runtimeJobId, !enabled).catch((): undefined => undefined);
      throw error;
    }
  }

  async function handleExecuted(event: WorkflowExecutedEvent): Promise<void> {
    const [job, workflows] = await Promise.all([dependencies.cron.getJob(event.job_id), dependencies.client.list()]);
    const workflow = workflows.workflows.find((candidate) => candidate.runtimeJobId === event.job_id);
    if (!job || !workflow || workflow.state !== 'active') return;
    const runtimeRunKey = `cron:${job.id}:${job.state.last_run_at_ms ?? job.state.run_count}`;
    const run = await dependencies.client.startRun(workflow.id, runtimeRunKey, { source: 'schedule' });
    if (TERMINAL_STATES.has(run.state)) return;
    const state = mapExecutionState(event.status);
    await dependencies.client.completeRun(run.id, state, event.error);
  }

  async function reconcile(): Promise<void> {
    const [{ workflows }, jobs] = await Promise.all([dependencies.client.list(), dependencies.cron.listJobs()]);
    const jobsById = new Map(jobs.map((job) => [job.id, job]));
    await Promise.all(
      workflows.map(async (workflow) => {
        const job = jobsById.get(workflow.runtimeJobId);
        if (!job) {
          if (workflow.state !== 'needs-repair') await dependencies.client.setState(workflow.id, 'needs-repair');
          return;
        }
        if (workflow.state === 'needs-repair') {
          await dependencies.client.setState(workflow.id, job.enabled ? 'active' : 'disabled');
        }
        if (job.state.last_status && (job.state.last_run_at_ms || job.state.run_count > 0)) {
          await handleExecuted({ job_id: job.id, status: job.state.last_status, error: job.state.last_error });
        }
      })
    );
  }

  async function repair(workflow: WorkflowInstance, draft: ICreateCronJobParams): Promise<WorkflowInstance> {
    const job = await dependencies.cron.addJob(draft);
    try {
      return await dependencies.client.rebindRuntimeJob(workflow.id, job.id);
    } catch (error) {
      await dependencies.cron.removeJob(job.id).catch((): undefined => undefined);
      throw error;
    }
  }

  return { install, bindCreatedJob, runNow, resumeRun, setEnabled, handleExecuted, reconcile, repair };
}

function mapExecutionState(
  status: WorkflowExecutedEvent['status']
): Extract<WorkflowRunState, 'succeeded' | 'failed' | 'skipped' | 'missed'> {
  if (status === 'ok') return 'succeeded';
  if (status === 'error') return 'failed';
  return status;
}
