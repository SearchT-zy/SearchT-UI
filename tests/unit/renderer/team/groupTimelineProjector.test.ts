import { describe, expect, it } from 'vitest';
import type { ITeamActivityItem } from '@/common/types/team/teamTypes';
import type { CollaborationDelivery, CollaborationMessage } from '@/common/types/searcht/collaboration';
import { projectGroupTimeline } from '@renderer/pages/team/group/groupTimelineProjector';

function collaborationMessage(overrides: Partial<CollaborationMessage> = {}): CollaborationMessage {
  return {
    id: 'instruction-1',
    teamId: 'team-1',
    threadId: 'instruction-1',
    senderKind: 'user',
    senderSlotId: null,
    targetMode: 'members',
    targetSlotIds: ['codex', 'hermes'],
    kind: 'instruction',
    content: 'Prepare the report',
    fileRefs: [],
    sourceEventId: null,
    conversationId: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function delivery(targetSlotId: string, messageId = 'instruction-1'): CollaborationDelivery {
  return {
    id: `delivery-${targetSlotId}`,
    messageId,
    targetSlotId,
    teamRunId: `run-${targetSlotId}`,
    status: 'running',
    errorCode: null,
    errorDetail: null,
    attemptCount: 1,
    lastAttemptAt: 1_100,
  };
}

const activities: ITeamActivityItem[] = [
  {
    kind: 'task',
    id: 'shared-id',
    created_at: 2_000,
    task: {
      id: 'shared-id',
      team_id: 'team-1',
      subject: 'Verify totals',
      status: 'completed',
      owner: 'codex',
      blocked_by: [],
      blocks: [],
      created_at: 2_000,
      updated_at: 4_000,
    },
  },
  {
    kind: 'message',
    id: 'mailbox-1',
    created_at: 3_000,
    message: {
      id: 'mailbox-1',
      team_id: 'team-1',
      from_agent_id: 'codex',
      to_agent_id: 'hermes',
      msg_type: 'handoff',
      content: 'Totals are checked',
      files: [],
      read: true,
      created_at: 3_000,
    },
  },
];

describe('group timeline projector', () => {
  it('merges instructions, tasks, hand-offs, and results in stable chronological order', () => {
    const result = projectGroupTimeline({
      messages: [
        collaborationMessage({ id: 'shared-id' }),
        collaborationMessage({
          id: 'result-1',
          senderKind: 'agent',
          senderSlotId: 'codex',
          targetSlotIds: [],
          kind: 'result',
          content: 'Report complete',
          sourceEventId: 'conversation-turn:codex:turn-1',
          conversationId: 'conversation-codex',
          createdAt: 4_000,
          updatedAt: 4_000,
        }),
      ],
      deliveries: [delivery('codex', 'shared-id'), delivery('hermes', 'shared-id')],
      activities,
      members: [{ slotId: 'codex', name: 'Codex' }],
      senderNameFallbacks: { hermes: 'Hermes' },
    });

    expect(result.map((item) => item.kind)).toEqual(['instruction', 'task', 'handoff', 'result']);
    expect(result[0]).toMatchObject({
      stableId: 'collaboration:shared-id',
      deliveries: [{ targetSlotId: 'codex' }, { targetSlotId: 'hermes' }],
    });
    expect(result[1]).toMatchObject({ stableId: 'task:shared-id', kind: 'task' });
  });

  it('deduplicates runtime events by source event id', () => {
    const first = collaborationMessage({
      id: 'result-1',
      senderKind: 'agent',
      senderSlotId: 'codex',
      targetSlotIds: [],
      kind: 'result',
      sourceEventId: 'turn:1',
      createdAt: 2_000,
    });
    const duplicate = { ...first, id: 'result-duplicate', createdAt: 3_000 };

    const result = projectGroupTimeline({
      messages: [duplicate, first],
      deliveries: [],
      activities: [],
      members: [],
      senderNameFallbacks: {},
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ stableId: 'collaboration:result-1', createdAt: 2_000 });
  });

  it('uses a recorded name when the sender is no longer a current member', () => {
    const result = projectGroupTimeline({
      messages: [],
      deliveries: [],
      activities: [activities[1]],
      members: [],
      senderNameFallbacks: { codex: 'Codex (removed)' },
    });

    expect(result[0]).toMatchObject({ kind: 'handoff', senderName: 'Codex (removed)' });
  });

  it('uses stable ids to order items created at the same time', () => {
    const result = projectGroupTimeline({
      messages: [
        collaborationMessage({ id: 'z-message', createdAt: 1_000 }),
        collaborationMessage({ id: 'a-message', createdAt: 1_000 }),
      ],
      deliveries: [],
      activities: [],
      members: [],
      senderNameFallbacks: {},
    });

    expect(result.map((item) => item.stableId)).toEqual(['collaboration:a-message', 'collaboration:z-message']);
  });
});
