import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveSearchtStoragePaths } from '@/common/config/brand';
import { getDevAppName } from '@/common/platform';

describe('SearchT storage paths', () => {
  it('keeps application data separate from SearchT', () => {
    expect(resolveSearchtStoragePaths('C:\\Users\\me\\AppData\\Roaming\\SearchT')).toEqual({
      dataPath: path.join('C:\\Users\\me\\AppData\\Roaming\\SearchT', 'searcht'),
      configPath: path.join('C:\\Users\\me\\AppData\\Roaming\\SearchT', 'config'),
    });
  });

  it('uses a SearchT-specific development application name', () => {
    expect(getDevAppName()).toBe('SearchT-Dev');
  });
});
