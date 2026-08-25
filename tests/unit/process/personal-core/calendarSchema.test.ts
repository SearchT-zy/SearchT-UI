import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { PERSONAL_SCHEMA_VERSION } from '@process/services/personal-core/schema';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Personal Core calendar schema', () => {
  it('migrates a fresh catalog to the current schema with calendar tables', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-calendar-schema-'));
    directories.push(directory);
    const database = PersonalDatabase.open(directory);
    try {
      expect(database.health()).toEqual({ ok: true, version: PERSONAL_SCHEMA_VERSION });
      const tables = database.driver
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('calendar_series', 'calendar_events', 'schedule_blocks', 'reminders') ORDER BY name"
        )
        .all() as Array<{ name: string }>;
      expect(tables.map((row) => row.name)).toEqual([
        'calendar_events',
        'calendar_series',
        'reminders',
        'schedule_blocks',
      ]);
    } finally {
      database.close();
    }
  });
});
