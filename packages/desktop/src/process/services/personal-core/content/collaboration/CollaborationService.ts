import { isChatFileRef } from '@/common/types/chatFile';
import type {
  CollaborationAppendEventInput,
  CollaborationCreateInput,
  CollaborationDelivery,
  CollaborationDeliveryUpdate,
  CollaborationInviteCode,
  CollaborationInviteCreateInput,
  CollaborationJoinResult,
  CollaborationMember,
  CollaborationMessage,
  CollaborationRunDeliveryUpdate,
  CollaborationSnapshot,
} from '@/common/types/searcht/collaboration';
import { memberKey, type CollaborationRepository } from './CollaborationRepository';

const MAX_CONTENT_LENGTH = 100_000;
const MAX_TARGET_COUNT = 32;
const INVITE_CODE_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const INVITE_CODE_MAX_ATTEMPTS = 8;

type CollaborationRepositoryContract = Pick<
  CollaborationRepository,
  | 'list'
  | 'createInstruction'
  | 'appendEvent'
  | 'updateDelivery'
  | 'updateDeliveryByRun'
  | 'removeTeam'
  | 'listMembers'
  | 'insertMember'
  | 'removeMember'
  | 'insertInviteCode'
  | 'listInviteCodes'
  | 'findInviteCodeById'
  | 'findInviteCodeByCode'
  | 'markInviteCodeRevoked'
  | 'incrementInviteCodeUse'
>;

export type CollaborationServiceOptions = {
  now?: () => number;
  generateCodeBody?: () => string;
};

export class CollaborationService {
  private readonly now: () => number;
  private readonly generateCodeBody: () => string;

  constructor(
    private readonly repository: CollaborationRepositoryContract,
    options: CollaborationServiceOptions = {}
  ) {
    this.now = options.now ?? Date.now;
    this.generateCodeBody = options.generateCodeBody ?? defaultGenerateCodeBody;
  }

  list(teamId: string, limit?: number): CollaborationSnapshot {
    const normalizedLimit = limit === undefined ? undefined : Math.min(1000, Math.max(1, Math.trunc(limit)));
    return this.repository.list(normalizeId(teamId), normalizedLimit);
  }

  createInstruction(input: CollaborationCreateInput): CollaborationSnapshot {
    const content = normalizeContent(input.content);
    const targetSlotIds = normalizeTargets(input.targetSlotIds);
    if (!input.fileRefs.every(isValidFileRef)) throw new Error('COLLABORATION_FILE_REF_INVALID');
    return this.repository.createInstruction({
      ...input,
      messageId: normalizeId(input.messageId),
      teamId: normalizeId(input.teamId),
      content,
      targetSlotIds,
    });
  }

  appendEvent(input: CollaborationAppendEventInput): CollaborationMessage {
    return this.repository.appendEvent({
      ...input,
      teamId: normalizeId(input.teamId),
      sourceEventId: normalizeId(input.sourceEventId),
      senderSlotId: input.senderSlotId ? normalizeId(input.senderSlotId) : null,
      content: normalizeContent(input.content),
      conversationId: input.conversationId ? normalizeId(input.conversationId) : null,
    });
  }

  updateDelivery(input: CollaborationDeliveryUpdate): CollaborationDelivery {
    return this.repository.updateDelivery({
      ...input,
      messageId: normalizeId(input.messageId),
      targetSlotId: normalizeId(input.targetSlotId),
      teamRunId: input.teamRunId ? normalizeId(input.teamRunId) : input.teamRunId,
    });
  }

  updateDeliveryByRun(input: CollaborationRunDeliveryUpdate): CollaborationDelivery[] {
    return this.repository.updateDeliveryByRun({
      ...input,
      teamId: normalizeId(input.teamId),
      teamRunId: normalizeId(input.teamRunId),
    });
  }

  removeTeam(teamId: string): void {
    this.repository.removeTeam(normalizeId(teamId));
  }

  listMembers(teamId: string): CollaborationMember[] {
    return this.repository.listMembers(normalizeId(teamId));
  }

  createInviteCode(input: CollaborationInviteCreateInput): CollaborationInviteCode {
    const teamId = normalizeId(input.teamId);
    const maxUses = clampOptional(input.maxUses, 1, 100) ?? 10;
    const expiresInDays = clampOptional(input.expiresInDays, 1, 90) ?? 14;
    const expiresAt = this.now() + expiresInDays * 24 * 60 * 60 * 1000;
    let lastError: unknown = new Error('COLLABORATION_INVITE_CODE_GENERATION_FAILED');
    for (let attempt = 0; attempt < INVITE_CODE_MAX_ATTEMPTS; attempt += 1) {
      const code = `ZX-${this.generateCodeBody()}`;
      try {
        this.repository.insertInviteCode({ teamId, code, maxUses, expiresAt });
        return this.repository.findInviteCodeByCode(code)!;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  listInviteCodes(teamId: string): CollaborationInviteCode[] {
    return this.repository.listInviteCodes(normalizeId(teamId));
  }

  revokeInviteCode(input: { id: string }): CollaborationInviteCode {
    const id = normalizeId(input.id);
    if (!this.repository.findInviteCodeById(id)) throw new Error('COLLABORATION_INVITE_NOT_FOUND');
    return this.repository.markInviteCodeRevoked(id);
  }

  joinByInviteCode(input: { code: string; displayName: string }): CollaborationJoinResult {
    const code = normalizeInviteCode(input.code);
    const displayName = normalizeDisplayName(input.displayName);
    const invite = this.repository.findInviteCodeByCode(code);
    if (!invite) throw new Error('COLLABORATION_INVITE_NOT_FOUND');
    if (invite.revokedAt !== null) throw new Error('COLLABORATION_INVITE_REVOKED');
    if (invite.expiresAt !== null && this.now() > invite.expiresAt) throw new Error('COLLABORATION_INVITE_EXPIRED');
    if (invite.useCount >= invite.maxUses) throw new Error('COLLABORATION_INVITE_EXHAUSTED');
    const existingMembers = this.repository.listMembers(invite.teamId);
    if (existingMembers.some((member) => memberKey(member.displayName) === memberKey(displayName))) {
      throw new Error('COLLABORATION_MEMBER_DUPLICATE');
    }
    const member = this.repository.insertMember({
      teamId: invite.teamId,
      displayName,
      role: 'member',
      joinedVia: 'invite-code',
    });
    this.repository.incrementInviteCodeUse(invite.id);
    this.repository.appendEvent({
      teamId: invite.teamId,
      sourceEventId: `invite-join:${member.id}`,
      senderKind: 'system',
      senderSlotId: null,
      kind: 'progress',
      content: `${displayName} joined the group via invite code`,
      createdAt: this.now(),
    });
    return { teamId: invite.teamId, member };
  }

  removeMember(input: { teamId: string; memberId: string }): void {
    const teamId = normalizeId(input.teamId);
    const memberId = normalizeId(input.memberId);
    const member = this.repository.listMembers(teamId).find((candidate) => candidate.id === memberId);
    if (!member) throw new Error('COLLABORATION_MEMBER_NOT_FOUND');
    if (member.role === 'owner') throw new Error('COLLABORATION_MEMBER_IS_OWNER');
    this.repository.removeMember(teamId, memberId);
    this.repository.appendEvent({
      teamId,
      sourceEventId: `invite-leave:${memberId}:${this.now()}`,
      senderKind: 'system',
      senderSlotId: null,
      kind: 'progress',
      content: `${member.displayName} was removed from the group`,
      createdAt: this.now(),
    });
  }
}

function defaultGenerateCodeBody(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const body = Array.from(bytes, (byte) => INVITE_CODE_CHARSET[byte % INVITE_CODE_CHARSET.length]).join('');
  return `${body.slice(0, 5)}-${body.slice(5)}`;
}

function normalizeInviteCode(value: string): string {
  const compact = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (compact.length !== 12) throw new Error('COLLABORATION_INVITE_CODE_INVALID');
  return `ZX-${compact.slice(2, 7)}-${compact.slice(7)}`;
}

function normalizeDisplayName(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 32) throw new Error('COLLABORATION_MEMBER_NAME_INVALID');
  return normalized;
}

function clampOptional(value: number | undefined, minimum: number, maximum: number): number | undefined {
  if (value === undefined) return undefined;
  const truncated = Math.trunc(value);
  if (!Number.isFinite(truncated)) return undefined;
  return Math.min(maximum, Math.max(minimum, truncated));
}

function normalizeId(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error('COLLABORATION_ID_REQUIRED');
  return normalized;
}

function normalizeContent(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error('COLLABORATION_CONTENT_REQUIRED');
  if (normalized.length > MAX_CONTENT_LENGTH) throw new Error('COLLABORATION_CONTENT_TOO_LONG');
  return normalized;
}

function normalizeTargets(values: string[]): string[] {
  const targets = [...new Set(values.map(normalizeId))];
  if (targets.length === 0) throw new Error('COLLABORATION_TARGET_REQUIRED');
  if (targets.length > MAX_TARGET_COUNT) throw new Error('COLLABORATION_TARGET_LIMIT_EXCEEDED');
  return targets;
}

function isValidFileRef(value: unknown): boolean {
  if (!isChatFileRef(value)) return false;
  if (value.kind === 'project') return Boolean(value.pe_id.trim() && value.relative_path.trim());
  return Boolean(value.path.trim());
}
