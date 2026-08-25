import { describe, expect, it } from 'vitest';
import { buildGroupRoute } from '@/renderer/pages/team/group/groupMentionRouter';

const members = [
  { slotId: 'leader', name: 'Claude Code', ready: true, role: 'leader' as const },
  { slotId: 'codex', name: 'Codex', ready: true, role: 'teammate' as const },
  { slotId: 'hermes', name: 'Hermes', ready: false, role: 'teammate' as const },
];

describe('buildGroupRoute', () => {
  it('routes an unmentioned instruction through the coordinator', () => {
    expect(buildGroupRoute({ mode: 'coordinator', selectedSlotIds: [], members })).toEqual({
      targetMode: 'coordinator',
      targetSlotIds: ['leader'],
      unavailableSlotIds: [],
    });
  });

  it('keeps unavailable selected members visible instead of silently dropping them', () => {
    expect(buildGroupRoute({ mode: 'members', selectedSlotIds: ['codex', 'hermes'], members })).toEqual({
      targetMode: 'members',
      targetSlotIds: ['codex'],
      unavailableSlotIds: ['hermes'],
    });
  });

  it('targets every ready member and reports unavailable members for all mode', () => {
    expect(buildGroupRoute({ mode: 'all', selectedSlotIds: [], members })).toEqual({
      targetMode: 'all',
      targetSlotIds: ['leader', 'codex'],
      unavailableSlotIds: ['hermes'],
    });
  });

  it('deduplicates explicitly selected members while preserving selection order', () => {
    expect(buildGroupRoute({ mode: 'members', selectedSlotIds: ['codex', 'leader', 'codex'], members })).toEqual({
      targetMode: 'members',
      targetSlotIds: ['codex', 'leader'],
      unavailableSlotIds: [],
    });
  });

  it('rejects direct mode without a selected member', () => {
    expect(() => buildGroupRoute({ mode: 'members', selectedSlotIds: [], members })).toThrow(
      'COLLABORATION_TARGET_REQUIRED'
    );
  });

  it('rejects coordinator mode when the group has no leader', () => {
    expect(() =>
      buildGroupRoute({
        mode: 'coordinator',
        selectedSlotIds: [],
        members: members.filter((member) => member.role !== 'leader'),
      })
    ).toThrow('COLLABORATION_COORDINATOR_MISSING');
  });
});
