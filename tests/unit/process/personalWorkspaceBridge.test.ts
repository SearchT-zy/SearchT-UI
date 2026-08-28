import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@/common/types/searcht/workspace';
import { initPersonalWorkspaceBridge } from '@process/bridge/personalWorkspaceBridge';

describe('personalWorkspaceBridge', () => {
  it('registers before Personal Core startup without resolving the database', () => {
    expect(() => initPersonalWorkspaceBridge()).not.toThrow();
  });

  it('returns preferences and health without exposing the database driver', async () => {
    const repository = { get: vi.fn(() => DEFAULT_WORKSPACE_PREFERENCES), set: vi.fn() };
    const database = {
      health: vi.fn(() => ({ ok: true as const, version: 1 })),
      backup: vi.fn(async () => ({ path: 'C:\\backup', formatVersion: 1 as const })),
    };
    const handlers = initPersonalWorkspaceBridge({
      repository,
      database,
      discoverImport: vi.fn(() => ({ available: false as const })),
    });

    await expect(handlers.getPreferences()).resolves.toEqual(DEFAULT_WORKSPACE_PREFERENCES);
    await expect(handlers.getHealth()).resolves.toEqual({ ok: true, version: 1 });
    expect(Object.keys(await handlers.getHealth())).not.toContain('driver');
  });

  it('surfaces preference validation and backup errors', async () => {
    const repository = {
      get: vi.fn(),
      set: vi.fn(() => {
        throw new Error('Invalid SearchT start page');
      }),
    };
    const database = {
      health: vi.fn(),
      backup: vi.fn(async () => {
        throw new Error('backup unavailable');
      }),
    };
    const handlers = initPersonalWorkspaceBridge({
      repository,
      database,
      discoverImport: vi.fn(() => ({ available: false as const })),
    });

    await expect(
      handlers.setPreferences({ ...DEFAULT_WORKSPACE_PREFERENCES, startPage: 'bad' as 'today' })
    ).rejects.toThrow('Invalid SearchT start page');
    await expect(handlers.createBackup()).rejects.toThrow('backup unavailable');
  });

  it('returns the backup path and read-only SearchT discovery result', async () => {
    const repository = { get: vi.fn(), set: vi.fn() };
    const database = {
      health: vi.fn(),
      backup: vi.fn(async () => ({ path: 'C:\\data\\backups\\searcht-personal-1', formatVersion: 1 as const })),
    };
    const discovery = {
      available: true as const,
      dataDirectory: 'C:\\Users\\me\\AppData\\Roaming\\SearchT\\aionui',
      databasePath: 'C:\\Users\\me\\AppData\\Roaming\\SearchT\\aionui\\aionui.db',
    };
    const handlers = initPersonalWorkspaceBridge({
      repository,
      database,
      discoverImport: vi.fn(() => discovery),
    });

    await expect(handlers.createBackup()).resolves.toEqual({
      path: 'C:\\data\\backups\\searcht-personal-1',
      formatVersion: 1,
    });
    await expect(handlers.discoverSearchtImport()).resolves.toEqual(discovery);
    expect(database.backup).toHaveBeenCalledWith('manual');
  });
});
