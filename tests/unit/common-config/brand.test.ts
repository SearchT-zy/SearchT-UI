import { describe, expect, it } from 'vitest';
import { SEARCHT_BRAND } from '@/common/config/brand';

describe('SearchT brand contract', () => {
  it('uses identifiers that cannot collide with SearchT', () => {
    expect(SEARCHT_BRAND).toEqual({
      appId: 'cn.searcht.desktop',
      appName: 'SearchT',
      displayName: 'SearchT',
      executableName: 'SearchT',
      protocol: 'searcht',
      dataDirectoryName: 'searcht',
      cliDataDirectoryName: '.searcht',
      cliConfigDirectoryName: '.searcht-config',
      personalDatabaseName: 'searcht-personal.db',
    });
  });

  it('does not inherit upstream application identifiers', () => {
    expect(SEARCHT_BRAND.appId).not.toContain('aionui');
    expect(SEARCHT_BRAND.protocol).not.toBe('aionui');
  });
});
