import type { CollaborationTargetMode } from '@/common/types/searcht/collaboration';

export type GroupRouteMember = {
  slotId: string;
  name: string;
  ready: boolean;
  role: 'leader' | 'teammate';
};

export type GroupRoute = {
  targetMode: CollaborationTargetMode;
  targetSlotIds: string[];
  unavailableSlotIds: string[];
};

export type BuildGroupRouteInput = {
  mode: CollaborationTargetMode;
  selectedSlotIds: string[];
  members: GroupRouteMember[];
};

export function buildGroupRoute(input: BuildGroupRouteInput): GroupRoute {
  const leader = input.members.find((member) => member.role === 'leader');
  if (input.mode === 'coordinator') {
    if (!leader) throw new Error('COLLABORATION_COORDINATOR_MISSING');
    return {
      targetMode: 'coordinator',
      targetSlotIds: leader.ready ? [leader.slotId] : [],
      unavailableSlotIds: leader.ready ? [] : [leader.slotId],
    };
  }

  const requested = input.mode === 'all' ? input.members.map((member) => member.slotId) : input.selectedSlotIds;
  if (requested.length === 0) throw new Error('COLLABORATION_TARGET_REQUIRED');

  const membersById = new Map(input.members.map((member) => [member.slotId, member]));
  const unique = [...new Set(requested)];
  return {
    targetMode: input.mode,
    targetSlotIds: unique.filter((slotId) => membersById.get(slotId)?.ready),
    unavailableSlotIds: unique.filter((slotId) => !membersById.get(slotId)?.ready),
  };
}
