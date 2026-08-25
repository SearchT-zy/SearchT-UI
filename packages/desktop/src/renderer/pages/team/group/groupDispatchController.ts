import type { ChatFileRef } from '@/common/types/chatFile';
import type {
  CollaborationClient,
  CollaborationCreateInput,
  CollaborationSnapshot,
  CollaborationTargetMode,
} from '@/common/types/searcht/collaboration';
import type { ISendTeamAgentMessageParams, ISendTeamMessageParams, ITeamRunAck } from '@/common/types/team/teamTypes';

export type GroupDispatchInput = {
  localMessageId: string;
  teamId: string;
  content: string;
  targetMode: CollaborationTargetMode;
  targetSlotIds: string[];
  fileRefs: ChatFileRef[];
};

export type GroupDispatchDependencies = {
  store: CollaborationClient;
  sendCoordinator: (input: ISendTeamMessageParams) => Promise<ITeamRunAck>;
  sendMember: (input: ISendTeamAgentMessageParams) => Promise<ITeamRunAck>;
};

export function createGroupDispatchController(dependencies: GroupDispatchDependencies) {
  const active = new Set<string>();

  return {
    async dispatch(input: GroupDispatchInput): Promise<CollaborationSnapshot> {
      if (active.has(input.localMessageId)) throw new Error('COLLABORATION_ALREADY_DISPATCHING');
      active.add(input.localMessageId);
      try {
        const snapshot = await dependencies.store.createInstruction(toCreateInput(input));
        const message = snapshot.messages.find((candidate) => candidate.id === input.localMessageId);
        if (!message) throw new Error('COLLABORATION_MESSAGE_NOT_FOUND');

        if (input.targetMode === 'coordinator') {
          await dispatchTarget(message.targetSlotIds[0], input, dependencies.sendCoordinator, dependencies.store);
        } else {
          for (const targetSlotId of message.targetSlotIds) {
            await dispatchTarget(
              targetSlotId,
              input,
              (payload) => dependencies.sendMember({ ...payload, slot_id: targetSlotId }),
              dependencies.store
            );
          }
        }
        return dependencies.store.list(input.teamId);
      } finally {
        active.delete(input.localMessageId);
      }
    },
  };
}

function toCreateInput(input: GroupDispatchInput): CollaborationCreateInput {
  return {
    messageId: input.localMessageId,
    teamId: input.teamId,
    content: input.content,
    targetMode: input.targetMode,
    targetSlotIds: input.targetSlotIds,
    fileRefs: input.fileRefs,
  };
}

async function dispatchTarget(
  targetSlotId: string,
  input: GroupDispatchInput,
  send: (payload: ISendTeamMessageParams) => Promise<ITeamRunAck>,
  store: CollaborationClient
): Promise<void> {
  try {
    const acknowledgement = await send({
      team_id: input.teamId,
      input: input.content,
      files: input.fileRefs,
    });
    await store.updateDelivery({
      messageId: input.localMessageId,
      targetSlotId,
      teamRunId: acknowledgement.run.team_run_id,
      status: 'accepted',
      errorCode: null,
      errorDetail: null,
    });
  } catch (error) {
    await store.updateDelivery({
      messageId: input.localMessageId,
      targetSlotId,
      status: 'unknown',
      errorCode: 'COLLABORATION_ACK_UNKNOWN',
      errorDetail: error instanceof Error ? error.message : String(error),
    });
  }
}
