import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { PERSONAL_SCHEMA_VERSION } from '@process/services/personal-core/schema';

const directories: string[] = [];

function makeDataDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-skill-schema-'));
  directories.push(directory);
  return directory;
}

function createVersion6Catalog(dataDirectory: string): void {
  const database = PersonalDatabase.open(dataDirectory);
  database.driver.exec(`
    INSERT INTO tasks (
      id, title, notes, priority, due_at, due_local_date, estimated_minutes, status,
      completed_at, series_id, occurrence_key, created_at, updated_at, deleted_at
    ) VALUES ('task-before-skills', 'Existing task', '', 'medium', NULL, NULL, NULL, 'todo',
      NULL, NULL, NULL, 1, 1, NULL);

    INSERT INTO inbox_items (
      id, kind, state, title, text_content, url, origin_id, captured_at,
      organized_at, archived_at, created_at, updated_at, deleted_at
    ) VALUES ('inbox-before-skills', 'text', 'pending', 'Existing inbox item', 'Keep inbox content',
      NULL, NULL, 1, NULL, NULL, 1, 1, NULL);

    INSERT INTO notes (
      id, title, body, revision_number, archived_at, created_at, updated_at, deleted_at
    ) VALUES ('note-before-skills', 'Existing note', 'Keep note content', 1, NULL, 1, 1, NULL);

    INSERT INTO knowledge_sources (
      id, source_type, source_id, title, content_text, content_hash, indexed_at, created_at, updated_at
    ) VALUES ('knowledge-before-skills', 'note', 'note-before-skills', 'Existing note',
      'Keep note content', 'knowledge-hash', 1, 1, 1);

    INSERT INTO memory_items (
      id, content, memory_type, scope_kind, scope_id, sensitivity, confidence, reason,
      source_refs_json, confirmed_at, expires_at, review_at, last_retrieved_at, created_at, updated_at
    ) VALUES ('memory-before-skills', 'Existing memory', 'preference', 'global', NULL, 'normal', 0.8,
      'Keep memory content', '[]', 1, NULL, NULL, NULL, 1, 1);
  `);
  database.driver.pragma('user_version = 6');
  database.close();
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Personal Core skill lifecycle schema', () => {
  it('migrates schema v6 to v7 without changing existing personal data', () => {
    const directory = makeDataDirectory();
    createVersion6Catalog(directory);

    const database = PersonalDatabase.open(directory);
    try {
      expect(database.health()).toEqual({ ok: true, version: PERSONAL_SCHEMA_VERSION });
      expect(database.driver.prepare("SELECT title FROM tasks WHERE id = 'task-before-skills'").get()).toEqual({
        title: 'Existing task',
      });
      expect(database.driver.prepare("SELECT title FROM inbox_items WHERE id = 'inbox-before-skills'").get()).toEqual({
        title: 'Existing inbox item',
      });
      expect(database.driver.prepare("SELECT title FROM notes WHERE id = 'note-before-skills'").get()).toEqual({
        title: 'Existing note',
      });
      expect(
        database.driver.prepare("SELECT title FROM knowledge_sources WHERE id = 'knowledge-before-skills'").get()
      ).toEqual({ title: 'Existing note' });
      expect(
        database.driver.prepare("SELECT content FROM memory_items WHERE id = 'memory-before-skills'").get()
      ).toEqual({ content: 'Existing memory' });

      const tables = database.driver
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('skill_candidates', 'managed_skills', 'skill_versions') ORDER BY name"
        )
        .all() as Array<{ name: string }>;
      expect(tables.map((row) => row.name)).toEqual(['managed_skills', 'skill_candidates', 'skill_versions']);
    } finally {
      database.close();
    }
  });

  it('enforces candidate operation IDs, skill slugs, states, and immutable version numbers', () => {
    const database = PersonalDatabase.open(makeDataDirectory());
    try {
      const insertCandidate = database.driver.prepare(`INSERT INTO skill_candidates (
        id, operation_id, proposed_name, description, content, required_tools_json,
        permissions_json, reason, source_refs_json, validation_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, 'Weekly report', 'content', '[]', '[]', 'Repeated work', '[]', '{}', 'pending', 1, 1)`);
      insertCandidate.run('candidate-1', 'operation-1', 'weekly-report');
      expect(() => insertCandidate.run('candidate-2', 'operation-1', 'another-report')).toThrow();

      const insertSkill = database.driver.prepare(`INSERT INTO managed_skills (
        id, slug, description, state, active_version_id, created_at, updated_at
      ) VALUES (?, ?, 'Weekly report', ?, NULL, 1, 1)`);
      insertSkill.run('skill-1', 'weekly-report', 'active');
      expect(() => insertSkill.run('skill-2', 'weekly-report', 'disabled')).toThrow();
      expect(() => insertSkill.run('skill-3', 'invalid-state', 'unknown')).toThrow();

      const insertVersion = database.driver.prepare(`INSERT INTO skill_versions (
        id, skill_id, version_number, content, content_hash, required_tools_json, permissions_json,
        source_refs_json, validation_json, change_summary, candidate_id, created_at, published_at
      ) VALUES (?, 'skill-1', ?, 'content', 'hash', '[]', '[]', '[]', '{}', 'Initial version', NULL, 1, 1)`);
      insertVersion.run('version-1', 1);
      expect(() => insertVersion.run('version-duplicate', 1)).toThrow();
      expect(() => insertVersion.run('version-zero', 0)).toThrow();
    } finally {
      database.close();
    }
  });
});
