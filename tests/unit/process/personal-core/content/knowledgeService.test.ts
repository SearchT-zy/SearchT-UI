import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { KnowledgeRepository } from '@process/services/personal-core/content/KnowledgeRepository';
import {
  KnowledgeService,
  type InboxKnowledgeContentReader,
} from '@process/services/personal-core/content/KnowledgeService';
import { NoteRepository } from '@process/services/personal-core/content/NoteRepository';

let directory: string;
let database: PersonalDatabase;
let reader: InboxKnowledgeContentReader;
let service: KnowledgeService;

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-knowledge-service-'));
  database = PersonalDatabase.open(directory);
  reader = { read: vi.fn(() => null) };
  service = new KnowledgeService(database.driver, reader);
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('KnowledgeService', () => {
  it('projects note content with a deterministic digest and refreshes changed content', () => {
    const note = {
      id: 'note-1',
      title: 'Plan',
      body: 'First body',
      revisionNumber: 1,
      archivedAt: null,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    };
    service.upsertNote(note, 10);
    const first = service.search({ query: 'first' }).hits[0]!.source;
    service.upsertNote({ ...note, body: 'Second body', revisionNumber: 2, updatedAt: 2 }, 20);
    const second = service.search({ query: 'second' }).hits[0]!.source;

    expect(first.id).toBe('knowledge-note-note-1');
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(second.contentHash).not.toBe(first.contentHash);
    expect(service.search({ query: 'first' }).hits).toEqual([]);
  });

  it('rebuilds active notes while excluding archived and deleted notes', () => {
    const notes = new NoteRepository(database.driver);
    notes.insertNote({
      id: 'active',
      title: 'Active plan',
      body: 'Search me',
      revisionNumber: 1,
      archivedAt: null,
      createdAt: 1,
      updatedAt: 3,
      deletedAt: null,
    });
    notes.insertNote({
      id: 'archived',
      title: 'Archived plan',
      body: 'Do not search',
      revisionNumber: 1,
      archivedAt: 4,
      createdAt: 1,
      updatedAt: 2,
      deletedAt: null,
    });
    notes.insertNote({
      id: 'deleted',
      title: 'Deleted plan',
      body: 'Do not search',
      revisionNumber: 1,
      archivedAt: null,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: 5,
    });

    expect(service.rebuild(100)).toEqual({ indexedCount: 1, failedCount: 0, completedAt: 100 });
    expect(service.search({ query: 'plan' }).hits.map((hit) => hit.source.sourceId)).toEqual(['active']);
  });

  it('rebuilds explicit Inbox sources from provenance and reports unavailable content', () => {
    database.driver
      .prepare(`INSERT INTO inbox_items (
        id, kind, state, title, text_content, url, origin_id, captured_at,
        organized_at, archived_at, created_at, updated_at, deleted_at
      ) VALUES ('inbox-ok', 'text', 'organized', 'Capture', 'Body', NULL, NULL, 1, 2, NULL, 1, 2, NULL),
        ('inbox-missing', 'link', 'organized', 'Missing', NULL, 'https://missing.test/', NULL, 1, 2, NULL, 1, 2, NULL)`)
      .run();
    database.driver
      .prepare(`INSERT INTO source_links (
        id, source_type, source_id, target_type, target_id, created_at
      ) VALUES ('link-ok', 'inbox-item', 'inbox-ok', 'knowledge-source', 'knowledge-inbox-ok', 2),
        ('link-missing', 'inbox-item', 'inbox-missing', 'knowledge-source', 'knowledge-inbox-missing', 2)`)
      .run();
    vi.mocked(reader.read).mockImplementation((id) =>
      id === 'inbox-ok' ? { sourceId: id, title: 'Captured source', contentText: 'Indexed inbox content' } : null
    );

    expect(service.rebuild(100)).toEqual({ indexedCount: 1, failedCount: 1, completedAt: 100 });
    expect(service.search({ query: 'indexed' }).hits[0]?.source).toMatchObject({
      id: 'knowledge-inbox-ok',
      sourceType: 'inbox-item',
      sourceId: 'inbox-ok',
    });
  });

  it('allows removing explicit Inbox sources but protects automatic note projections', () => {
    const repository = new KnowledgeRepository(database.driver);
    repository.upsert({
      id: 'note-source',
      sourceType: 'note',
      sourceId: 'note-1',
      title: 'Note',
      contentText: 'Body',
      contentHash: 'hash',
      indexedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    repository.upsert({
      id: 'inbox-source',
      sourceType: 'inbox-item',
      sourceId: 'inbox-1',
      title: 'Inbox',
      contentText: 'Body',
      contentHash: 'hash',
      indexedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });

    expect(() => service.removeSource('note-source', 10)).toThrow('KNOWLEDGE_NOTE_SOURCE_MANAGED');
    service.removeSource('inbox-source', 20);
    expect(repository.findById('inbox-source')).toBeNull();
  });

  it('keeps audit details free of indexed titles and content', () => {
    service.upsertNote(
      {
        id: 'note-1',
        title: 'Private title',
        body: 'Private body',
        revisionNumber: 1,
        archivedAt: null,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null,
      },
      10
    );
    service.rebuild(20);

    const rows = database.driver.prepare('SELECT detail_json FROM personal_audit_log').all();
    expect(JSON.stringify(rows)).not.toContain('Private title');
    expect(JSON.stringify(rows)).not.toContain('Private body');
  });
});
