import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { PERSONAL_SCHEMA_VERSION } from '@process/services/personal-core/schema';

const directories: string[] = [];

function makeDataDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-content-schema-'));
  directories.push(directory);
  return directory;
}

function createVersion4Catalog(dataDirectory: string): void {
  const database = PersonalDatabase.open(dataDirectory);
  database.driver
    .prepare(`INSERT INTO tasks (
      id, title, notes, priority, due_at, due_local_date, estimated_minutes, status,
      completed_at, series_id, occurrence_key, created_at, updated_at, deleted_at
    ) VALUES ('task-before-content', 'Existing task', '', 'none', NULL, NULL, NULL, 'open', NULL, NULL, NULL, 1, 1, NULL)`)
    .run();
  database.driver
    .prepare(`INSERT INTO calendar_events (
      id, title, description, location, all_day, starts_at, ends_at, start_local_date,
      end_local_date, timezone, series_id, occurrence_key, reminder_minutes, created_at, updated_at, deleted_at
    ) VALUES ('event-before-content', 'Existing event', '', '', 1, NULL, NULL, '2026-08-15',
      '2026-08-16', 'Asia/Shanghai', NULL, NULL, NULL, 1, 1, NULL)`)
    .run();
  database.driver
    .prepare(`INSERT INTO inbox_items (
      id, kind, state, title, text_content, url, origin_id, captured_at,
      organized_at, archived_at, created_at, updated_at, deleted_at
    ) VALUES ('inbox-before-content', 'text', 'pending', 'Existing inbox item', 'Keep me', NULL, NULL, 1,
      NULL, NULL, 1, 1, NULL)`)
    .run();
  database.driver.exec(`
    DROP TABLE IF EXISTS knowledge_fts;
    DROP TABLE IF EXISTS knowledge_sources;
    DROP TABLE IF EXISTS note_revisions;
    DROP TABLE IF EXISTS notes;
  `);
  database.driver.pragma('user_version = 4');
  database.close();
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Personal Core notes and knowledge schema', () => {
  it('migrates schema v4 to v5 without changing existing personal data', () => {
    const directory = makeDataDirectory();
    createVersion4Catalog(directory);

    const database = PersonalDatabase.open(directory);
    try {
      expect(database.health()).toEqual({ ok: true, version: PERSONAL_SCHEMA_VERSION });
      expect(database.driver.prepare("SELECT title FROM tasks WHERE id = 'task-before-content'").get()).toEqual({
        title: 'Existing task',
      });
      expect(
        database.driver.prepare("SELECT title FROM calendar_events WHERE id = 'event-before-content'").get()
      ).toEqual({ title: 'Existing event' });
      expect(database.driver.prepare("SELECT title FROM inbox_items WHERE id = 'inbox-before-content'").get()).toEqual({
        title: 'Existing inbox item',
      });

      const tables = database.driver
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('notes', 'note_revisions', 'knowledge_sources', 'knowledge_fts') ORDER BY name"
        )
        .all() as Array<{ name: string }>;
      expect(tables.map((row) => row.name)).toEqual(['knowledge_fts', 'knowledge_sources', 'note_revisions', 'notes']);
    } finally {
      database.close();
    }
  });

  it('enforces note revision and knowledge source constraints', () => {
    const database = PersonalDatabase.open(makeDataDirectory());
    try {
      database.driver
        .prepare(`INSERT INTO notes (
          id, title, body, revision_number, archived_at, created_at, updated_at, deleted_at
        ) VALUES ('note-1', 'Plan', 'Body', 1, NULL, 1, 1, NULL)`)
        .run();
      const insertRevision = database.driver.prepare(`INSERT INTO note_revisions (
        id, note_id, revision_number, title, body, created_at
      ) VALUES (?, 'note-1', ?, 'Plan', 'Body', 1)`);
      insertRevision.run('revision-1', 1);
      expect(() => insertRevision.run('revision-duplicate', 1)).toThrow();
      expect(() =>
        database.driver
          .prepare(`INSERT INTO knowledge_sources (
            id, source_type, source_id, title, content_text, content_hash, indexed_at, created_at, updated_at
          ) VALUES ('invalid-source', 'email', 'email-1', 'Mail', 'Body', 'hash', 1, 1, 1)`)
          .run()
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it('supports full-text lookup and cascades note revisions', () => {
    const database = PersonalDatabase.open(makeDataDirectory());
    try {
      database.driver
        .prepare(`INSERT INTO notes (
          id, title, body, revision_number, archived_at, created_at, updated_at, deleted_at
        ) VALUES ('note-1', 'Release plan', 'Prepare the checklist', 1, NULL, 1, 1, NULL)`)
        .run();
      database.driver
        .prepare(`INSERT INTO note_revisions (
          id, note_id, revision_number, title, body, created_at
        ) VALUES ('revision-1', 'note-1', 1, 'Release plan', 'Prepare the checklist', 1)`)
        .run();
      database.driver
        .prepare(`INSERT INTO knowledge_sources (
          id, source_type, source_id, title, content_text, content_hash, indexed_at, created_at, updated_at
        ) VALUES ('source-1', 'note', 'note-1', 'Release plan', 'Prepare the checklist', 'hash', 1, 1, 1)`)
        .run();
      database.driver
        .prepare('INSERT INTO knowledge_fts (source_id, title, content_text) VALUES (?, ?, ?)')
        .run('source-1', 'Release plan', 'Prepare the checklist');

      expect(
        database.driver.prepare("SELECT source_id FROM knowledge_fts WHERE knowledge_fts MATCH 'release*'").all()
      ).toEqual([{ source_id: 'source-1' }]);
      database.driver.prepare("DELETE FROM notes WHERE id = 'note-1'").run();
      expect(database.driver.prepare("SELECT id FROM note_revisions WHERE note_id = 'note-1'").all()).toEqual([]);
    } finally {
      database.close();
    }
  });
});
