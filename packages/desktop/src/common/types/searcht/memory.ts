export const MEMORY_TYPES = [
  'preference',
  'personal-fact',
  'relationship',
  'project-context',
  'operating-rule',
  'temporary-context',
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const MEMORY_SCOPE_KINDS = ['global', 'workspace', 'project', 'assistant'] as const;
export type MemoryScopeKind = (typeof MEMORY_SCOPE_KINDS)[number];

export const MEMORY_SENSITIVITIES = ['normal', 'sensitive'] as const;
export type MemorySensitivity = (typeof MEMORY_SENSITIVITIES)[number];

export const MEMORY_SOURCE_KINDS = ['conversation-message', 'note', 'inbox-item', 'workflow-run', 'manual'] as const;
export type MemorySourceKind = (typeof MEMORY_SOURCE_KINDS)[number];

export type MemoryScope = {
  kind: MemoryScopeKind;
  id: string | null;
};

export type MemorySourceReference = {
  kind: MemorySourceKind;
  id: string;
  label?: string;
};

export type MemoryCandidateSubmitInput = {
  operationId: string;
  content: string;
  memoryType: MemoryType;
  proposedScope: MemoryScope;
  sensitivity: MemorySensitivity;
  confidence: number;
  reason: string;
  sourceReferences: MemorySourceReference[];
  suggestedExpiresAt: number | null;
};

export type MemoryCandidate = MemoryCandidateSubmitInput & {
  id: string;
  createdAt: number;
  updatedAt: number;
};

export type MemoryCandidateListQuery = {
  limit?: number;
};

export type MemoryCandidateListResult = {
  candidates: MemoryCandidate[];
  total: number;
};

export type MemoryCandidateConfirmInput = {
  candidateId: string;
  content: string;
  memoryType: MemoryType;
  scope: MemoryScope;
  sensitivity: MemorySensitivity;
  confidence: number;
  reason: string;
  expiresAt: number | null;
  reviewAt: number | null;
};

export type MemoryCreateInput = {
  content: string;
  memoryType: MemoryType;
  scope: MemoryScope;
  sensitivity: MemorySensitivity;
  confidence: number;
  reason: string;
  sourceReferences?: MemorySourceReference[];
  expiresAt: number | null;
  reviewAt: number | null;
};

export type MemoryItem = {
  id: string;
  content: string;
  memoryType: MemoryType;
  scope: MemoryScope;
  sensitivity: MemorySensitivity;
  confidence: number;
  reason: string;
  sourceReferences: MemorySourceReference[];
  confirmedAt: number;
  expiresAt: number | null;
  reviewAt: number | null;
  lastRetrievedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type MemoryUpdateInput = Omit<MemoryCreateInput, 'sourceReferences'> & {
  id: string;
  sourceReferences: MemorySourceReference[];
};

export type MemoryView = 'active' | 'expired';

export type MemoryListQuery = {
  view: MemoryView;
  search?: string;
  memoryTypes?: MemoryType[];
  limit?: number;
  now?: number;
};

export type MemoryListResult = {
  memories: MemoryItem[];
  total: number;
};

export type MemoryRetrieveInput = {
  query: string;
  scopes: MemoryScope[];
  includeSensitive: boolean;
  limit?: number;
};

export type MemoryRetrievalOptions = MemoryRetrieveInput & {
  now: number;
};

export type MemoryRetrievalHit = {
  memory: MemoryItem;
  score: number;
};

export type MemoryRetrieveResult = {
  hits: MemoryRetrievalHit[];
};

export type MemoryStatus = {
  pendingCount: number;
  activeCount: number;
  expiredCount: number;
  sensitiveCount: number;
};

export type MemoryExport = {
  exportedAt: number;
  memories: MemoryItem[];
};

export type MemoryClient = {
  listCandidates(query?: MemoryCandidateListQuery): Promise<MemoryCandidateListResult>;
  submitCandidate(input: MemoryCandidateSubmitInput): Promise<MemoryCandidate>;
  confirmCandidate(input: MemoryCandidateConfirmInput): Promise<MemoryItem>;
  rejectCandidate(id: string): Promise<void>;
  listMemories(query: MemoryListQuery): Promise<MemoryListResult>;
  getMemory(id: string): Promise<MemoryItem | null>;
  createMemory(input: MemoryCreateInput): Promise<MemoryItem>;
  updateMemory(input: MemoryUpdateInput): Promise<MemoryItem>;
  forgetMemory(id: string): Promise<void>;
  retrieve(input: MemoryRetrieveInput): Promise<MemoryRetrieveResult>;
  getStatus(): Promise<MemoryStatus>;
  exportMemories(): Promise<MemoryExport>;
};
