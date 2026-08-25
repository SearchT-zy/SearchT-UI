export const KNOWLEDGE_SOURCE_TYPES = ['note', 'inbox-item'] as const;
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

export type KnowledgeSource = {
  id: string;
  sourceType: KnowledgeSourceType;
  sourceId: string;
  title: string;
  contentText: string;
  contentHash: string;
  indexedAt: number;
  createdAt: number;
  updatedAt: number;
};

export type KnowledgeSearchQuery = {
  query: string;
  sourceTypes?: KnowledgeSourceType[];
  limit?: number;
};

export type KnowledgeSearchHit = {
  source: KnowledgeSource;
  snippet: string;
  score: number;
};

export type KnowledgeSearchResult = {
  hits: KnowledgeSearchHit[];
  total: number;
};

export type KnowledgeIndexStatus = {
  sourceCount: number;
  noteCount: number;
  inboxCount: number;
  lastIndexedAt: number | null;
};

export type KnowledgeRebuildResult = {
  indexedCount: number;
  failedCount: number;
  completedAt: number;
};

export type KnowledgeInboxIndexInput = {
  sourceId: string;
  operationId: string;
};

export type KnowledgeInboxIndexResult = {
  source: KnowledgeSource;
  targetId: string;
  alreadyCompleted: boolean;
};

export interface KnowledgeClient {
  search(query: KnowledgeSearchQuery): Promise<KnowledgeSearchResult>;
  getStatus(): Promise<KnowledgeIndexStatus>;
  rebuild(): Promise<KnowledgeRebuildResult>;
  removeSource(id: string): Promise<void>;
  indexInbox(input: KnowledgeInboxIndexInput): Promise<KnowledgeInboxIndexResult>;
}
