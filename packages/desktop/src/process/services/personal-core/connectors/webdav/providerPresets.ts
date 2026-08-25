import type { WebDavConnectorTestInput, WebDavProvider } from '@/common/types/searcht/connectors';
import type { WebDavConnectionCredentials } from './types';

export const JIANGUOYUN_WEBDAV_URL = 'https://dav.jianguoyun.com/dav/';

const MAX_CREDENTIAL_LENGTH = 4096;
const MAX_SERVER_URL_LENGTH = 2048;

function invalid(code: string): never {
  throw new Error(code);
}

export function normalizeWebDavRootPath(value: string): string {
  if (typeof value !== 'string' || value.length > MAX_CREDENTIAL_LENGTH || value.includes('\u0000')) {
    return invalid('CONNECTOR_WEBDAV_ROOT_INVALID');
  }

  const normalized = value.trim().replaceAll('\\', '/');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return invalid('CONNECTOR_WEBDAV_ROOT_INVALID');
  }
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

function normalizeCredential(value: unknown): string {
  if (typeof value !== 'string') return invalid('CONNECTOR_WEBDAV_CREDENTIALS_INVALID');
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_CREDENTIAL_LENGTH || normalized.includes('\u0000')) {
    return invalid('CONNECTOR_WEBDAV_CREDENTIALS_INVALID');
  }
  return normalized;
}

function normalizeServerUrl(provider: WebDavProvider, value: unknown): string {
  if (provider === 'jianguoyun') return JIANGUOYUN_WEBDAV_URL;
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_SERVER_URL_LENGTH) {
    return invalid('CONNECTOR_WEBDAV_URL_INVALID');
  }
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return invalid('CONNECTOR_WEBDAV_URL_INVALID');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    parsed.search ||
    !parsed.hostname
  ) {
    return invalid('CONNECTOR_WEBDAV_URL_INVALID');
  }
  return parsed.toString().endsWith('/') ? parsed.toString() : `${parsed.toString()}/`;
}

export function resolveWebDavConnection(input: WebDavConnectorTestInput): WebDavConnectionCredentials {
  if (!input || (input.provider !== 'jianguoyun' && input.provider !== 'custom-webdav')) {
    return invalid('CONNECTOR_WEBDAV_PROVIDER_UNSUPPORTED');
  }
  return {
    provider: input.provider,
    serverUrl: normalizeServerUrl(input.provider, input.serverUrl),
    username: normalizeCredential(input.username),
    password: normalizeCredential(input.password),
    rootPath: normalizeWebDavRootPath(input.rootPath),
  };
}
