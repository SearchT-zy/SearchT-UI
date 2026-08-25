import type { ChatFileRef } from '@/common/types/chatFile';

export type CollaborationTargetMode = 'coordinator' | 'members' | 'all';
export type CollaborationSenderKind = 'user' | 'agent' | 'system';
export type CollaborationMessageKind = 'instruction' | 'progress' | 'handoff' | 'result' | 'approval' | 'error';
export type CollaborationDeliveryStatus =
  | 'pending'
  | 'accepted'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown';

export type CollaborationMessage = {
  id: string;
  teamId: string;
  threadId: string;
  senderKind: CollaborationSenderKind;
  senderSlotId: string | null;
  targetMode: CollaborationTargetMode;
  targetSlotIds: string[];
  kind: CollaborationMessageKind;
  content: string;
  fileRefs: ChatFileRef[];
  sourceEventId: string | null;
  conversationId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type CollaborationDelivery = {
  id: string;
  messageId: string;
  targetSlotId: string;
  teamRunId: string | null;
  status: CollaborationDeliveryStatus;
  errorCode: string | null;
  errorDetail: string | null;
  attemptCount: number;
  lastAttemptAt: number | null;
};

export type CollaborationCreateInput = {
  messageId: string;
  teamId: string;
  content: string;
  targetMode: CollaborationTargetMode;
  targetSlotIds: string[];
  fileRefs: ChatFileRef[];
};

export type CollaborationAppendEventInput = {
  teamId: string;
  sourceEventId: string;
  senderKind: Exclude<CollaborationSenderKind, 'user'>;
  senderSlotId: string | null;
  kind: Exclude<CollaborationMessageKind, 'instruction'>;
  content: string;
  conversationId?: string | null;
  createdAt: number;
};

export type CollaborationDeliveryUpdate = {
  messageId: string;
  targetSlotId: string;
  status: CollaborationDeliveryStatus;
  teamRunId?: string | null;
  errorCode?: string | null;
  errorDetail?: string | null;
};

export type CollaborationRunDeliveryUpdate = {
  teamId: string;
  teamRunId: string;
  status: CollaborationDeliveryStatus;
};

export type CollaborationSnapshot = {
  messages: CollaborationMessage[];
  deliveries: CollaborationDelivery[];
};

export type CollaborationMemberRole = 'owner' | 'member';
export type CollaborationMemberJoinedVia = 'creator' | 'invite-code';

export type CollaborationMember = {
  id: string;
  teamId: string;
  displayName: string;
  role: CollaborationMemberRole;
  joinedVia: CollaborationMemberJoinedVia;
  joinedAt: number;
};

export type CollaborationInviteCode = {
  id: string;
  teamId: string;
  code: string;
  maxUses: number;
  useCount: number;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
};

export type CollaborationInviteCreateInput = {
  teamId: string;
  maxUses?: number;
  expiresInDays?: number;
};

export type CollaborationJoinInput = {
  code: string;
  displayName: string;
};

export type CollaborationJoinResult = {
  teamId: string;
  member: CollaborationMember;
};

export type CollaborationInviteClient = {
  listMembers: (teamId: string) => Promise<CollaborationMember[]>;
  createInviteCode: (input: CollaborationInviteCreateInput) => Promise<CollaborationInviteCode>;
  listInviteCodes: (teamId: string) => Promise<CollaborationInviteCode[]>;
  revokeInviteCode: (input: { id: string }) => Promise<CollaborationInviteCode>;
  joinByInviteCode: (input: CollaborationJoinInput) => Promise<CollaborationJoinResult>;
  removeMember: (input: { teamId: string; memberId: string }) => Promise<void>;
};

export type CollaborationClient = {
  list: (teamId: string, limit?: number) => Promise<CollaborationSnapshot>;
  createInstruction: (input: CollaborationCreateInput) => Promise<CollaborationSnapshot>;
  appendEvent: (input: CollaborationAppendEventInput) => Promise<CollaborationMessage>;
  updateDelivery: (input: CollaborationDeliveryUpdate) => Promise<CollaborationDelivery>;
  updateDeliveryByRun: (input: CollaborationRunDeliveryUpdate) => Promise<CollaborationDelivery[]>;
  removeTeam: (teamId: string) => Promise<void>;
} & CollaborationInviteClient;
