import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_WORKSPACE_PREFERENCES, type WorkspacePreferences } from '@/common/types/searcht/workspace';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { WorkspacePreferenceRepository } from '@process/services/personal-core/WorkspacePreferenceRepository';

let directory: string;
let database: PersonalDatabase;
let repository: WorkspacePreferenceRepository;

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-preferences-'));
  database = PersonalDatabase.open(directory);
  repository = new WorkspacePreferenceRepository(database.driver);
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('WorkspacePreferenceRepository', () => {
  it('returns defaults when no preference row exists', () => {
    expect(repository.get()).toEqual(DEFAULT_WORKSPACE_PREFERENCES);
    expect(repository.get()).toMatchObject({ onboardingCompleted: false, onboardingVersion: 2 });
  });

  it('persists onboarding completion without changing existing workspace preferences', () => {
    const saved = repository.set({
      ...DEFAULT_WORKSPACE_PREFERENCES,
      startPage: 'notes',
      onboardingCompleted: true,
      onboardingVersion: 2,
    });

    expect(repository.get()).toMatchObject({
      startPage: 'notes',
      onboardingCompleted: true,
      onboardingVersion: 2,
    });
    expect(saved.visibleModules).toEqual(DEFAULT_WORKSPACE_PREFERENCES.visibleModules);
  });

  it('normalizes unknown and duplicate modules while preserving every module once', () => {
    const saved = repository.set({
      ...DEFAULT_WORKSPACE_PREFERENCES,
      navigationOrder: ['tasks', 'unknown', 'tasks', 'today'] as WorkspacePreferences['navigationOrder'],
    });

    expect(saved.navigationOrder).toEqual(['tasks', 'today', 'inbox', 'calendar', 'notes', 'knowledge', 'workflows']);
    expect(repository.get()).toEqual(saved);
  });

  it('rejects an invalid start page without replacing the stored value', () => {
    const previous = repository.set({ ...DEFAULT_WORKSPACE_PREFERENCES, startPage: 'notes' });

    expect(() =>
      repository.set({ ...DEFAULT_WORKSPACE_PREFERENCES, startPage: 'invalid' as WorkspacePreferences['startPage'] })
    ).toThrow('Invalid SearchT start page');
    expect(repository.get()).toEqual(previous);
  });

  it('recovers malformed JSON and records the recovery in the audit log', () => {
    database.driver
      .prepare('INSERT INTO workspace_preferences (key, value_json, updated_at) VALUES (?, ?, ?)')
      .run('workspace.preferences.v1', '{broken', Date.now());

    expect(repository.get()).toEqual(DEFAULT_WORKSPACE_PREFERENCES);
    expect(
      database.driver.prepare("SELECT action FROM personal_audit_log WHERE action = 'preference_recovery'").get()
    ).toEqual({ action: 'preference_recovery' });
  });
});
