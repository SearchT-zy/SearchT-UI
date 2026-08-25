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

describe('Personal Core task schema', () => {
  it('migrates a fresh catalog to the current schema with task tables', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-task-schema-'));
    directories.push(directory);
    const database = PersonalDatabase.open(directory);

    expect(database.health()).toEqual({ ok: true, version: PERSONAL_SCHEMA_VERSION });
    expect(
      database.driver.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get()
    ).toEqual({
      name: 'tasks',
    });
    expect(
      database.driver.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_series'").get()
    ).toEqual({ name: 'task_series' });
    database.close();
  });
});
