import type { KnowledgeSearchHit, KnowledgeSource, KnowledgeSourceType } from '../types/searcht/knowledge';

export const KNOWLEDGE_QUERY_MAX_LENGTH = 200;
export const KNOWLEDGE_QUERY_MAX_TOKENS = 12;
export const KNOWLEDGE_SEARCH_DEFAULT_LIMIT = 50;
export const KNOWLEDGE_SEARCH_MAX_LIMIT = 100;

export class KnowledgeSearchError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'KnowledgeSearchError';
    this.code = code;
  }
}

export function normalizeKnowledgeQuery(query?: string): string {
  const normalized = query?.trim() ?? '';
  if (Array.from(normalized).length > KNOWLEDGE_QUERY_MAX_LENGTH) {
    throw new KnowledgeSearchError('KNOWLEDGE_QUERY_TOO_LONG');
  }
  return normalized;
}

export function tokenizeKnowledgeQuery(query?: string): string[] {
  const normalized = normalizeKnowledgeQuery(query).toLocaleLowerCase();
  const words = normalized.match(/[\p{L}\p{N}_]+/gu) ?? [];
  return [...new Set(words)].slice(0, KNOWLEDGE_QUERY_MAX_TOKENS);
}

export function buildKnowledgeMatchQuery(query?: string): string | null {
  const tokens = tokenizeKnowledgeQuery(query);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(' AND ');
}

export function rankKnowledgeSources(
  sources: readonly KnowledgeSource[],
  query: string,
  limit = KNOWLEDGE_SEARCH_DEFAULT_LIMIT,
  sourceTypes?: readonly KnowledgeSourceType[]
): KnowledgeSearchHit[] {
  const normalizedQuery = normalizeKnowledgeQuery(query).toLocaleLowerCase();
  const tokens = tokenizeKnowledgeQuery(normalizedQuery);
  const allowed = sourceTypes?.length ? new Set(sourceTypes) : null;
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), KNOWLEDGE_SEARCH_MAX_LIMIT));

  return sources
    .filter((source) => !allowed || allowed.has(source.sourceType))
    .map((source): KnowledgeSearchHit | null => {
      const title = source.title.toLocaleLowerCase();
      const content = source.contentText.toLocaleLowerCase();
      const allTokensMatch = tokens.every((token) => title.includes(token) || content.includes(token));
      if (tokens.length > 0 && !allTokensMatch) return null;

      const exactTitleScore = normalizedQuery && title === normalizedQuery ? 10_000 : 0;
      const titleScore = tokens.filter((token) => title.includes(token)).length * 100;
      const bodyScore = tokens.filter((token) => content.includes(token)).length * 10;
      return {
        source,
        score: exactTitleScore + titleScore + bodyScore,
        snippet: buildKnowledgeSnippet(source.contentText || source.title, tokens),
      };
    })
    .filter((hit): hit is KnowledgeSearchHit => hit !== null)
    .toSorted(
      (left, right) =>
        right.score - left.score ||
        right.source.updatedAt - left.source.updatedAt ||
        left.source.id.localeCompare(right.source.id)
    )
    .slice(0, boundedLimit);
}

export function buildKnowledgeSnippet(text: string, tokens: readonly string[], maxLength = 180): string {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  if (normalized.length <= maxLength) return normalized;

  const lower = normalized.toLocaleLowerCase();
  const positions = tokens.map((token) => lower.indexOf(token)).filter((position) => position >= 0);
  const matchIndex = positions.length ? Math.min(...positions) : 0;
  let start = Math.max(0, matchIndex - Math.floor(maxLength / 3));
  const prefix = start > 0 ? '...' : '';
  let capacity = maxLength - prefix.length;
  let end = Math.min(normalized.length, start + capacity);
  let suffix = end < normalized.length ? '...' : '';
  if (suffix) {
    capacity -= suffix.length;
    end = Math.min(normalized.length, start + capacity);
  }
  if (end >= normalized.length) suffix = '';
  if (!prefix) start = 0;
  return `${prefix}${normalized.slice(start, end)}${suffix}`;
}
