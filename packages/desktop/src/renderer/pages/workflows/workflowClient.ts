import { ipcBridge } from '@/common';
import type { WorkflowClient } from '@/common/types/searcht/workflow';
import { isElectronDesktop } from '@renderer/utils/platform';
import { openWorkflowDatabase, type WorkflowDatabase } from './workflowDb';

export function createElectronWorkflowClient(): WorkflowClient {
  return {
    list: () => ipcBridge.workflow.list.invoke(),
    listDeleted: () => ipcBridge.workflow.listDeleted.invoke(),
    get: (id) => ipcBridge.workflow.get.invoke({ id }),
    install: (input) => ipcBridge.workflow.install.invoke(input),
    listVersions: (workflowId) => ipcBridge.workflow.listVersions.invoke({ workflowId }),
    createVersion: (input) => ipcBridge.workflow.createVersion.invoke(input),
    setState: (id, state) => ipcBridge.workflow.setState.invoke({ id, state }),
    rebindRuntimeJob: (id, runtimeJobId) => ipcBridge.workflow.rebindRuntimeJob.invoke({ id, runtimeJobId }),
    remove: (id) => ipcBridge.workflow.remove.invoke({ id }),
    restore: (id) => ipcBridge.workflow.restore.invoke({ id }),
    startRun: (workflowId, runtimeRunKey, input) =>
      ipcBridge.workflow.startRun.invoke({ workflowId, runtimeRunKey, input }),
    markRunDispatched: (runId, conversationId) =>
      ipcBridge.workflow.markRunDispatched.invoke({ runId, conversationId }),
    completeRun: (runId, state, errorCode) => ipcBridge.workflow.completeRun.invoke({ runId, state, errorCode }),
    listRuns: (workflowId) => ipcBridge.workflow.listRuns.invoke({ workflowId }),
    listApprovals: (runId) => ipcBridge.workflow.listApprovals.invoke({ runId }),
    decideApproval: (id, decision) => ipcBridge.workflow.decideApproval.invoke({ id, decision }),
    listGrants: (workflowId) => ipcBridge.workflow.listGrants.invoke({ workflowId }),
    saveGrant: (grant) => ipcBridge.workflow.saveGrant.invoke(grant),
    revokeGrant: (id) => ipcBridge.workflow.revokeGrant.invoke({ id }),
  };
}

export function createBrowserWorkflowClient(
  database: Promise<WorkflowDatabase> = openWorkflowDatabase()
): WorkflowClient {
  return {
    list: async () => (await database).list(),
    listDeleted: async () => (await database).listDeleted(),
    get: async (id) => (await database).get(id),
    install: async (input) => (await database).install(input),
    listVersions: async (workflowId) => (await database).listVersions(workflowId),
    createVersion: async (input) => (await database).createVersion(input),
    setState: async (id, state) => (await database).setState(id, state),
    rebindRuntimeJob: async (id, runtimeJobId) => (await database).rebindRuntimeJob(id, runtimeJobId),
    remove: async (id) => (await database).remove(id),
    restore: async (id) => (await database).restore(id),
    startRun: async (workflowId, runtimeRunKey, input) => (await database).startRun(workflowId, runtimeRunKey, input),
    markRunDispatched: async (runId, conversationId) => (await database).markRunDispatched(runId, conversationId),
    completeRun: async (runId, state, errorCode) => (await database).completeRun(runId, state, errorCode),
    listRuns: async (workflowId) => (await database).listRuns(workflowId),
    listApprovals: async (runId) => (await database).listApprovals(runId),
    decideApproval: async (id, decision) => (await database).decideApproval(id, decision),
    listGrants: async (workflowId) => (await database).listGrants(workflowId),
    saveGrant: async (grant) => (await database).saveGrant(grant),
    revokeGrant: async (id) => (await database).revokeGrant(id),
  };
}

export const workflowClient: WorkflowClient = isElectronDesktop()
  ? createElectronWorkflowClient()
  : createBrowserWorkflowClient();
