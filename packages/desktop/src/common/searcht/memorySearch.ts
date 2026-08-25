import type {
  MemoryItem,
  MemoryRetrievalHit,
  MemoryRetrievalOptions,
  MemoryScope,
} from '@/common/types/searcht/memory';
import { normalizeMemoryListLimit, normalizeMemoryScope } from './memoryValidation';

export function tokenizeMemoryQuery(value: string): string[] {
  return [
    ...new Set(
      value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? []
    ),
  ];
}

export function rankMemoriesForRetrieval(
  memories: readonly MemoryItem[],
  options: MemoryRetrievalOptions
): MemoryRetrievalHit[] {
  const scopes = new Set(options.scopes.map((scope) => memoryScopeKey(normalizeMemoryScope(scope))));
  const normalizedQuery = tokenizeMemoryQuery(options.query).join(' ');
  const tokens = tokenizeMemoryQuery(options.query);
  const limit = normalizeMemoryListLimit(options.limit);

  return memories
    .filter((memory) => memory.expiresAt === null || memory.expiresAt > options.now)
    .filter((memory) => scopes.has(memoryScopeKey(memory.scope)))
    .filter((memory) => options.includeSensitive || memory.sensitivity !== 'sensitive')
    .map((memory) => ({ memory, score: scoreMemory(memory, normalizedQuery, tokens) }))
    .filter((result) => tokens.length === 0 || result.score > 0)
    .toSorted(
      (left, right) =>
        right.score - left.score ||
        right.memory.updatedAt - left.memory.updatedAt ||
        left.memory.id.localeCompare(right.memory.id)
    )
    .slice(0, limit);
}

export function memoryScopeKey(scope: MemoryScope): string {
  return scope.kind === 'global' ? 'global' : `${scope.kind}:${scope.id ?? ''}`;
}

function scoreMemory(memory: MemoryItem, normalizedQuery: string, tokens: readonly string[]): number {
  if (tokens.length === 0) return 0;
  const normalizedContent = tokenizeMemoryQuery(memory.content).join(' ');
  if (normalizedContent === normalizedQuery) return 1_000;
  let score = normalizedContent.includes(normalizedQuery) ? 400 : 0;
  for (const token of tokens) {
    if (normalizedContent.includes(token)) score += 100;
  }
  return score;
}
