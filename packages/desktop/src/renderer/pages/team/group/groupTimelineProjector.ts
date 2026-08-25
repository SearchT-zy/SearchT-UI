import type { ITeamActivityItem, ITeamMailboxMessage, ITeamTaskItem } from '@/common/types/team/teamTypes';
import type {
  CollaborationDelivery,
  CollaborationMessage,
  CollaborationMessageKind,
} from '@/common/types/searcht/collaboration';

export type GroupTimelineMember = {
  slotId: string;
  name: string;
};

type GroupTimelineBase = {
  stableId: string;
  createdAt: number;
  senderSlotId: string | null;
  senderName: string | null;
};

export type GroupTimelineCollaborationItem = GroupTimelineBase & {
  kind: CollaborationMessageKind;
  message: CollaborationMessage;
  deliveries: CollaborationDelivery[];
};

export type GroupTimelineTaskItem = GroupTimelineBase & {
  kind: 'task';
  task: ITeamTaskItem;
};

export type GroupTimelineHandoffItem = GroupTimelineBase & {
  kind: 'handoff';
  mailboxMessage: ITeamMailboxMessage;
};

export type GroupTimelineItem = GroupTimelineCollaborationItem | GroupTimelineTaskItem | GroupTimelineHandoffItem;

export type GroupTimelineProjectionInput = {
  messages: CollaborationMessage[];
  deliveries: CollaborationDelivery[];
  activities: ITeamActivityItem[];
  members: GroupTimelineMember[];
  senderNameFallbacks: Readonly<Record<string, string>>;
  userName?: string;
};

export function projectGroupTimeline(input: GroupTimelineProjectionInput): GroupTimelineItem[] {
  const names = new Map(input.members.map((member) => [member.slotId, member.name]));
  const resolveName = (slotId: string | null): string | null => {
    if (!slotId) return input.userName ?? null;
    return names.get(slotId) ?? input.senderNameFallbacks[slotId] ?? slotId;
  };
  const deliveriesByMessage = new Map<string, CollaborationDelivery[]>();
  for (const delivery of input.deliveries) {
    const deliveries = deliveriesByMessage.get(delivery.messageId) ?? [];
    deliveries.push(delivery);
    deliveriesByMessage.set(delivery.messageId, deliveries);
  }

  const seenSourceEvents = new Set<string>();
  const collaborationItems = input.messages
    .toSorted(compareCollaborationMessages)
    .flatMap<GroupTimelineCollaborationItem>((message) => {
      if (message.sourceEventId) {
        if (seenSourceEvents.has(message.sourceEventId)) return [];
        seenSourceEvents.add(message.sourceEventId);
      }
      return [
        {
          stableId: `collaboration:${message.id}`,
          kind: message.kind,
          createdAt: message.createdAt,
          senderSlotId: message.senderSlotId,
          senderName: resolveName(message.senderSlotId),
          message,
          deliveries: deliveriesByMessage.get(message.id) ?? [],
        },
      ];
    });

  const activityItems = input.activities.map<GroupTimelineTaskItem | GroupTimelineHandoffItem>((activity) => {
    if (activity.kind === 'task') {
      return {
        stableId: `task:${activity.id}`,
        kind: 'task',
        createdAt: activity.created_at,
        senderSlotId: activity.task.owner ?? null,
        senderName: resolveName(activity.task.owner ?? null),
        task: activity.task,
      };
    }
    return {
      stableId: `mailbox:${activity.id}`,
      kind: 'handoff',
      createdAt: activity.created_at,
      senderSlotId: activity.message.from_agent_id,
      senderName: resolveName(activity.message.from_agent_id),
      mailboxMessage: activity.message,
    };
  });

  return [...collaborationItems, ...activityItems].toSorted(
    (left, right) => left.createdAt - right.createdAt || left.stableId.localeCompare(right.stableId)
  );
}

function compareCollaborationMessages(left: CollaborationMessage, right: CollaborationMessage): number {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}
