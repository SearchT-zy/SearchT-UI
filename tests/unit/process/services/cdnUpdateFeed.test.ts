/**
 * @license
 * Copyright 2025 SearchT Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateInfo } from 'electron-updater';
import type { AppUpdater } from 'electron-updater/out/AppUpdater';
import type { ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider';
import { CdnGenericProvider } from '@/process/services/cdnGenericProvider';
import { buildCdnFeedOptions, isSearchtUpdateServiceConfigured } from '@/process/services/updateFeed';

afterEach(() => {
  delete process.env.SEARCHT_UPDATE_BASE_URL;
});

const makeRuntimeOptions = (): ProviderRuntimeOptions => ({
  isUseMultipleRangeRequest: true,
  platform: 'darwin',
  executor: {
    request: vi.fn(),
  } as unknown as ProviderRuntimeOptions['executor'],
});

describe('CDN update feed options', () => {
  it('does not configure an upstream update feed for the SearchT fork', () => {
    expect(isSearchtUpdateServiceConfigured()).toBe(false);
    expect(buildCdnFeedOptions()).toBeNull();
  });

  it('accepts an explicitly configured SearchT HTTPS release endpoint', () => {
    process.env.SEARCHT_UPDATE_BASE_URL = 'https://updates.searcht.example/releases';

    const options = buildCdnFeedOptions();

    expect(isSearchtUpdateServiceConfigured()).toBe(true);
    expect(options?.url).toBe('https://updates.searcht.example/releases');
    expect(options?.updateProvider).toBe(CdnGenericProvider);
  });

  it('rejects the upstream SearchT endpoint', () => {
    process.env.SEARCHT_UPDATE_BASE_URL = 'https://static.aionui.com/releases';
    expect(() => buildCdnFeedOptions()).toThrow('SearchT update service cannot use an SearchT endpoint');
  });
});

describe('CdnGenericProvider', () => {
  it('resolves relative update files under the version directory', () => {
    const provider = new CdnGenericProvider(
      {
        provider: 'custom',
        url: 'https://static.aionui.com/releases',
      },
      {} as AppUpdater,
      makeRuntimeOptions()
    );

    const files = provider.resolveFiles({
      version: '2.1.14',
      files: [
        {
          url: 'SearchT-2.1.14-mac-arm64.dmg',
          sha512: 'sha512-value',
        },
      ],
      path: 'SearchT-2.1.14-mac-arm64.dmg',
      sha512: 'sha512-value',
      releaseDate: '2026-06-08T00:00:00.000Z',
    } satisfies UpdateInfo);

    expect(files[0]?.url.href).toBe('https://static.aionui.com/releases/2.1.14/SearchT-2.1.14-mac-arm64.dmg');
  });
});
