import { describe, expect, it, vi } from 'vitest';
import type {
  CollaborationAppendEventInput,
  CollaborationCreateInput,
  CollaborationDeliveryUpdate,
  CollaborationRunDeliveryUpdate,
} from '@/common/types/searcht/collaboration';
import { initCollaborationBridge } from '@process/bridge/personalWorkspaceBridge';

const instruction: CollaborationCreateInput = {
  messageId: 'message-1',
  teamId: 'team-1',
  content: 'Prepare the report',
  targetMode: 'coordinator',
  targetSlotIds: ['leader'],
  fileRefs: [],
};

const event: CollaborationAppendEventInput = {
  teamId: 'team-1',
  sourceEventId: 'event-1',
  senderKind: 'agent',
  senderSlotId: 'leader',
  kind: 'result',
  content: 'Report ready',
  conversationId: 'conversation-1',
  createdAt: 1_000,
};

const delivery: CollaborationDeliveryUpdate = {
  messageId: 'message-1',
  targetSlotId: 'leader',
  status: 'accepted',
  teamRunId: 'run-1',
};

const runDelivery: CollaborationRunDeliveryUpdate = {
  teamId: 'team-1',
  teamRunId: 'run-1',
  status: 'completed',
};

describe('collaboration bridge', () => {
  it('forwards every provider input through the collaboration service', async () => {
    const service = {
      list: vi.fn(() => ({ messages: [], deliveries: [] })),
      createInstruction: vi.fn(() => ({ messages: [], deliveries: [] })),
      appendEvent: vi.fn(() => ({ id: 'event-message-1' })),
      updateDelivery: vi.fn(() => ({ id: 'delivery-1' })),
      updateDeliveryByRun: vi.fn(() => []),
      removeTeam: vi.fn(),
      listMembers: vi.fn(() => []),
      createInviteCode: vi.fn(() => ({ id: 'invite-1' })),
      listInviteCodes: vi.fn(() => []),
      revokeInviteCode: vi.fn(() => ({ id: 'invite-1', revokedAt: 1 })),
      joinByInviteCode: vi.fn(() => ({ teamId: 'team-1', member: { id: 'member-1' } })),
      removeMember: vi.fn(),
    };
    const handlers = initCollaborationBridge({ service: service as never });

    await handlers.list({ teamId: 'team-1', limit: 25 });
    await handlers.createInstruction(instruction);
    await handlers.appendEvent(event);
    await handlers.updateDelivery(delivery);
    await handlers.updateDeliveryByRun(runDelivery);
    await handlers.removeTeam({ teamId: 'team-1' });
    await handlers.listMembers({ teamId: 'team-1' });
    await handlers.createInviteCode({ teamId: 'team-1' });
    await handlers.listInviteCodes({ teamId: 'team-1' });
    await handlers.revokeInviteCode({ id: 'invite-1' });
    await handlers.joinByInviteCode({ code: 'ZX-ABCDE-FGHIJ', displayName: 'Alice' });
    await handlers.removeMember({ teamId: 'team-1', memberId: 'member-1' });

    expect(service.list).toHaveBeenCalledWith('team-1', 25);
    expect(service.createInstruction).toHaveBeenCalledWith(instruction);
    expect(service.appendEvent).toHaveBeenCalledWith(event);
    expect(service.updateDelivery).toHaveBeenCalledWith(delivery);
    expect(service.updateDeliveryByRun).toHaveBeenCalledWith(runDelivery);
    expect(service.removeTeam).toHaveBeenCalledWith('team-1');
    expect(service.listMembers).toHaveBeenCalledWith('team-1');
    expect(service.createInviteCode).toHaveBeenCalledWith({ teamId: 'team-1' });
    expect(service.listInviteCodes).toHaveBeenCalledWith('team-1');
    expect(service.revokeInviteCode).toHaveBeenCalledWith({ id: 'invite-1' });
    expect(service.joinByInviteCode).toHaveBeenCalledWith({ code: 'ZX-ABCDE-FGHIJ', displayName: 'Alice' });
    expect(service.removeMember).toHaveBeenCalledWith({ teamId: 'team-1', memberId: 'member-1' });
  });

  it('does not resolve Personal Core until a registered handler is invoked', () => {
    expect(() => initCollaborationBridge()).not.toThrow();
  });
});
