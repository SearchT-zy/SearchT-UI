import { ipcBridge } from '@/common';
import type { CollaborationClient } from '@/common/types/searcht/collaboration';
import { isElectronDesktop } from '@renderer/utils/platform';
import { openGroupDatabase, type GroupDatabase } from './groupDb';

type CollaborationProviders = typeof ipcBridge.collaboration;

export function createElectronGroupClient(
  providers: CollaborationProviders = ipcBridge.collaboration
): CollaborationClient {
  return {
    list: (teamId, limit) => providers.list.invoke({ teamId, limit }),
    createInstruction: (input) => providers.createInstruction.invoke(input),
    appendEvent: (input) => providers.appendEvent.invoke(input),
    updateDelivery: (input) => providers.updateDelivery.invoke(input),
    updateDeliveryByRun: (input) => providers.updateDeliveryByRun.invoke(input),
    removeTeam: (teamId) => providers.removeTeam.invoke({ teamId }),
    listMembers: (teamId) => providers.listMembers.invoke({ teamId }),
    createInviteCode: (input) => providers.createInviteCode.invoke(input),
    listInviteCodes: (teamId) => providers.listInviteCodes.invoke({ teamId }),
    revokeInviteCode: (input) => providers.revokeInviteCode.invoke(input),
    joinByInviteCode: (input) => providers.joinByInviteCode.invoke(input),
    removeMember: (input) => providers.removeMember.invoke(input),
  };
}

export function createBrowserGroupClient(database: Promise<GroupDatabase> = openGroupDatabase()): CollaborationClient {
  return {
    list: async (teamId, limit) => (await database).list(teamId, limit),
    createInstruction: async (input) => (await database).createInstruction(input),
    appendEvent: async (input) => (await database).appendEvent(input),
    updateDelivery: async (input) => (await database).updateDelivery(input),
    updateDeliveryByRun: async (input) => (await database).updateDeliveryByRun(input),
    removeTeam: async (teamId) => (await database).removeTeam(teamId),
    listMembers: async (teamId) => (await database).listMembers(teamId),
    createInviteCode: async (input) => (await database).createInviteCode(input),
    listInviteCodes: async (teamId) => (await database).listInviteCodes(teamId),
    revokeInviteCode: async (input) => (await database).revokeInviteCode(input),
    joinByInviteCode: async (input) => (await database).joinByInviteCode(input),
    removeMember: async (input) => (await database).removeMember(input),
  };
}

export const groupClient: CollaborationClient = isElectronDesktop()
  ? createElectronGroupClient()
  : createBrowserGroupClient();
