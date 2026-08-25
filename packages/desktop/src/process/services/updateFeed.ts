/**
 * @license
 * Copyright 2025 SearchT-UI Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

import { CdnGenericProvider } from './cdnGenericProvider';
import type { CdnGenericProviderConfiguration } from './cdnGenericProvider';

const SEARCHT_UPDATE_BASE_URL_ENV = 'SEARCHT_UPDATE_BASE_URL';

export type CdnFeedOptions = CdnGenericProviderConfiguration & {
  updateProvider: typeof CdnGenericProvider;
};

function readConfiguredUpdateUrl(): string | null {
  const value = process.env[SEARCHT_UPDATE_BASE_URL_ENV]?.trim();
  if (!value) return null;

  const url = new URL(value);
  if (url.protocol !== 'https:') {
    throw new Error('SearchT-UI update service must use HTTPS');
  }
  if (url.hostname === 'aionui.com' || url.hostname.endsWith('.aionui.com')) {
    throw new Error('SearchT-UI update service cannot use an SearchT-UI endpoint');
  }
  return value.replace(/\/$/, '');
}

export function isSearchtUpdateServiceConfigured(): boolean {
  return readConfiguredUpdateUrl() !== null;
}

export function buildCdnFeedOptions(): CdnFeedOptions | null {
  const url = readConfiguredUpdateUrl();
  if (!url) return null;
  return {
    provider: 'custom',
    url,
    updateProvider: CdnGenericProvider,
  };
}
