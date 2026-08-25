import { ipcBridge } from '@/common';
import type {
  WorkflowGrant,
  WorkflowInstallInput,
  WorkflowInstanceState,
  WorkflowRunState,
} from '@/common/types/searcht/workflow';
import { getPersonalDatabase } from '@process/services/personal-core';
import { WorkflowService } from '@process/services/personal-core/content/workflows/WorkflowService';

type WorkflowServiceContract = Pick<
  WorkflowService,
  | 'list'
  | 'listDeleted'
  | 'get'
  | 'install'
  | 'listVersions'
  | 'createVersion'
  | 'setState'
  | 'rebindRuntimeJob'
  | 'remove'
  | 'restore'
  | 'startRun'
  | 'markRunDispatched'
  | 'completeRun'
  | 'listRuns'
  | 'listApprovals'
  | 'decideApproval'
  | 'listGrants'
  | 'saveGrant'
  | 'revokeGrant'
>;

export type WorkflowBridgeDependencies = { service: WorkflowServiceContract };

export function initWorkflowBridge(dependencies?: WorkflowBridgeDependencies) {
  const getService = (): WorkflowServiceContract =>
    dependencies?.service ?? new WorkflowService(getPersonalDatabase().driver);
  const handlers = {
    list: async () => getService().list(),
    listDeleted: async () => getService().listDeleted(),
    get: async (id: string) => getService().get(id),
    install: async (input: WorkflowInstallInput) => getService().install(input),
    listVersions: async (workflowId: string) => getService().listVersions(workflowId),
    createVersion: async (input: import('@/common/types/searcht/workflow').WorkflowVersionCreateInput) =>
      getService().createVersion(input),
    setState: async (id: string, state: Exclude<WorkflowInstanceState, 'deleted'>) => getService().setState(id, state),
    rebindRuntimeJob: async (id: string, runtimeJobId: string) => getService().rebindRuntimeJob(id, runtimeJobId),
    remove: async (id: string) => getService().remove(id),
    restore: async (id: string) => getService().restore(id),
    startRun: async (workflowId: string, runtimeRunKey: string, input: Record<string, unknown>) =>
      getService().startRun(workflowId, runtimeRunKey, input),
    markRunDispatched: async (runId: string, conversationId: string) =>
      getService().markRunDispatched(runId, conversationId),
    completeRun: async (
      runId: string,
      state: Extract<WorkflowRunState, 'succeeded' | 'failed' | 'skipped' | 'missed'>,
      errorCode?: string
    ) => getService().completeRun(runId, state, errorCode),
    listRuns: async (workflowId?: string) => getService().listRuns(workflowId),
    listApprovals: async (runId: string) => getService().listApprovals(runId),
    decideApproval: async (id: string, decision: 'approved' | 'rejected') => getService().decideApproval(id, decision),
    listGrants: async (workflowId?: string) => getService().listGrants(workflowId),
    saveGrant: async (grant: WorkflowGrant) => getService().saveGrant(grant),
    revokeGrant: async (id: string) => getService().revokeGrant(id),
  };

  ipcBridge.workflow.list.provider(handlers.list);
  ipcBridge.workflow.listDeleted.provider(handlers.listDeleted);
  ipcBridge.workflow.get.provider(({ id }) => handlers.get(id));
  ipcBridge.workflow.install.provider(handlers.install);
  ipcBridge.workflow.listVersions.provider(({ workflowId }) => handlers.listVersions(workflowId));
  ipcBridge.workflow.createVersion.provider(handlers.createVersion);
  ipcBridge.workflow.setState.provider(({ id, state }) => handlers.setState(id, state));
  ipcBridge.workflow.rebindRuntimeJob.provider(({ id, runtimeJobId }) => handlers.rebindRuntimeJob(id, runtimeJobId));
  ipcBridge.workflow.remove.provider(({ id }) => handlers.remove(id));
  ipcBridge.workflow.restore.provider(({ id }) => handlers.restore(id));
  ipcBridge.workflow.startRun.provider(({ workflowId, runtimeRunKey, input }) =>
    handlers.startRun(workflowId, runtimeRunKey, input)
  );
  ipcBridge.workflow.markRunDispatched.provider(({ runId, conversationId }) =>
    handlers.markRunDispatched(runId, conversationId)
  );
  ipcBridge.workflow.completeRun.provider(({ runId, state, errorCode }) =>
    handlers.completeRun(runId, state, errorCode)
  );
  ipcBridge.workflow.listRuns.provider(({ workflowId }) => handlers.listRuns(workflowId));
  ipcBridge.workflow.listApprovals.provider(({ runId }) => handlers.listApprovals(runId));
  ipcBridge.workflow.decideApproval.provider(({ id, decision }) => handlers.decideApproval(id, decision));
  ipcBridge.workflow.listGrants.provider(({ workflowId }) => handlers.listGrants(workflowId));
  ipcBridge.workflow.saveGrant.provider(handlers.saveGrant);
  ipcBridge.workflow.revokeGrant.provider(({ id }) => handlers.revokeGrant(id));
  return handlers;
}
