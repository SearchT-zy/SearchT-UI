import type { S3ConnectorTestInput, S3Provider } from '@/common/types/searcht/connectors';
import type { S3ConnectionCredentials } from './types';

const MAX_CREDENTIAL_LENGTH = 4096;
const MAX_ENDPOINT_LENGTH = 2048;

function invalid(code: string): never {
  throw new Error(code);
}

function normalizeCredential(value: unknown, code: string): string {
  if (typeof value !== 'string') return invalid(code);
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_CREDENTIAL_LENGTH || normalized.includes('\u0000')) {
    return invalid(code);
  }
  return normalized;
}

export function normalizeS3Prefix(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > 1024 || value.includes('\u0000')) {
    return invalid('CONNECTOR_S3_PREFIX_INVALID');
  }
  const normalized = value.trim().replaceAll('\\', '/');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return invalid('CONNECTOR_S3_PREFIX_INVALID');
  }
  return segments.length === 0 ? '' : `${segments.join('/')}/`;
}

function normalizeBucket(value: unknown): string {
  if (typeof value !== 'string') return invalid('CONNECTOR_S3_BUCKET_INVALID');
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(normalized) || normalized.includes('..')) {
    return invalid('CONNECTOR_S3_BUCKET_INVALID');
  }
  return normalized;
}

function normalizeRegion(value: unknown): string {
  if (typeof value !== 'string') return invalid('CONNECTOR_S3_REGION_INVALID');
  const normalized = value.trim();
  if (!/^[a-z0-9-]{1,64}$/.test(normalized)) return invalid('CONNECTOR_S3_REGION_INVALID');
  return normalized;
}

function normalizeEndpoint(provider: S3Provider, region: string, value: unknown): string {
  let candidate: string;
  if (provider === 'aws-s3') {
    candidate = typeof value === 'string' && value.trim() ? value : `https://s3.${region}.amazonaws.com`;
  } else if (typeof value !== 'string' || !value.trim()) {
    return invalid('CONNECTOR_S3_ENDPOINT_REQUIRED');
  } else {
    candidate = value;
  }
  if (candidate.length > MAX_ENDPOINT_LENGTH) return invalid('CONNECTOR_S3_ENDPOINT_INVALID');
  let parsed: URL;
  try {
    parsed = new URL(candidate.trim());
  } catch {
    return invalid('CONNECTOR_S3_ENDPOINT_INVALID');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    parsed.search ||
    !parsed.hostname ||
    (parsed.pathname !== '/' && parsed.pathname !== '')
  ) {
    return invalid('CONNECTOR_S3_ENDPOINT_INVALID');
  }
  return `https://${parsed.host}`;
}

export function resolveS3Connection(input: S3ConnectorTestInput): S3ConnectionCredentials {
  if (!input || !['aws-s3', 'cloudflare-r2', 'custom-s3'].includes(input.provider)) {
    return invalid('CONNECTOR_S3_PROVIDER_UNSUPPORTED');
  }
  const region = normalizeRegion(input.region);
  const provider = input.provider;
  return {
    provider,
    endpoint: normalizeEndpoint(provider, region, input.endpoint),
    region,
    bucket: normalizeBucket(input.bucket),
    accessKeyId: normalizeCredential(input.accessKeyId, 'CONNECTOR_S3_CREDENTIALS_INVALID'),
    secretAccessKey: normalizeCredential(input.secretAccessKey, 'CONNECTOR_S3_CREDENTIALS_INVALID'),
    prefix: normalizeS3Prefix(input.prefix),
    pathStyle: input.pathStyle === undefined ? provider !== 'aws-s3' : Boolean(input.pathStyle),
  };
}
