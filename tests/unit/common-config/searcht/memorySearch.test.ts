import { describe, expect, it } from 'vitest';
import type { MemoryItem } from '@/common/types/searcht/memory';
import { rankMemoriesForRetrieval } from '@/common/searcht/memorySearch';

const baseMemory: MemoryItem = {
  id: 'memory-base',
  content: 'Prefers concise weekly product summaries',
  memoryType: 'preference',
  scope: { kind: 'workspace', id: 'workspace-1' },
  sensitivity: 'normal',
  confidence: 0.9,
  reason: 'Repeated request',
  sourceReferences: [],
  confirmedAt: 10,
  expiresAt: null,
  reviewAt: null,
  lastRetrievedAt: null,
  createdAt: 10,
  updatedAt: 20,
};

describe('memory retrieval ranking', () => {
  it('returns only active memories inside explicit scopes', () => {
    const memories: MemoryItem[] = [
      baseMemory,
      { ...baseMemory, id: 'other-workspace', scope: { kind: 'workspace', id: 'workspace-2' } },
      { ...baseMemory, id: 'expired', expiresAt: 99 },
    ];

    expect(
      rankMemoriesForRetrieval(memories, {
        query: 'weekly summary',
        scopes: [{ kind: 'workspace', id: 'workspace-1' }],
        includeSensitive: false,
        limit: 10,
        now: 100,
      }).map((result) => result.memory.id)
    ).toEqual(['memory-base']);
  });

  it('excludes sensitive memories unless the caller is explicitly authorized', () => {
    const sensitive = { ...baseMemory, id: 'sensitive', sensitivity: 'sensitive' as const };
    const query = {
      query: 'weekly',
      scopes: [{ kind: 'workspace' as const, id: 'workspace-1' }],
      limit: 10,
      now: 100,
    };

    expect(rankMemoriesForRetrieval([sensitive], { ...query, includeSensitive: false })).toEqual([]);
    expect(rankMemoriesForRetrieval([sensitive], { ...query, includeSensitive: true })[0]?.memory.id).toBe('sensitive');
  });

  it('ranks exact content matches before token matches with deterministic ties', () => {
    const exact = { ...baseMemory, id: 'exact', content: 'weekly product summary', updatedAt: 1 };
    const token = {
      ...baseMemory,
      id: 'token',
      content: 'Product notes for the weekly planning session',
      updatedAt: 30,
    };
    const tieA = { ...baseMemory, id: 'a', content: 'weekly roadmap', updatedAt: 40 };
    const tieB = { ...baseMemory, id: 'b', content: 'weekly roadmap', updatedAt: 40 };

    expect(
      rankMemoriesForRetrieval([tieB, token, exact, tieA], {
        query: 'weekly product summary',
        scopes: [{ kind: 'workspace', id: 'workspace-1' }],
        includeSensitive: false,
        limit: 10,
        now: 100,
      }).map((result) => result.memory.id)
    ).toEqual(['exact', 'token', 'a', 'b']);
  });

  it('treats punctuation-only queries as a recent-memory request', () => {
    expect(
      rankMemoriesForRetrieval([baseMemory, { ...baseMemory, id: 'newer', updatedAt: 30 }], {
        query: '... ???',
        scopes: [{ kind: 'workspace', id: 'workspace-1' }],
        includeSensitive: false,
        limit: 10,
        now: 100,
      }).map((result) => result.memory.id)
    ).toEqual(['newer', 'memory-base']);
  });
});
