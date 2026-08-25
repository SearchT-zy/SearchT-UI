import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { PERSONAL_SCHEMA_VERSION } from '@process/services/personal-core/schema';

const directories: string[] = [];

function makeDataDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-workflow-schema-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Personal Core workflow schema', () => {
  it('migrates v7 to v8 while retaining existing skill and personal data', () => {
    const directory = makeDataDirectory();
    const previous = PersonalDatabase.open(directory);
    previous.driver.exec(`
      INSERT INTO tasks (
        id, title, notes, priority, due_at, due_local_date, estimated_minutes, status,
        completed_at, series_id, occurrence_key, created_at, updated_at, deleted_at
      ) VALUES ('task-before-workflows', 'Existing task', '', 'medium', NULL, NULL, NULL, 'todo',
        NULL, NULL, NULL, 1, 1, NULL);
      INSERT INTO managed_skills (
        id, slug, description, state, active_version_id, created_at, updated_at
      ) VALUES ('skill-before-workflows', 'existing-skill', 'Existing skill', 'disabled', NULL, 1, 1);
    `);
    previous.driver.pragma('user_version = 7');
    previous.close();

    const database = PersonalDatabase.open(directory);
    try {
      expect(database.health()).toEqual({ ok: true, version: PERSONAL_SCHEMA_VERSION });
      expect(database.driver.prepare("SELECT title FROM tasks WHERE id = 'task-before-workflows'").get()).toEqual({
        title: 'Existing task',
      });
      expect(
        database.driver.prepare("SELECT slug FROM managed_skills WHERE id = 'skill-before-workflows'").get()
      ).toEqual({ slug: 'existing-skill' });
      const tables = database.driver
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'workflow_%' ORDER BY name")
        .all() as Array<{ name: string }>;
      expect(tables.map((row) => row.name)).toEqual([
        'workflow_approvals',
        'workflow_grants',
        'workflow_instances',
        'workflow_runs',
        'workflow_versions',
      ]);
    } finally {
      database.close();
    }
  });

  it('enforces runtime bindings, version numbers, run keys, and state values', () => {
    const database = PersonalDatabase.open(makeDataDirectory());
    try {
      const insertWorkflow = database.driver.prepare(`INSERT INTO workflow_instances (
        id, operation_id, template_id, name, description, state, runtime_job_id,
        active_version_id, created_at, updated_at, deleted_at
      ) VALUES (?, ?, NULL, 'Daily plan', 'Plan the day', ?, ?, NULL, 1, 1, NULL)`);
      insertWorkflow.run('workflow-1', 'operation-1', 'active', 'cron-1');
      expect(() => insertWorkflow.run('workflow-2', 'operation-2', 'active', 'cron-1')).toThrow();
      expect(() => insertWorkflow.run('workflow-3', 'operation-3', 'unknown', 'cron-3')).toThrow();

      const insertVersion = database.driver.prepare(`INSERT INTO workflow_versions (
        id, workflow_id, version_number, definition_json, compiled_prompt, change_summary, created_at
      ) VALUES (?, 'workflow-1', ?, '{}', 'Prompt', 'Initial', 1)`);
      insertVersion.run('version-1', 1);
      expect(() => insertVersion.run('version-duplicate', 1)).toThrow();

      const insertRun = database.driver.prepare(`INSERT INTO workflow_runs (
        id, workflow_id, workflow_version_id, runtime_run_key, state, input_json,
        conversation_id, error_code, created_at, started_at, finished_at
      ) VALUES (?, 'workflow-1', 'version-1', ?, 'pending', '{}', NULL, NULL, 1, NULL, NULL)`);
      insertRun.run('run-1', 'runtime-run-1');
      expect(() => insertRun.run('run-duplicate', 'runtime-run-1')).toThrow();
    } finally {
      database.close();
    }
  });
});
