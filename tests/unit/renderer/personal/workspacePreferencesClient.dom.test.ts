// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@/common/types/searcht/workspace';
import {
  loadWorkspacePreferences,
  saveWorkspacePreferences,
} from '@renderer/pages/personal/workspacePreferencesClient';

describe('browser workspace preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as Window & { electronAPI?: unknown }).electronAPI;
  });

  it('persists preferences locally when Electron is unavailable', async () => {
    const next = { ...DEFAULT_WORKSPACE_PREFERENCES, startPage: 'notes' as const };
    await saveWorkspacePreferences(next);
    await expect(loadWorkspacePreferences()).resolves.toEqual(next);
  });

  it('falls back to defaults for malformed browser data', async () => {
    localStorage.setItem('searcht.workspace.preferences.v1', '{broken');
    await expect(loadWorkspacePreferences()).resolves.toEqual(DEFAULT_WORKSPACE_PREFERENCES);
  });

  it('adds onboarding defaults when reading legacy browser preferences', async () => {
    localStorage.setItem(
      'searcht.workspace.preferences.v1',
      JSON.stringify({ startPage: 'today', scenePack: 'general' })
    );

    await expect(loadWorkspacePreferences()).resolves.toMatchObject({
      onboardingCompleted: false,
      onboardingVersion: 2,
    });
  });

  it('merges newly added modules into legacy browser preferences', async () => {
    localStorage.setItem(
      'searcht.workspace.preferences.v1',
      JSON.stringify({
        visibleModules: { today: true, inbox: false, calendar: true, tasks: true, notes: true, knowledge: true },
        navigationOrder: ['today', 'inbox', 'calendar', 'tasks', 'notes', 'knowledge'],
        startPage: 'today',
        scenePack: 'general',
      })
    );

    await expect(loadWorkspacePreferences()).resolves.toMatchObject({
      visibleModules: { workflows: true },
      navigationOrder: ['today', 'inbox', 'calendar', 'tasks', 'notes', 'knowledge', 'workflows'],
    });
  });
});
