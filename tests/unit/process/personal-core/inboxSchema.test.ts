import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { PERSONAL_SCHEMA_VERSION } from '@process/services/personal-core/schema';

const directories: string[] = [];

function makeDataDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-inbox-schema-'));
  directories.push(directory);
  return directory;
}

function createVersion3Catalog(dataDirectory: string): void {
  const database = PersonalDatabase.open(dataDirectory);
  database.driver
    .prepare(`INSERT INTO tasks (
      id, title, notes, priority, due_at, due_local_date, estimated_minutes, status,
      completed_at, series_id, occurrence_key, created_at, updated_at, deleted_at
    ) VALUES ('task-before-inbox', 'Existing task', '', 'none', NULL, NULL, NULL, 'open', NULL, NULL, NULL, 1, 1, NULL)`)
    .run();
  database.driver
    .prepare(`INSERT INTO calendar_events (
      id, title, description, location, all_day, starts_at, ends_at, start_local_date,
      end_local_date, timezone, series_id, occurrence_key, reminder_minutes, created_at, updated_at, deleted_at
    ) VALUES ('event-before-inbox', 'Existing event', '', '', 1, NULL, NULL, '2026-08-14',
      '2026-08-15', 'Asia/Shanghai', NULL, NULL, NULL, 1, 1, NULL)`)
    .run();
  database.driver.exec(`
    DROP TABLE source_links;
    DROP TABLE inbox_items;
    DROP TABLE inbox_asset_origins;
    DROP TABLE inbox_assets;
  `);
  database.driver.pragma('user_version = 3');
  database.close();
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Personal Core Inbox schema', () => {
  it('migrates schema v3 to the current version without changing existing task or calendar rows', () => {
    const directory = makeDataDirectory();
    createVersion3Catalog(directory);

    const database = PersonalDatabase.open(directory);
    try {
      expect(database.health()).toEqual({ ok: true, version: PERSONAL_SCHEMA_VERSION });
      expect(database.driver.prepare("SELECT title FROM tasks WHERE id = 'task-before-inbox'").get()).toEqual({
        title: 'Existing task',
      });
      expect(
        database.driver.prepare("SELECT title FROM calendar_events WHERE id = 'event-before-inbox'").get()
      ).toEqual({ title: 'Existing event' });

      const tables = database.driver
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('inbox_assets', 'inbox_asset_origins', 'inbox_items', 'source_links') ORDER BY name"
        )
        .all() as Array<{ name: string }>;
      expect(tables.map((row) => row.name)).toEqual([
        'inbox_asset_origins',
        'inbox_assets',
        'inbox_items',
        'source_links',
      ]);
    } finally {
      database.close();
    }
  });

  it('rejects item kinds whose content fields do not match the kind', () => {
    const database = PersonalDatabase.open(makeDataDirectory());
    try {
      const insert = database.driver.prepare(`INSERT INTO inbox_items (
        id, kind, state, title, text_content, url, origin_id,
        captured_at, organized_at, archived_at, created_at, updated_at, deleted_at
      ) VALUES (?, ?, 'pending', 'Invalid', ?, ?, ?, 1, NULL, NULL, 1, 1, NULL)`);

      expect(() => insert.run('bad-text', 'text', null, null, null)).toThrow();
      expect(() => insert.run('bad-link', 'link', 'text', 'https://example.com', null)).toThrow();
      expect(() => insert.run('bad-file', 'file', null, null, null)).toThrow();
    } finally {
      database.close();
    }
  });

  it('protects origins and assets while a file item references them', () => {
    const database = PersonalDatabase.open(makeDataDirectory());
    try {
      database.driver
        .prepare(
          "INSERT INTO inbox_assets (id, sha256, managed_name, mime_type, size_bytes, created_at) VALUES ('asset-1', ?, 'digest', 'text/plain', 1, 1)"
        )
        .run('a'.repeat(64));
      database.driver
        .prepare(
          "INSERT INTO inbox_asset_origins (id, asset_id, original_name, original_path, imported_at) VALUES ('origin-1', 'asset-1', 'a.txt', 'C:\\a.txt', 1)"
        )
        .run();
      database.driver
        .prepare(`INSERT INTO inbox_items (
          id, kind, state, title, text_content, url, origin_id,
          captured_at, organized_at, archived_at, created_at, updated_at, deleted_at
        ) VALUES ('item-1', 'file', 'pending', 'a.txt', NULL, NULL, 'origin-1', 1, NULL, NULL, 1, 1, NULL)`)
        .run();

      expect(() => database.driver.prepare("DELETE FROM inbox_asset_origins WHERE id = 'origin-1'").run()).toThrow();
      expect(() => database.driver.prepare("DELETE FROM inbox_assets WHERE id = 'asset-1'").run()).toThrow();
    } finally {
      database.close();
    }
  });
});
