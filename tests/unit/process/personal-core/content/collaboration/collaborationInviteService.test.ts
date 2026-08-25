import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { CollaborationRepository } from '@process/services/personal-core/content/collaboration/CollaborationRepository';
import { CollaborationService } from '@process/services/personal-core/content/collaboration/CollaborationService';

let directory: string;
let database: PersonalDatabase;
let service: CollaborationService;

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-collaboration-invite-'));
  database = PersonalDatabase.open(directory);
  const repository = new CollaborationRepository(database.driver);
  service = new CollaborationService(repository, { now: () => 10_000 });
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('collaboration invite service', () => {
  it('creates invite codes with clamped limits and deterministic format', () => {
    const invite = service.createInviteCode({ teamId: 'team-1', maxUses: 5, expiresInDays: 7 });

    expect(invite.teamId).toBe('team-1');
    expect(invite.code).toMatch(/^ZX-[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
    expect(invite.maxUses).toBe(5);
    expect(invite.useCount).toBe(0);
    expect(invite.expiresAt).toBe(10_000 + 7 * 24 * 60 * 60 * 1000);
    expect(invite.revokedAt).toBeNull();
    expect(service.listInviteCodes('team-1')).toEqual([expect.objectContaining({ id: invite.id })]);
  });

  it('joins a group with a valid invite code and records a system message', () => {
    const invite = service.createInviteCode({ teamId: 'team-1' });

    const result = service.joinByInviteCode({
      code: invite.code.toLowerCase().replace(/-/g, ' '),
      displayName: ' Alice ',
    });

    expect(result.teamId).toBe('team-1');
    expect(result.member).toMatchObject({ displayName: 'Alice', role: 'member', joinedVia: 'invite-code' });
    expect(service.listMembers('team-1')).toEqual([expect.objectContaining({ id: result.member.id })]);
    const refreshed = service.listInviteCodes('team-1')[0];
    expect(refreshed.useCount).toBe(1);
    const snapshot = service.list('team-1');
    expect(snapshot.messages).toEqual([
      expect.objectContaining({
        senderKind: 'system',
        kind: 'progress',
        content: 'Alice joined the group via invite code',
      }),
    ]);
  });

  it('rejects joining with unknown, revoked, expired or exhausted codes', () => {
    expect(() => service.joinByInviteCode({ code: 'ZX-ABCDE-FGHIJ', displayName: 'Alice' })).toThrow(
      'COLLABORATION_INVITE_NOT_FOUND'
    );

    const singleUse = service.createInviteCode({ teamId: 'team-1', maxUses: 1 });
    service.joinByInviteCode({ code: singleUse.code, displayName: 'Alice' });
    expect(() => service.joinByInviteCode({ code: singleUse.code, displayName: 'Bob' })).toThrow(
      'COLLABORATION_INVITE_EXHAUSTED'
    );

    const revoked = service.createInviteCode({ teamId: 'team-1' });
    service.revokeInviteCode({ id: revoked.id });
    expect(() => service.joinByInviteCode({ code: revoked.code, displayName: 'Bob' })).toThrow(
      'COLLABORATION_INVITE_REVOKED'
    );

    const laterService = new CollaborationService(new CollaborationRepository(database.driver), {
      now: () => 10_000 + 15 * 24 * 60 * 60 * 1000,
    });
    expect(() => laterService.joinByInviteCode({ code: revoked.code, displayName: 'Bob' })).toThrow(
      'COLLABORATION_INVITE_REVOKED'
    );
    const expired = service.createInviteCode({ teamId: 'team-1', expiresInDays: 14 });
    expect(() => laterService.joinByInviteCode({ code: expired.code, displayName: 'Bob' })).toThrow(
      'COLLABORATION_INVITE_EXPIRED'
    );
  });

  it('rejects malformed codes and duplicate member names within one group', () => {
    const invite = service.createInviteCode({ teamId: 'team-1' });
    service.joinByInviteCode({ code: invite.code, displayName: 'Alice' });

    expect(() => service.joinByInviteCode({ code: 'ZX-SHORT', displayName: 'Bob' })).toThrow(
      'COLLABORATION_INVITE_CODE_INVALID'
    );
    expect(() => service.joinByInviteCode({ code: invite.code, displayName: 'ALICE' })).toThrow(
      'COLLABORATION_MEMBER_DUPLICATE'
    );
    expect(() => service.joinByInviteCode({ code: invite.code, displayName: '' })).toThrow(
      'COLLABORATION_MEMBER_NAME_INVALID'
    );
  });

  it('removes members but protects owners, and removes members with the team', () => {
    const invite = service.createInviteCode({ teamId: 'team-1' });
    const { member } = service.joinByInviteCode({ code: invite.code, displayName: 'Alice' });

    service.removeMember({ teamId: 'team-1', memberId: member.id });
    expect(service.listMembers('team-1')).toEqual([]);
    expect(() => service.removeMember({ teamId: 'team-1', memberId: member.id })).toThrow(
      'COLLABORATION_MEMBER_NOT_FOUND'
    );

    const second = service.createInviteCode({ teamId: 'team-2' });
    const joined = service.joinByInviteCode({ code: second.code, displayName: 'Bob' }).member;
    const owner = service.listMembers('team-2').find((candidate) => candidate.role === 'owner');
    if (owner) {
      expect(() => service.removeMember({ teamId: 'team-2', memberId: owner.id })).toThrow(
        'COLLABORATION_MEMBER_IS_OWNER'
      );
    }

    service.removeTeam('team-2');
    expect(service.listMembers('team-2')).toEqual([]);
    expect(service.listInviteCodes('team-2')).toEqual([]);
    expect(joined.id).toBeTruthy();
  });
});
