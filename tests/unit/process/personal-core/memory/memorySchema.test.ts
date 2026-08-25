import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { PERSONAL_SCHEMA_VERSION } from '@process/services/personal-core/schema';

const directories: string[] = [];

function makeDataDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-memory-schema-'));
  directories.push(directory);
  return directory;
}

function createVersion5Catalog(dataDirectory: string): void {
  const database = PersonalDatabase.open(dataDirectory);
  database.driver
    .prepare(`INSERT INTO notes (
      id, title, body, revision_number, archived_at, created_at, updated_at, deleted_at
    ) VALUES ('note-before-memory', 'Existing note', 'Keep this note', 1, NULL, 1, 1, NULL)`)
    .run();
  database.driver
    .prepare(`INSERT INTO knowledge_sources (
      id, source_type, source_id, title, content_text, content_hash, indexed_at, created_at, updated_at
    ) VALUES ('knowledge-before-memory', 'note', 'note-before-memory', 'Existing note',
      'Keep this note', 'hash', 1, 1, 1)`)
    .run();
  database.driver.exec(`
    DROP TABLE IF EXISTS memory_fts;
    DROP TABLE IF EXISTS memory_items;
    DROP TABLE IF EXISTS memory_candidates;
  `);
  database.driver.pragma('user_version = 5');
  database.close();
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Personal Core memory schema', () => {
  it('migrates schema v5 to v6 without changing notes or knowledge sources', () => {
    const directory = makeDataDirectory();
    createVersion5Catalog(directory);

    const database = PersonalDatabase.open(directory);
    try {
      expect(database.health()).toEqual({ ok: true, version: PERSONAL_SCHEMA_VERSION });
      expect(database.driver.prepare("SELECT title FROM notes WHERE id = 'note-before-memory'").get()).toEqual({
        title: 'Existing note',
      });
      expect(
        database.driver.prepare("SELECT title FROM knowledge_sources WHERE id = 'knowledge-before-memory'").get()
      ).toEqual({ title: 'Existing note' });
      const tables = database.driver
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('memory_candidates', 'memory_items', 'memory_fts') ORDER BY name"
        )
        .all() as Array<{ name: string }>;
      expect(tables.map((row) => row.name)).toEqual(['memory_candidates', 'memory_fts', 'memory_items']);
    } finally {
      database.close();
    }
  });

  it('enforces candidate identity, enum, confidence, and scope constraints', () => {
    const database = PersonalDatabase.open(makeDataDirectory());
    try {
      const insert = database.driver.prepare(`INSERT INTO memory_candidates (
        id, operation_id, content, memory_type, proposed_scope_kind, proposed_scope_id,
        sensitivity, confidence, reason, source_refs_json, suggested_expires_at, created_at, updated_at
      ) VALUES (?, ?, 'Prefers concise updates', ?, ?, ?, 'normal', ?, 'Repeated request', '[]', NULL, 1, 1)`);

      insert.run('candidate-1', 'operation-1', 'preference', 'workspace', 'workspace-1', 0.8);
      expect(() =>
        insert.run('candidate-duplicate', 'operation-1', 'preference', 'workspace', 'workspace-1', 0.8)
      ).toThrow();
      expect(() => insert.run('candidate-type', 'operation-2', 'unknown', 'global', null, 0.8)).toThrow();
      expect(() => insert.run('candidate-confidence', 'operation-3', 'preference', 'global', null, 2)).toThrow();
      expect(() => insert.run('candidate-scope', 'operation-4', 'preference', 'workspace', null, 0.8)).toThrow();
    } finally {
      database.close();
    }
  });

  it('stores confirmed memory in full-text search and cascades its projection', () => {
    const database = PersonalDatabase.open(makeDataDirectory());
    try {
      database.driver
        .prepare(`INSERT INTO memory_items (
          id, content, memory_type, scope_kind, scope_id, sensitivity, confidence, reason,
          source_refs_json, confirmed_at, expires_at, review_at, last_retrieved_at, created_at, updated_at
        ) VALUES ('memory-1', 'Prefers weekly summaries', 'preference', 'global', NULL, 'normal', 0.9,
          'User confirmed', '[]', 1, NULL, NULL, NULL, 1, 1)`)
        .run();

      expect(
        database.driver.prepare("SELECT memory_id FROM memory_fts WHERE memory_fts MATCH 'weekly*'").all()
      ).toEqual([{ memory_id: 'memory-1' }]);
      database.driver.prepare("DELETE FROM memory_items WHERE id = 'memory-1'").run();
      expect(database.driver.prepare("SELECT memory_id FROM memory_fts WHERE memory_id = 'memory-1'").all()).toEqual(
        []
      );
    } finally {
      database.close();
    }
  });
});
