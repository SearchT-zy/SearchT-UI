import {
  MEMORY_SCOPE_KINDS,
  MEMORY_SENSITIVITIES,
  MEMORY_SOURCE_KINDS,
  MEMORY_TYPES,
  type MemoryCandidateSubmitInput,
  type MemoryScope,
  type MemoryScopeKind,
  type MemorySensitivity,
  type MemorySourceReference,
  type MemoryType,
} from '@/common/types/searcht/memory';

export const MEMORY_CONTENT_MAX_LENGTH = 4_000;
export const MEMORY_REASON_MAX_LENGTH = 1_000;
export const MEMORY_LIST_DEFAULT_LIMIT = 50;
export const MEMORY_LIST_MAX_LIMIT = 200;

const memoryTypeSet = new Set<string>(MEMORY_TYPES);
const scopeKindSet = new Set<string>(MEMORY_SCOPE_KINDS);
const sensitivitySet = new Set<string>(MEMORY_SENSITIVITIES);
const sourceKindSet = new Set<string>(MEMORY_SOURCE_KINDS);

export function normalizeMemoryContent(content: string): string {
  const normalized = requiredText(content, 'MEMORY_CONTENT_REQUIRED');
  if (normalized.length > MEMORY_CONTENT_MAX_LENGTH) throw new Error('MEMORY_CONTENT_TOO_LONG');
  return normalized;
}

export function normalizeMemoryReason(reason: string): string {
  const normalized = requiredText(reason, 'MEMORY_REASON_REQUIRED');
  if (normalized.length > MEMORY_REASON_MAX_LENGTH) throw new Error('MEMORY_REASON_TOO_LONG');
  return normalized;
}

export function normalizeMemoryType(memoryType: string): MemoryType {
  if (!memoryTypeSet.has(memoryType)) throw new Error('MEMORY_TYPE_INVALID');
  return memoryType as MemoryType;
}

export function normalizeMemorySensitivity(sensitivity: string): MemorySensitivity {
  if (!sensitivitySet.has(sensitivity)) throw new Error('MEMORY_SENSITIVITY_INVALID');
  return sensitivity as MemorySensitivity;
}

export function normalizeMemoryScope(scope: MemoryScope): MemoryScope {
  if (!scopeKindSet.has(scope.kind)) throw new Error('MEMORY_SCOPE_INVALID');
  if (scope.kind === 'global') return { kind: 'global', id: null };
  return {
    kind: scope.kind as Exclude<MemoryScopeKind, 'global'>,
    id: requiredText(scope.id ?? '', 'MEMORY_SCOPE_ID_REQUIRED'),
  };
}

export function normalizeMemoryConfidence(confidence: number): number {
  if (!Number.isFinite(confidence)) throw new Error('MEMORY_CONFIDENCE_INVALID');
  return Math.max(0, Math.min(confidence, 1));
}

export function normalizeMemorySources(sources: readonly MemorySourceReference[]): MemorySourceReference[] {
  const deduplicated = new Map<string, MemorySourceReference>();
  for (const source of sources) {
    if (!sourceKindSet.has(source.kind)) throw new Error('MEMORY_SOURCE_KIND_INVALID');
    const id = requiredText(source.id, 'MEMORY_SOURCE_ID_REQUIRED');
    const label = source.label?.trim();
    const normalized: MemorySourceReference = {
      kind: source.kind,
      id,
      ...(label ? { label } : {}),
    };
    const key = `${source.kind}:${id}`;
    if (!deduplicated.has(key)) deduplicated.set(key, normalized);
  }
  return [...deduplicated.values()];
}

export function normalizeMemoryTimestamp(value: number | null, errorCode: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(errorCode);
  return value;
}

export function normalizeMemoryId(id: string): string {
  return requiredText(id, 'MEMORY_ID_REQUIRED');
}

export function normalizeMemoryListLimit(limit?: number): number {
  if (limit === undefined) return MEMORY_LIST_DEFAULT_LIMIT;
  if (!Number.isFinite(limit)) throw new Error('MEMORY_LIMIT_INVALID');
  return Math.max(1, Math.min(Math.trunc(limit), MEMORY_LIST_MAX_LIMIT));
}

export function normalizeMemoryCandidateInput(input: MemoryCandidateSubmitInput): MemoryCandidateSubmitInput {
  return {
    operationId: requiredText(input.operationId, 'MEMORY_OPERATION_ID_REQUIRED'),
    content: normalizeMemoryContent(input.content),
    memoryType: normalizeMemoryType(input.memoryType),
    proposedScope: normalizeMemoryScope(input.proposedScope),
    sensitivity: normalizeMemorySensitivity(input.sensitivity),
    confidence: normalizeMemoryConfidence(input.confidence),
    reason: normalizeMemoryReason(input.reason),
    sourceReferences: normalizeMemorySources(input.sourceReferences),
    suggestedExpiresAt: normalizeMemoryTimestamp(input.suggestedExpiresAt, 'MEMORY_EXPIRY_INVALID'),
  };
}

function requiredText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}
