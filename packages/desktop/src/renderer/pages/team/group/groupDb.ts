import type {
  CollaborationAppendEventInput,
  CollaborationClient,
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
import {
  openPersonalWebDatabase,
  PERSONAL_WEB_DATABASE_NAME,
  PERSONAL_WEB_STORE_NAMES,
  requestResult,
  transactionDone,
} from '@renderer/pages/personal/personalDbSchema';

export type OpenGroupDatabaseOptions = {
  name?: string;
  factory?: IDBFactory;
  now?: () => number;
  randomUUID?: () => string;
};

type WebMemberRecord = CollaborationMember & { memberKey: string };

const DEFAULT_LIST_LIMIT = 500;
const INVITE_CODE_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export class GroupDatabase implements CollaborationClient {
  constructor(
    private readonly database: IDBDatabase,
    private readonly now: () => number,
    private readonly randomUUID: () => string
  ) {}

  close(): void {
    this.database.close();
  }

  async list(teamId: string, limit = DEFAULT_LIST_LIMIT): Promise<CollaborationSnapshot> {
    const normalizedTeamId = normalizeId(teamId);
    const normalizedLimit = Math.min(1_000, Math.max(1, Math.trunc(limit)));
    const transaction = this.database.transaction(
      [PERSONAL_WEB_STORE_NAMES.collaborationMessages, PERSONAL_WEB_STORE_NAMES.collaborationDeliveries],
      'readonly'
    );
    const done = transactionDone(transaction);
    const messageRequest = transaction
      .objectStore(PERSONAL_WEB_STORE_NAMES.collaborationMessages)
      .index('teamCreated')
      .getAll(IDBKeyRange.bound([normalizedTeamId, 0], [normalizedTeamId, Number.MAX_SAFE_INTEGER]), normalizedLimit);
    const deliveryRequest = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.collaborationDeliveries).getAll();
    const [messages, allDeliveries] = await Promise.all([
      requestResult<CollaborationMessage[]>(messageRequest),
      requestResult<CollaborationDelivery[]>(deliveryRequest),
    ]);
    await done;
    const messageOrder = new Map(messages.map((message, index) => [message.id, index]));
    const targetOrder = new Map(
      messages.flatMap((message) =>
        message.targetSlotIds.map((targetSlotId, index) => [`${message.id}\0${targetSlotId}`, index] as const)
      )
    );
    const deliveries = allDeliveries
      .filter((delivery) => messageOrder.has(delivery.messageId))
      .toSorted((left, right) => {
        const byMessage = messageOrder.get(left.messageId)! - messageOrder.get(right.messageId)!;
        if (byMessage !== 0) return byMessage;
        return (
          (targetOrder.get(`${left.messageId}\0${left.targetSlotId}`) ?? 0) -
          (targetOrder.get(`${right.messageId}\0${right.targetSlotId}`) ?? 0)
        );
      });
    return { messages, deliveries };
  }

  async createInstruction(input: CollaborationCreateInput): Promise<CollaborationSnapshot> {
    const messageId = normalizeId(input.messageId);
    const teamId = normalizeId(input.teamId);
    const targetSlotIds = normalizeTargets(input.targetSlotIds);
    const transaction = this.database.transaction(
      [PERSONAL_WEB_STORE_NAMES.collaborationMessages, PERSONAL_WEB_STORE_NAMES.collaborationDeliveries],
      'readwrite'
    );
    const done = transactionDone(transaction);
    try {
      const messageStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.collaborationMessages);
      const existing = await requestResult<CollaborationMessage | undefined>(messageStore.get(messageId));
      if (!existing) {
        const now = this.now();
        messageStore.add({
          id: messageId,
          teamId,
          threadId: messageId,
          senderKind: 'user',
          senderSlotId: null,
          targetMode: input.targetMode,
          targetSlotIds,
          kind: 'instruction',
          content: normalizeContent(input.content),
          fileRefs: input.fileRefs,
          sourceEventId: null,
          conversationId: null,
          createdAt: now,
          updatedAt: now,
        } satisfies CollaborationMessage);
        const deliveryStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.collaborationDeliveries);
        for (const targetSlotId of targetSlotIds) {
          deliveryStore.add({
            id: this.randomUUID(),
            messageId,
            targetSlotId,
            teamRunId: null,
            status: 'pending',
            errorCode: null,
            errorDetail: null,
            attemptCount: 0,
            lastAttemptAt: null,
          } satisfies CollaborationDelivery);
        }
      }
      await done;
      return this.list(teamId);
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  async appendEvent(input: CollaborationAppendEventInput): Promise<CollaborationMessage> {
    const teamId = normalizeId(input.teamId);
    const sourceEventId = normalizeId(input.sourceEventId);
    const transaction = this.database.transaction(PERSONAL_WEB_STORE_NAMES.collaborationMessages, 'readwrite');
    const done = transactionDone(transaction);
    try {
      const store = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.collaborationMessages);
      const existing = await requestResult<CollaborationMessage | undefined>(
        store.index('sourceEventId').get(sourceEventId)
      );
      if (existing) {
        await done;
        return existing;
      }
      const id = this.randomUUID();
      const message: CollaborationMessage = {
        id,
        teamId,
        threadId: id,
        senderKind: input.senderKind,
        senderSlotId: input.senderSlotId ? normalizeId(input.senderSlotId) : null,
        targetMode: 'members',
        targetSlotIds: [],
        kind: input.kind,
        content: normalizeContent(input.content),
        fileRefs: [],
        sourceEventId,
        conversationId: input.conversationId ? normalizeId(input.conversationId) : null,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      };
      store.add(message);
      await done;
      return message;
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  async updateDelivery(input: CollaborationDeliveryUpdate): Promise<CollaborationDelivery> {
    const transaction = this.database.transaction(PERSONAL_WEB_STORE_NAMES.collaborationDeliveries, 'readwrite');
    const done = transactionDone(transaction);
    try {
      const store = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.collaborationDeliveries);
      const current = await requestResult<CollaborationDelivery | undefined>(
        store.index('messageTarget').get([normalizeId(input.messageId), normalizeId(input.targetSlotId)])
      );
      if (!current) throw new Error('COLLABORATION_DELIVERY_NOT_FOUND');
      const recordsAttempt = ['accepted', 'failed', 'unknown'].includes(input.status);
      const updated: CollaborationDelivery = {
        ...current,
        teamRunId: input.teamRunId === undefined ? current.teamRunId : input.teamRunId,
        status: input.status,
        errorCode: input.errorCode === undefined ? current.errorCode : input.errorCode,
        errorDetail: input.errorDetail === undefined ? current.errorDetail : input.errorDetail,
        attemptCount: recordsAttempt ? Math.max(1, current.attemptCount) : current.attemptCount,
        lastAttemptAt: recordsAttempt ? this.now() : current.lastAttemptAt,
      };
      store.put(updated);
      await done;
      return updated;
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  async updateDeliveryByRun(input: CollaborationRunDeliveryUpdate): Promise<CollaborationDelivery[]> {
    const transaction = this.database.transaction(
      [PERSONAL_WEB_STORE_NAMES.collaborationMessages, PERSONAL_WEB_STORE_NAMES.collaborationDeliveries],
      'readwrite'
    );
    const done = transactionDone(transaction);
    try {
      const deliveryStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.collaborationDeliveries);
      const messageStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.collaborationMessages);
      const [deliveries, messages] = await Promise.all([
        requestResult<CollaborationDelivery[]>(deliveryStore.index('teamRunId').getAll(normalizeId(input.teamRunId))),
        requestResult<CollaborationMessage[]>(messageStore.getAll()),
      ]);
      const teamMessageIds = new Set(
        messages.filter((message) => message.teamId === normalizeId(input.teamId)).map((message) => message.id)
      );
      const updated = deliveries
        .filter((delivery) => teamMessageIds.has(delivery.messageId))
        .map((delivery) => ({ ...delivery, status: input.status }));
      for (const delivery of updated) deliveryStore.put(delivery);
      await done;
      return updated.toSorted((left, right) => left.targetSlotId.localeCompare(right.targetSlotId));
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  async removeTeam(teamId: string): Promise<void> {
    const normalizedTeamId = normalizeId(teamId);
    const transaction = this.database.transaction(
      [
        PERSONAL_WEB_STORE_NAMES.collaborationMessages,
        PERSONAL_WEB_STORE_NAMES.collaborationDeliveries,
        PERSONAL_WEB_STORE_NAMES.collaborationMembers,
        PERSONAL_WEB_STORE_NAMES.collaborationInviteCodes,
      ],
      'readwrite'
    );
    const done = transactionDone(transaction);
    try {
      const messageStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.collaborationMessages);
      const deliveryStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.collaborationDeliveries);
      const memberStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.collaborationMembers);
      const inviteStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.collaborationInviteCodes);
      const [messages, deliveries, members, invites] = await Promise.all([
        requestResult<CollaborationMessage[]>(
          messageStore
            .index('teamCreated')
            .getAll(IDBKeyRange.bound([normalizedTeamId, 0], [normalizedTeamId, Number.MAX_SAFE_INTEGER]))
        ),
        requestResult<CollaborationDelivery[]>(deliveryStore.getAll()),
        requestResult<WebMemberRecord[]>(memberStore.index('teamJoined').getAll(normalizedTeamId)),
        requestResult<CollaborationInviteCode[]>(inviteStore.index('teamCreated').getAll(normalizedTeamId)),
      ]);
      const messageIds = new Set(messages.map((message) => message.id));
      for (const message of messages) messageStore.delete(message.id);
      for (const delivery of deliveries) {
        if (messageIds.has(delivery.messageId)) deliveryStore.delete(delivery.id);
      }
      for (const member of members) memberStore.delete(member.id);
      for (const invite of invites) inviteStore.delete(invite.id);
      await done;
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  async listMembers(teamId: string): Promise<CollaborationMember[]> {
    const normalizedTeamId = normalizeId(teamId);
    const transaction = this.database.transaction(PERSONAL_WEB_STORE_NAMES.collaborationMembers, 'readonly');
    const records = await requestResult<WebMemberRecord[]>(
      transaction
        .objectStore(PERSONAL_WEB_STORE_NAMES.collaborationMembers)
        .index('teamJoined')
        .getAll(normalizedTeamId)
    );
    return records
      .map(({ memberKey: _memberKey, ...member }) => member)
      .toSorted((left, right) => left.joinedAt - right.joinedAt || left.id.localeCompare(right.id));
  }

  async createInviteCode(input: CollaborationInviteCreateInput): Promise<CollaborationInviteCode> {
    const teamId = normalizeId(input.teamId);
    const maxUses = Math.min(100, Math.max(1, Math.trunc(input.maxUses ?? 10)));
    const expiresInDays = Math.min(90, Math.max(1, Math.trunc(input.expiresInDays ?? 14)));
    const expiresAt = this.now() + expiresInDays * 24 * 60 * 60 * 1000;
    const inviteStore = this.database
      .transaction(PERSONAL_WEB_STORE_NAMES.collaborationInviteCodes, 'readwrite')
      .objectStore(PERSONAL_WEB_STORE_NAMES.collaborationInviteCodes);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = `ZX-${generateCodeBody()}`;
      const existing = await requestResult<CollaborationInviteCode | undefined>(inviteStore.index('code').get(code));
      if (existing) continue;
      const invite: CollaborationInviteCode = {
        id: this.randomUUID(),
        teamId,
        code,
        maxUses,
        useCount: 0,
        expiresAt,
        revokedAt: null,
        createdAt: this.now(),
      };
      inviteStore.add(invite);
      return invite;
    }
    throw new Error('COLLABORATION_INVITE_CODE_GENERATION_FAILED');
  }

  async listInviteCodes(teamId: string): Promise<CollaborationInviteCode[]> {
    const normalizedTeamId = normalizeId(teamId);
    const transaction = this.database.transaction(PERSONAL_WEB_STORE_NAMES.collaborationInviteCodes, 'readonly');
    const invites = await requestResult<CollaborationInviteCode[]>(
      transaction
        .objectStore(PERSONAL_WEB_STORE_NAMES.collaborationInviteCodes)
        .index('teamCreated')
        .getAll(normalizedTeamId)
    );
    return invites.toSorted((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id));
  }

  async revokeInviteCode(input: { id: string }): Promise<CollaborationInviteCode> {
    const transaction = this.database.transaction(PERSONAL_WEB_STORE_NAMES.collaborationInviteCodes, 'readwrite');
    const store = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.collaborationInviteCodes);
    const current = await requestResult<CollaborationInviteCode | undefined>(store.get(normalizeId(input.id)));
    if (!current) throw new Error('COLLABORATION_INVITE_NOT_FOUND');
    const updated: CollaborationInviteCode = { ...current, revokedAt: this.now() };
    store.put(updated);
    return updated;
  }

  async joinByInviteCode(input: { code: string; displayName: string }): Promise<CollaborationJoinResult> {
    const code = normalizeInviteCode(input.code);
    const displayName = normalizeDisplayName(input.displayName);
    const transaction = this.database.transaction(
      [
        PERSONAL_WEB_STORE_NAMES.collaborationInviteCodes,
        PERSONAL_WEB_STORE_NAMES.collaborationMembers,
        PERSONAL_WEB_STORE_NAMES.collaborationMessages,
      ],
      'readwrite'
    );
    const done = transactionDone(transaction);
    try {
      const inviteStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.collaborationInviteCodes);
      const memberStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.collaborationMembers);
      const messageStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.collaborationMessages);
      const invite = await requestResult<CollaborationInviteCode | undefined>(inviteStore.index('code').get(code));
      if (!invite) throw new Error('COLLABORATION_INVITE_NOT_FOUND');
      if (invite.revokedAt !== null) throw new Error('COLLABORATION_INVITE_REVOKED');
      if (invite.expiresAt !== null && this.now() > invite.expiresAt) throw new Error('COLLABORATION_INVITE_EXPIRED');
      if (invite.useCount >= invite.maxUses) throw new Error('COLLABORATION_INVITE_EXHAUSTED');
      const memberKey = displayName.trim().toLocaleLowerCase();
      const existing = await requestResult<WebMemberRecord | undefined>(
        memberStore.index('teamKey').get([invite.teamId, memberKey])
      );
      if (existing) throw new Error('COLLABORATION_MEMBER_DUPLICATE');
      const member: WebMemberRecord = {
        id: this.randomUUID(),
        teamId: invite.teamId,
        displayName,
        memberKey,
        role: 'member',
        joinedVia: 'invite-code',
        joinedAt: this.now(),
      };
      memberStore.add(member);
      inviteStore.put({ ...invite, useCount: invite.useCount + 1 });
      messageStore.add({
        id: this.randomUUID(),
        teamId: invite.teamId,
        threadId: this.randomUUID(),
        senderKind: 'system',
        senderSlotId: null,
        targetMode: 'members',
        targetSlotIds: [],
        kind: 'progress',
        content: `${displayName} joined the group via invite code`,
        fileRefs: [],
        sourceEventId: `invite-join:${member.id}`,
        conversationId: null,
        createdAt: this.now(),
        updatedAt: this.now(),
      } satisfies CollaborationMessage);
      await done;
      const { memberKey: _memberKey, ...joined } = member;
      return { teamId: invite.teamId, member: joined };
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  async removeMember(input: { teamId: string; memberId: string }): Promise<void> {
    const teamId = normalizeId(input.teamId);
    const memberId = normalizeId(input.memberId);
    const transaction = this.database.transaction(
      [PERSONAL_WEB_STORE_NAMES.collaborationMembers, PERSONAL_WEB_STORE_NAMES.collaborationMessages],
      'readwrite'
    );
    const done = transactionDone(transaction);
    try {
      const memberStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.collaborationMembers);
      const member = await requestResult<WebMemberRecord | undefined>(memberStore.get(memberId));
      if (!member || member.teamId !== teamId) throw new Error('COLLABORATION_MEMBER_NOT_FOUND');
      if (member.role === 'owner') throw new Error('COLLABORATION_MEMBER_IS_OWNER');
      memberStore.delete(memberId);
      const messageStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.collaborationMessages);
      messageStore.add({
        id: this.randomUUID(),
        teamId,
        threadId: this.randomUUID(),
        senderKind: 'system',
        senderSlotId: null,
        targetMode: 'members',
        targetSlotIds: [],
        kind: 'progress',
        content: `${member.displayName} was removed from the group`,
        fileRefs: [],
        sourceEventId: `invite-leave:${memberId}:${this.now()}`,
        conversationId: null,
        createdAt: this.now(),
        updatedAt: this.now(),
      } satisfies CollaborationMessage);
      await done;
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }
}

export async function openGroupDatabase(options: OpenGroupDatabaseOptions = {}): Promise<GroupDatabase> {
  const factory = options.factory ?? globalThis.indexedDB;
  if (!factory) throw new Error('COLLABORATION_INDEXEDDB_UNAVAILABLE');
  const database = await openPersonalWebDatabase(factory, options.name ?? PERSONAL_WEB_DATABASE_NAME);
  return new GroupDatabase(database, options.now ?? Date.now, options.randomUUID ?? (() => crypto.randomUUID()));
}

function normalizeId(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error('COLLABORATION_ID_REQUIRED');
  return normalized;
}

function normalizeContent(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error('COLLABORATION_CONTENT_REQUIRED');
  return normalized;
}

function normalizeTargets(values: string[]): string[] {
  const targets = [...new Set(values.map(normalizeId))];
  if (targets.length === 0) throw new Error('COLLABORATION_TARGET_REQUIRED');
  return targets;
}

function generateCodeBody(): string {
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

async function abortTransaction(transaction: IDBTransaction, done: Promise<void>): Promise<void> {
  try {
    transaction.abort();
  } catch {
    // A failed request may already have aborted or completed the transaction.
  }
  await done.catch((): undefined => undefined);
}
