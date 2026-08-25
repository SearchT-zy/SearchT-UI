import { isChatFileRef, type ChatFileRef } from '@/common/types/chatFile';
import type {
  CollaborationAppendEventInput,
  CollaborationCreateInput,
  CollaborationDelivery,
  CollaborationDeliveryStatus,
  CollaborationDeliveryUpdate,
  CollaborationInviteCode,
  CollaborationMember,
  CollaborationMessage,
  CollaborationRunDeliveryUpdate,
  CollaborationSnapshot,
} from '@/common/types/searcht/collaboration';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';

type MessageRow = {
  id: string;
  team_id: string;
  thread_id: string;
  sender_kind: CollaborationMessage['senderKind'];
  sender_slot_id: string | null;
  target_mode: CollaborationMessage['targetMode'];
  target_slot_ids_json: string;
  kind: CollaborationMessage['kind'];
  content: string;
  file_refs_json: string;
  source_event_id: string | null;
  conversation_id: string | null;
  created_at: number;
  updated_at: number;
};

type DeliveryRow = {
  id: string;
  message_id: string;
  target_slot_id: string;
  team_run_id: string | null;
  status: CollaborationDeliveryStatus;
  error_code: string | null;
  error_detail: string | null;
  attempt_count: number;
  last_attempt_at: number | null;
};

type MemberRow = {
  id: string;
  team_id: string;
  display_name: string;
  member_key: string;
  role: CollaborationMember['role'];
  joined_via: CollaborationMember['joinedVia'];
  joined_at: number;
};

type InviteCodeRow = {
  id: string;
  team_id: string;
  code: string;
  max_uses: number;
  use_count: number;
  expires_at: number | null;
  revoked_at: number | null;
  created_at: number;
};

const DEFAULT_LIST_LIMIT = 500;

export class CollaborationRepository {
  constructor(
    private readonly driver: ISqliteDriver,
    private readonly now: () => number = Date.now,
    private readonly randomUUID: () => string = () => crypto.randomUUID()
  ) {}

  createInstruction(input: CollaborationCreateInput): CollaborationSnapshot {
    const operation = this.driver.transaction(() => {
      const existing = this.findMessageById(input.messageId);
      if (existing) return;
      const now = this.now();
      this.driver
        .prepare(`INSERT INTO collaboration_messages (
          id, team_id, thread_id, sender_kind, sender_slot_id, target_mode, target_slot_ids_json,
          kind, content, file_refs_json, source_event_id, conversation_id, created_at, updated_at
        ) VALUES (?, ?, ?, 'user', NULL, ?, ?, 'instruction', ?, ?, NULL, NULL, ?, ?)`)
        .run(
          input.messageId,
          input.teamId,
          input.messageId,
          input.targetMode,
          JSON.stringify(input.targetSlotIds),
          input.content,
          JSON.stringify(input.fileRefs),
          now,
          now
        );
      const insertDelivery = this.driver.prepare(`INSERT INTO collaboration_deliveries (
        id, message_id, target_slot_id, team_run_id, status, error_code, error_detail, attempt_count, last_attempt_at
      ) VALUES (?, ?, ?, NULL, 'pending', NULL, NULL, 0, NULL)`);
      for (const targetSlotId of input.targetSlotIds) {
        insertDelivery.run(this.randomUUID(), input.messageId, targetSlotId);
      }
    });
    operation();
    return this.list(input.teamId);
  }

  appendEvent(input: CollaborationAppendEventInput): CollaborationMessage {
    const existing = this.findMessageBySourceEventId(input.sourceEventId);
    if (existing) return existing;
    const id = this.randomUUID();
    this.driver
      .prepare(`INSERT INTO collaboration_messages (
        id, team_id, thread_id, sender_kind, sender_slot_id, target_mode, target_slot_ids_json,
        kind, content, file_refs_json, source_event_id, conversation_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'members', '[]', ?, ?, '[]', ?, ?, ?, ?)`)
      .run(
        id,
        input.teamId,
        id,
        input.senderKind,
        input.senderSlotId,
        input.kind,
        input.content,
        input.sourceEventId,
        input.conversationId ?? null,
        input.createdAt,
        input.createdAt
      );
    return this.findMessageById(id)!;
  }

  list(teamId: string, limit = DEFAULT_LIST_LIMIT): CollaborationSnapshot {
    const messages = (
      this.driver
        .prepare('SELECT * FROM collaboration_messages WHERE team_id = ? ORDER BY created_at ASC, id ASC LIMIT ?')
        .all(teamId, limit) as MessageRow[]
    ).map(mapMessage);
    if (messages.length === 0) return { messages: [], deliveries: [] };
    const deliveries = (
      this.driver
        .prepare(`SELECT delivery.* FROM collaboration_deliveries delivery
          JOIN collaboration_messages message ON message.id = delivery.message_id
          WHERE message.team_id = ?
          ORDER BY message.created_at ASC, message.id ASC`)
        .all(teamId) as DeliveryRow[]
    ).map(mapDelivery);
    const messageOrder = new Map(messages.map((message, index) => [message.id, index]));
    const targetOrder = new Map(
      messages.flatMap((message) =>
        message.targetSlotIds.map((slotId, index) => [`${message.id}\0${slotId}`, index] as const)
      )
    );
    deliveries.sort((left, right) => {
      const byMessage = (messageOrder.get(left.messageId) ?? 0) - (messageOrder.get(right.messageId) ?? 0);
      if (byMessage !== 0) return byMessage;
      return (
        (targetOrder.get(`${left.messageId}\0${left.targetSlotId}`) ?? 0) -
        (targetOrder.get(`${right.messageId}\0${right.targetSlotId}`) ?? 0)
      );
    });
    return { messages, deliveries };
  }

  updateDelivery(input: CollaborationDeliveryUpdate): CollaborationDelivery {
    const current = this.findDelivery(input.messageId, input.targetSlotId);
    if (!current) throw new Error('COLLABORATION_DELIVERY_NOT_FOUND');
    const recordsAttempt = ['accepted', 'failed', 'unknown'].includes(input.status);
    const attemptCount = recordsAttempt ? Math.max(1, current.attemptCount) : current.attemptCount;
    const lastAttemptAt = recordsAttempt ? this.now() : current.lastAttemptAt;
    this.driver
      .prepare(`UPDATE collaboration_deliveries SET team_run_id = ?, status = ?, error_code = ?, error_detail = ?,
        attempt_count = ?, last_attempt_at = ? WHERE message_id = ? AND target_slot_id = ?`)
      .run(
        input.teamRunId === undefined ? current.teamRunId : input.teamRunId,
        input.status,
        input.errorCode === undefined ? current.errorCode : input.errorCode,
        input.errorDetail === undefined ? current.errorDetail : input.errorDetail,
        attemptCount,
        lastAttemptAt,
        input.messageId,
        input.targetSlotId
      );
    return this.findDelivery(input.messageId, input.targetSlotId)!;
  }

  updateDeliveryByRun(input: CollaborationRunDeliveryUpdate): CollaborationDelivery[] {
    const rows = this.driver
      .prepare(`SELECT delivery.* FROM collaboration_deliveries delivery
        JOIN collaboration_messages message ON message.id = delivery.message_id
        WHERE message.team_id = ? AND delivery.team_run_id = ?
        ORDER BY delivery.target_slot_id ASC`)
      .all(input.teamId, input.teamRunId) as DeliveryRow[];
    for (const row of rows) {
      this.driver.prepare('UPDATE collaboration_deliveries SET status = ? WHERE id = ?').run(input.status, row.id);
    }
    return rows.map((row) => ({ ...mapDelivery(row), status: input.status }));
  }

  removeTeam(teamId: string): void {
    const operation = this.driver.transaction(() => {
      this.driver.prepare('DELETE FROM collaboration_messages WHERE team_id = ?').run(teamId);
      this.driver.prepare('DELETE FROM collaboration_members WHERE team_id = ?').run(teamId);
      this.driver.prepare('DELETE FROM collaboration_invite_codes WHERE team_id = ?').run(teamId);
    });
    operation();
  }

  listMembers(teamId: string): CollaborationMember[] {
    const rows = this.driver
      .prepare('SELECT * FROM collaboration_members WHERE team_id = ? ORDER BY joined_at ASC, id ASC')
      .all(teamId) as MemberRow[];
    return rows.map(mapMember);
  }

  insertMember(member: Omit<CollaborationMember, 'id' | 'joinedAt'> & { id?: string }): CollaborationMember {
    const now = this.now();
    this.driver
      .prepare(`INSERT INTO collaboration_members (
        id, team_id, display_name, member_key, role, joined_via, joined_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(
        member.id ?? this.randomUUID(),
        member.teamId,
        member.displayName,
        memberKey(member.displayName),
        member.role,
        member.joinedVia,
        now
      );
    const row = this.driver
      .prepare('SELECT * FROM collaboration_members WHERE team_id = ? AND member_key = ?')
      .get(member.teamId, memberKey(member.displayName)) as MemberRow;
    return mapMember(row);
  }

  removeMember(teamId: string, memberId: string): void {
    this.driver.prepare('DELETE FROM collaboration_members WHERE team_id = ? AND id = ?').run(teamId, memberId);
  }

  insertInviteCode(input: { teamId: string; code: string; maxUses: number; expiresAt: number | null }): void {
    this.driver
      .prepare(`INSERT INTO collaboration_invite_codes (
        id, team_id, code, max_uses, use_count, expires_at, revoked_at, created_at
      ) VALUES (?, ?, ?, ?, 0, ?, NULL, ?)`)
      .run(this.randomUUID(), input.teamId, input.code, input.maxUses, input.expiresAt, this.now());
  }

  listInviteCodes(teamId: string): CollaborationInviteCode[] {
    const rows = this.driver
      .prepare('SELECT * FROM collaboration_invite_codes WHERE team_id = ? ORDER BY created_at DESC, id DESC')
      .all(teamId) as InviteCodeRow[];
    return rows.map(mapInviteCode);
  }

  findInviteCodeById(id: string): CollaborationInviteCode | null {
    const row = this.driver.prepare('SELECT * FROM collaboration_invite_codes WHERE id = ?').get(id) as
      | InviteCodeRow
      | undefined;
    return row ? mapInviteCode(row) : null;
  }

  findInviteCodeByCode(code: string): CollaborationInviteCode | null {
    const row = this.driver.prepare('SELECT * FROM collaboration_invite_codes WHERE code = ?').get(code) as
      | InviteCodeRow
      | undefined;
    return row ? mapInviteCode(row) : null;
  }

  markInviteCodeRevoked(id: string): CollaborationInviteCode {
    this.driver.prepare('UPDATE collaboration_invite_codes SET revoked_at = ? WHERE id = ?').run(this.now(), id);
    return this.findInviteCodeById(id)!;
  }

  incrementInviteCodeUse(id: string): CollaborationInviteCode {
    this.driver.prepare('UPDATE collaboration_invite_codes SET use_count = use_count + 1 WHERE id = ?').run(id);
    return this.findInviteCodeById(id)!;
  }

  private findMessageById(id: string): CollaborationMessage | null {
    const row = this.driver.prepare('SELECT * FROM collaboration_messages WHERE id = ?').get(id) as
      | MessageRow
      | undefined;
    return row ? mapMessage(row) : null;
  }

  private findMessageBySourceEventId(sourceEventId: string): CollaborationMessage | null {
    const row = this.driver
      .prepare('SELECT * FROM collaboration_messages WHERE source_event_id = ?')
      .get(sourceEventId) as MessageRow | undefined;
    return row ? mapMessage(row) : null;
  }

  private findDelivery(messageId: string, targetSlotId: string): CollaborationDelivery | null {
    const row = this.driver
      .prepare('SELECT * FROM collaboration_deliveries WHERE message_id = ? AND target_slot_id = ?')
      .get(messageId, targetSlotId) as DeliveryRow | undefined;
    return row ? mapDelivery(row) : null;
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) throw new Error();
    return parsed;
  } catch {
    throw new Error('COLLABORATION_DATA_INVALID');
  }
}

function parseFileRefs(value: string): ChatFileRef[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every(isChatFileRef)) throw new Error();
    return parsed;
  } catch {
    throw new Error('COLLABORATION_DATA_INVALID');
  }
}

function mapMessage(row: MessageRow): CollaborationMessage {
  return {
    id: row.id,
    teamId: row.team_id,
    threadId: row.thread_id,
    senderKind: row.sender_kind,
    senderSlotId: row.sender_slot_id,
    targetMode: row.target_mode,
    targetSlotIds: parseStringArray(row.target_slot_ids_json),
    kind: row.kind,
    content: row.content,
    fileRefs: parseFileRefs(row.file_refs_json),
    sourceEventId: row.source_event_id,
    conversationId: row.conversation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDelivery(row: DeliveryRow): CollaborationDelivery {
  return {
    id: row.id,
    messageId: row.message_id,
    targetSlotId: row.target_slot_id,
    teamRunId: row.team_run_id,
    status: row.status,
    errorCode: row.error_code,
    errorDetail: row.error_detail,
    attemptCount: row.attempt_count,
    lastAttemptAt: row.last_attempt_at,
  };
}

function mapMember(row: MemberRow): CollaborationMember {
  return {
    id: row.id,
    teamId: row.team_id,
    displayName: row.display_name,
    role: row.role,
    joinedVia: row.joined_via,
    joinedAt: row.joined_at,
  };
}

function mapInviteCode(row: InviteCodeRow): CollaborationInviteCode {
  return {
    id: row.id,
    teamId: row.team_id,
    code: row.code,
    maxUses: row.max_uses,
    useCount: row.use_count,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

export function memberKey(displayName: string): string {
  return displayName.trim().toLocaleLowerCase();
}
