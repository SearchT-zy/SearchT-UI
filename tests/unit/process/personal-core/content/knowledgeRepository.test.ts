import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { KnowledgeSource } from '@/common/types/searcht/knowledge';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { KnowledgeRepository } from '@process/services/personal-core/content/KnowledgeRepository';

let directory: string;
let database: PersonalDatabase;
let repository: KnowledgeRepository;

function source(overrides: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    id: 'source-1',
    sourceType: 'note',
    sourceId: 'note-1',
    title: 'Release plan',
    contentText: 'Prepare the final checklist',
    contentHash: 'hash-1',
    indexedAt: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-knowledge-repository-'));
  database = PersonalDatabase.open(directory);
  repository = new KnowledgeRepository(database.driver);
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('KnowledgeRepository', () => {
  it('upserts a source and replaces its searchable FTS text atomically', () => {
    repository.upsert(source());
    repository.upsert(source({ title: 'Launch checklist', contentText: 'Final verification', updatedAt: 2 }));

    expect(repository.search({ query: 'release' }).hits).toEqual([]);
    expect(repository.search({ query: 'launch' }).hits).toEqual([
      expect.objectContaining({ source: expect.objectContaining({ id: 'source-1', title: 'Launch checklist' }) }),
    ]);
  });

  it('uses safe token matching and deterministic title-first ranking', () => {
    repository.upsert(source({ id: 'body', sourceId: 'note-body', title: 'Checklist', contentText: 'release plan' }));
    repository.upsert(
      source({ id: 'title-token', sourceId: 'note-title', title: 'Release planning', contentText: '' })
    );
    repository.upsert(source({ id: 'exact', sourceId: 'note-exact', title: 'Release plan', contentText: '' }));

    const result = repository.search({ query: 'release: (plan) + ""' });

    expect(result.hits.map((hit) => hit.source.id)).toEqual(['exact', 'title-token', 'body']);
    expect(result.total).toBe(3);
  });

  it('returns recent filtered sources for blank search and applies a limit', () => {
    repository.upsert(source({ id: 'note', sourceId: 'note-1', updatedAt: 10 }));
    repository.upsert(source({ id: 'inbox-old', sourceType: 'inbox-item', sourceId: 'inbox-1', updatedAt: 20 }));
    repository.upsert(source({ id: 'inbox-new', sourceType: 'inbox-item', sourceId: 'inbox-2', updatedAt: 30 }));

    expect(repository.search({ query: '', sourceTypes: ['inbox-item'], limit: 1 })).toEqual({
      hits: [expect.objectContaining({ source: expect.objectContaining({ id: 'inbox-new' }) })],
      total: 2,
    });
  });

  it('reports source counts and removes both metadata and FTS rows', () => {
    repository.upsert(source({ id: 'note', sourceId: 'note-1', indexedAt: 10 }));
    repository.upsert(source({ id: 'inbox', sourceType: 'inbox-item', sourceId: 'inbox-1', indexedAt: 20 }));

    expect(repository.getStatus()).toEqual({ sourceCount: 2, noteCount: 1, inboxCount: 1, lastIndexedAt: 20 });
    repository.removeById('inbox');
    expect(repository.findById('inbox')).toBeNull();
    expect(repository.search({ query: 'release' }).total).toBe(1);
  });

  it('rebuilds missing FTS rows from source metadata', () => {
    repository.upsert(source());
    database.driver.prepare("DELETE FROM knowledge_fts WHERE source_id = 'source-1'").run();
    expect(repository.search({ query: 'release' }).hits).toEqual([]);

    repository.rebuildFts();

    expect(repository.search({ query: 'release' }).hits).toHaveLength(1);
  });
});
