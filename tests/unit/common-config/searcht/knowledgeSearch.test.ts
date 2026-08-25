import { describe, expect, it } from 'vitest';
import type { KnowledgeSource } from '@/common/types/searcht/knowledge';
import {
  buildKnowledgeMatchQuery,
  buildKnowledgeSnippet,
  normalizeKnowledgeQuery,
  rankKnowledgeSources,
  tokenizeKnowledgeQuery,
} from '@/common/searcht/knowledgeSearch';

function source(overrides: Partial<KnowledgeSource>): KnowledgeSource {
  return {
    id: 'source-1',
    sourceType: 'note',
    sourceId: 'note-1',
    title: 'Release plan',
    contentText: 'Prepare the final release checklist',
    contentHash: 'hash-1',
    indexedAt: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('knowledge query normalization', () => {
  it('extracts only searchable Unicode words from punctuation-heavy input', () => {
    expect(tokenizeKnowledgeQuery('  release: (plan) + "安全"  ')).toEqual(['release', 'plan', '安全']);
    expect(buildKnowledgeMatchQuery('release: (plan) + "安全"')).toBe('"release"* AND "plan"* AND "安全"*');
  });

  it('deduplicates tokens and treats a blank query as recent-source browsing', () => {
    expect(tokenizeKnowledgeQuery('Plan plan PLAN')).toEqual(['plan']);
    expect(normalizeKnowledgeQuery(' \n ')).toBe('');
    expect(buildKnowledgeMatchQuery(' \n ')).toBeNull();
  });

  it('rejects an overly long query without echoing private content', () => {
    const privateQuery = `secret-${'x'.repeat(300)}`;
    try {
      normalizeKnowledgeQuery(privateQuery);
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(error).toMatchObject({ message: 'KNOWLEDGE_QUERY_TOO_LONG' });
      expect(String(error)).not.toContain(privateQuery);
    }
  });
});

describe('browser knowledge ranking', () => {
  it('ranks exact titles above title tokens and body-only matches', () => {
    const ranked = rankKnowledgeSources(
      [
        source({ id: 'body', title: 'Checklist', contentText: 'release plan details', updatedAt: 30 }),
        source({ id: 'title-token', title: 'Release planning', contentText: '', updatedAt: 20 }),
        source({ id: 'exact', title: 'Release plan', contentText: '', updatedAt: 10 }),
      ],
      'release plan',
      10
    );

    expect(ranked.map((hit) => hit.source.id)).toEqual(['exact', 'title-token', 'body']);
  });

  it('uses update time and ID as deterministic tie breakers', () => {
    const ranked = rankKnowledgeSources(
      [
        source({ id: 'b', title: 'Plan', updatedAt: 20 }),
        source({ id: 'a', title: 'Plan', updatedAt: 20 }),
        source({ id: 'older', title: 'Plan', updatedAt: 10 }),
      ],
      'plan',
      10
    );

    expect(ranked.map((hit) => hit.source.id)).toEqual(['a', 'b', 'older']);
  });

  it('returns recent sources for a blank query and applies source filters and limits', () => {
    const ranked = rankKnowledgeSources(
      [
        source({ id: 'note', sourceType: 'note', updatedAt: 10 }),
        source({ id: 'inbox-new', sourceType: 'inbox-item', updatedAt: 30 }),
        source({ id: 'inbox-old', sourceType: 'inbox-item', updatedAt: 20 }),
      ],
      '',
      1,
      ['inbox-item']
    );

    expect(ranked.map((hit) => hit.source.id)).toEqual(['inbox-new']);
  });
});

describe('knowledge snippets', () => {
  it('centers a bounded snippet around the first match', () => {
    const snippet = buildKnowledgeSnippet(`${'a'.repeat(100)} release plan ${'b'.repeat(100)}`, ['release'], 80);
    expect(snippet).toContain('release plan');
    expect(snippet.length).toBeLessThanOrEqual(82);
    expect(snippet.startsWith('...')).toBe(true);
    expect(snippet.endsWith('...')).toBe(true);
  });
});
