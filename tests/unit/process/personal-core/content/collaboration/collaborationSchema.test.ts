import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';

const directories: string[] = [];

function makeDataDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-collaboration-schema-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Personal Core collaboration schema', () => {
  it('migrates v8 to v9 while retaining existing personal data', () => {
    const directory = makeDataDirectory();
    const previous = PersonalDatabase.open(directory);
    previous.driver.exec(`
      INSERT INTO tasks (
        id, title, notes, priority, due_at, due_local_date, estimated_minutes, status,
        completed_at, series_id, occurrence_key, created_at, updated_at, deleted_at
      ) VALUES ('task-before-collaboration', 'Existing task', '', 'medium', NULL, NULL, NULL, 'open',
        NULL, NULL, NULL, 1, 1, NULL);
      DROP TABLE IF EXISTS collaboration_deliveries;
      DROP TABLE IF EXISTS collaboration_messages;
    `);
    previous.driver.pragma('user_version = 8');
    previous.close();

    const database = PersonalDatabase.open(directory);
    try {
      expect(database.health()).toEqual({ ok: true, version: 13 });
      expect(database.driver.prepare("SELECT title FROM tasks WHERE id = 'task-before-collaboration'").get()).toEqual({
        title: 'Existing task',
      });
      const tables = database.driver
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'collaboration_%' ORDER BY name")
        .all() as Array<{ name: string }>;
      expect(tables.map((row) => row.name)).toEqual([
        'collaboration_deliveries',
        'collaboration_invite_codes',
        'collaboration_members',
        'collaboration_messages',
      ]);
      database.driver
        .prepare(`INSERT INTO collaboration_invite_codes (
          id, team_id, code, max_uses, use_count, expires_at, revoked_at, created_at
        ) VALUES ('invite-1', 'team-1', 'ZX-ABCDE-FGHIJ', 3, 0, NULL, NULL, 1)`)
        .run();
      expect(() =>
        database.driver
          .prepare(`INSERT INTO collaboration_invite_codes (
            id, team_id, code, max_uses, use_count, expires_at, revoked_at, created_at
          ) VALUES ('invite-2', 'team-1', 'ZX-abcde-fghij', 3, 0, NULL, NULL, 1)`)
          .run()
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it('enforces event and per-target delivery uniqueness', () => {
    const database = PersonalDatabase.open(makeDataDirectory());
    try {
      const insertMessage = database.driver.prepare(`INSERT INTO collaboration_messages (
        id, team_id, thread_id, sender_kind, sender_slot_id, target_mode, target_slot_ids_json,
        kind, content, file_refs_json, source_event_id, conversation_id, created_at, updated_at
      ) VALUES (?, 'team-1', ?, 'system', NULL, 'members', '[]', 'progress', 'Update', '[]', ?, NULL, 1, 1)`);
      insertMessage.run('message-1', 'message-1', 'event-1');
      expect(() => insertMessage.run('message-2', 'message-2', 'event-1')).toThrow();

      const insertDelivery = database.driver.prepare(`INSERT INTO collaboration_deliveries (
        id, message_id, target_slot_id, team_run_id, status, error_code, error_detail, attempt_count, last_attempt_at
      ) VALUES (?, 'message-1', 'codex', NULL, 'pending', NULL, NULL, 0, NULL)`);
      insertDelivery.run('delivery-1');
      expect(() => insertDelivery.run('delivery-2')).toThrow();
    } finally {
      database.close();
    }
  });
});
