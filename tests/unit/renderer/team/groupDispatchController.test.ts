import { describe, expect, it, vi } from 'vitest';
import type { CollaborationClient, CollaborationSnapshot } from '@/common/types/searcht/collaboration';
import type { ITeamRunAck } from '@/common/types/team/teamTypes';
import { createGroupDispatchController } from '@renderer/pages/team/group/groupDispatchController';

function ack(teamRunId: string, targetSlotId: string): ITeamRunAck {
  return {
    enqueue_status: 'accepted',
    message_id: `server-${teamRunId}`,
    run: { team_run_id: teamRunId, target_slot_id: targetSlotId },
  } as ITeamRunAck;
}

function snapshot(targetSlotIds: string[]): CollaborationSnapshot {
  return {
    messages: [
      {
        id: 'message-1',
        teamId: 'team-1',
        threadId: 'message-1',
        senderKind: 'user',
        senderSlotId: null,
        targetMode: targetSlotIds.length === 1 && targetSlotIds[0] === 'leader' ? 'coordinator' : 'members',
        targetSlotIds,
        kind: 'instruction',
        content: 'Check the numbers',
        fileRefs: [],
        sourceEventId: null,
        conversationId: null,
        createdAt: 1_000,
        updatedAt: 1_000,
      },
    ],
    deliveries: targetSlotIds.map((targetSlotId) => ({
      id: `delivery-${targetSlotId}`,
      messageId: 'message-1',
      targetSlotId,
      teamRunId: null,
      status: 'pending',
      errorCode: null,
      errorDetail: null,
      attemptCount: 0,
      lastAttemptAt: null,
    })),
  };
}

function makeStore(targetSlotIds: string[], order: string[] = []): CollaborationClient {
  const state = snapshot(targetSlotIds);
  return {
    list: vi.fn(async () => state),
    createInstruction: vi.fn(async () => {
      order.push('persist');
      return state;
    }),
    appendEvent: vi.fn(),
    updateDelivery: vi.fn(async (input) => {
      order.push(`receipt:${input.targetSlotId}:${input.status}`);
      return { ...state.deliveries.find((item) => item.targetSlotId === input.targetSlotId)!, ...input };
    }),
    updateDeliveryByRun: vi.fn(),
    removeTeam: vi.fn(),
  };
}

const baseInput = {
  localMessageId: 'message-1',
  teamId: 'team-1',
  content: 'Check the numbers',
  fileRefs: [],
};

describe('group dispatch controller', () => {
  it('persists before dispatching a coordinator instruction', async () => {
    const order: string[] = [];
    const store = makeStore(['leader'], order);
    const sendCoordinator = vi.fn(async () => {
      order.push('send:leader');
      return ack('run-1', 'leader');
    });
    const controller = createGroupDispatchController({ store, sendCoordinator, sendMember: vi.fn() });

    await controller.dispatch({
      ...baseInput,
      targetMode: 'coordinator',
      targetSlotIds: ['leader'],
    });

    expect(order).toEqual(['persist', 'send:leader', 'receipt:leader:accepted']);
    expect(sendCoordinator).toHaveBeenCalledWith({ team_id: 'team-1', input: 'Check the numbers', files: [] });
    expect(store.updateDelivery).toHaveBeenCalledWith({
      messageId: 'message-1',
      targetSlotId: 'leader',
      teamRunId: 'run-1',
      status: 'accepted',
      errorCode: null,
      errorDetail: null,
    });
  });

  it('dispatches direct instructions once per ready member', async () => {
    const store = makeStore(['codex', 'hermes']);
    const sendMember = vi.fn(async ({ slot_id }: { slot_id: string }) => ack(`run-${slot_id}`, slot_id));
    const controller = createGroupDispatchController({ store, sendCoordinator: vi.fn(), sendMember });

    await controller.dispatch({
      ...baseInput,
      targetMode: 'members',
      targetSlotIds: ['codex', 'hermes'],
    });

    expect(sendMember).toHaveBeenCalledTimes(2);
    expect(sendMember).toHaveBeenNthCalledWith(1, {
      team_id: 'team-1',
      slot_id: 'codex',
      input: 'Check the numbers',
      files: [],
    });
    expect(sendMember).toHaveBeenNthCalledWith(2, {
      team_id: 'team-1',
      slot_id: 'hermes',
      input: 'Check the numbers',
      files: [],
    });
  });

  it('marks only a failed target as unknown when acknowledgement is lost', async () => {
    const store = makeStore(['codex', 'hermes']);
    const sendMember = vi.fn(async ({ slot_id }: { slot_id: string }) => {
      if (slot_id === 'hermes') throw new Error('connection lost');
      return ack('run-codex', slot_id);
    });
    const controller = createGroupDispatchController({ store, sendCoordinator: vi.fn(), sendMember });

    await controller.dispatch({
      ...baseInput,
      targetMode: 'members',
      targetSlotIds: ['codex', 'hermes'],
    });

    expect(store.updateDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ targetSlotId: 'codex', status: 'accepted', teamRunId: 'run-codex' })
    );
    expect(store.updateDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        targetSlotId: 'hermes',
        status: 'unknown',
        errorCode: 'COLLABORATION_ACK_UNKNOWN',
        errorDetail: 'connection lost',
      })
    );
  });

  it('rejects concurrent re-entry for the same local message', async () => {
    let releasePersistence!: () => void;
    const persistence = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    const store = makeStore(['leader']);
    vi.mocked(store.createInstruction).mockImplementation(async () => {
      await persistence;
      return snapshot(['leader']);
    });
    const controller = createGroupDispatchController({
      store,
      sendCoordinator: vi.fn(async () => ack('run-1', 'leader')),
      sendMember: vi.fn(),
    });
    const first = controller.dispatch({
      ...baseInput,
      targetMode: 'coordinator',
      targetSlotIds: ['leader'],
    });

    await expect(
      controller.dispatch({ ...baseInput, targetMode: 'coordinator', targetSlotIds: ['leader'] })
    ).rejects.toThrow('COLLABORATION_ALREADY_DISPATCHING');
    releasePersistence();
    await first;
  });

  it('does not call Team when local persistence fails', async () => {
    const store = makeStore(['leader']);
    vi.mocked(store.createInstruction).mockRejectedValue(new Error('disk unavailable'));
    const sendCoordinator = vi.fn();
    const sendMember = vi.fn();
    const controller = createGroupDispatchController({ store, sendCoordinator, sendMember });

    await expect(
      controller.dispatch({ ...baseInput, targetMode: 'coordinator', targetSlotIds: ['leader'] })
    ).rejects.toThrow('disk unavailable');
    expect(sendCoordinator).not.toHaveBeenCalled();
    expect(sendMember).not.toHaveBeenCalled();
  });
});
