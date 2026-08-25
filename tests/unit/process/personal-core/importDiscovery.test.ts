import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { discoverSearchtImport } from '@process/services/personal-core/importDiscovery';

describe('discoverSearchtImport', () => {
  it('reports a readable upstream catalog without modifying it', () => {
    const exists = vi.fn((candidate: string) => candidate.endsWith(path.join('aionui', 'aionui.db')));
    const roamingDirectory = 'C:\\Users\\me\\AppData\\Roaming';

    expect(discoverSearchtImport(roamingDirectory, exists)).toEqual({
      available: true,
      dataDirectory: path.join(roamingDirectory, 'AionUi', 'aionui'),
      databasePath: path.join(roamingDirectory, 'AionUi', 'aionui', 'aionui.db'),
      configDirectory: null,
    });
    expect(exists).toHaveBeenCalled();
  });

  it('reports the legacy config directory when it holds a settings file', () => {
    const exists = vi.fn(
      (candidate: string) =>
        candidate.endsWith(path.join('AionUi', 'config', 'aionui-config.txt')) ||
        candidate.endsWith(path.join('aionui', 'aionui.db'))
    );
    const roamingDirectory = 'C:\\Users\\me\\AppData\\Roaming';

    expect(discoverSearchtImport(roamingDirectory, exists)).toEqual({
      available: true,
      dataDirectory: path.join(roamingDirectory, 'AionUi', 'aionui'),
      databasePath: path.join(roamingDirectory, 'AionUi', 'aionui', 'aionui.db'),
      configDirectory: path.join(roamingDirectory, 'AionUi', 'config'),
    });
  });

  it('returns unavailable when neither catalog nor config exists', () => {
    expect(discoverSearchtImport('C:\\data', () => false)).toEqual({ available: false });
  });
});
