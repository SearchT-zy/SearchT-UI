import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveSearchtStoragePaths } from '@/common/config/brand';
import { getDevAppName } from '@/common/platform';

describe('SearchT-UI storage paths', () => {
  it('keeps application data separate from SearchT-UI', () => {
    expect(resolveSearchtStoragePaths('C:\\Users\\me\\AppData\\Roaming\\SearchT-UI')).toEqual({
      dataPath: path.join('C:\\Users\\me\\AppData\\Roaming\\SearchT-UI', 'searcht'),
      configPath: path.join('C:\\Users\\me\\AppData\\Roaming\\SearchT-UI', 'config'),
    });
  });

  it('uses a SearchT-UI-specific development application name', () => {
    expect(getDevAppName()).toBe('SearchT-UI-Dev');
  });
});
