import { createHash, createHmac } from 'node:crypto';
import type {
  S3ConnectionCredentials,
  S3Fetch,
  S3FetchResponse,
  S3RemoteObject,
  S3Transport,
  S3TransportFactory,
} from './types';

const ALGORITHM = 'AWS4-HMAC-SHA256';
const EMPTY_PAYLOAD_HASH = createHash('sha256').update('').digest('hex');

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replaceAll(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function buildCanonicalQuery(query: Record<string, string>): string {
  return Object.keys(query)
    .map((key) => [encodeRfc3986(key), encodeRfc3986(query[key])] as const)
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

export type S3RequestTarget = { host: string; canonicalUri: string; canonicalQuery: string };

export function buildRequestTarget(
  credentials: S3ConnectionCredentials,
  key: string,
  query: Record<string, string>
): S3RequestTarget {
  const endpoint = new URL(credentials.endpoint);
  const encodedKey = key
    .split('/')
    .map((segment) => encodeRfc3986(segment))
    .join('/');
  if (credentials.pathStyle) {
    return {
      host: endpoint.host,
      canonicalUri: encodedKey ? `/${credentials.bucket}/${encodedKey}` : `/${credentials.bucket}`,
      canonicalQuery: buildCanonicalQuery(query),
    };
  }
  return {
    host: `${credentials.bucket}.${endpoint.host}`,
    canonicalUri: encodedKey ? `/${encodedKey}` : '/',
    canonicalQuery: buildCanonicalQuery(query),
  };
}

export function buildAuthorizationHeader(
  credentials: S3ConnectionCredentials,
  target: S3RequestTarget,
  amzDate: string,
  dateStamp: string
): { headers: Record<string, string>; signedHeaders: string } {
  const headers: Record<string, string> = {
    host: target.host,
    'x-amz-content-sha256': EMPTY_PAYLOAD_HASH,
    'x-amz-date': amzDate,
  };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name}:${headers[name].trim()}\n`)
    .join('');
  const canonicalRequest = [
    'GET',
    target.canonicalUri,
    target.canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    EMPTY_PAYLOAD_HASH,
  ].join('\n');
  const scope = `${dateStamp}/${credentials.region}/s3/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, dateStamp), credentials.region), 's3'),
    'aws4_request'
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers.authorization = `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { headers, signedHeaders };
}

function parseListResponse(body: string): { objects: S3RemoteObject[]; nextToken: string | null } {
  const objects: S3RemoteObject[] = [];
  const contents = body.match(/<Contents>([\s\S]*?)<\/Contents>/g) ?? [];
  for (const block of contents) {
    const pick = (tag: string): string | null => {
      const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
      return match ? match[1] : null;
    };
    const key = pick('Key');
    if (!key) continue;
    const size = Number(pick('Size') ?? NaN);
    const lastModified = pick('LastModified');
    const modifiedAt = lastModified ? Date.parse(lastModified) : NaN;
    objects.push({
      key,
      name: key.split('/').pop() || key,
      sizeBytes: Number.isFinite(size) && size >= 0 ? size : 0,
      modifiedAt: Number.isFinite(modifiedAt) ? modifiedAt : null,
      etag: pick('ETag')?.replaceAll('&quot;', '"').replaceAll('"', '') || null,
    });
  }
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(body);
  const nextToken = truncated
    ? (body.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] ?? null)
    : null;
  return { objects, nextToken };
}

function defaultTransport(fetchImpl: S3Fetch = globalThis.fetch.bind(globalThis)): S3Transport {
  return {
    async requestObject(credentials, key, query) {
      const now = new Date();
      const amzDate = `${now.toISOString().replaceAll(/[-:]/g, '').slice(0, 15)}Z`;
      const dateStamp = amzDate.slice(0, 8);
      const target = buildRequestTarget(credentials, key, query);
      const { headers } = buildAuthorizationHeader(credentials, target, amzDate, dateStamp);
      const url = `https://${target.host}${target.canonicalUri}${
        target.canonicalQuery ? `?${target.canonicalQuery}` : ''
      }`;
      const response = await fetchImpl(url, { method: 'GET', headers });
      if (!response.ok) throw new Error(`CONNECTOR_S3_HTTP_${response.status}`);
      return response;
    },
  };
}

export class S3ReadClient {
  constructor(private readonly factory: S3TransportFactory = () => defaultTransport()) {}

  createTransport(credentials: S3ConnectionCredentials): S3Transport {
    return this.factory(credentials);
  }

  private async request(
    credentials: S3ConnectionCredentials,
    key: string,
    query: Record<string, string>
  ): Promise<S3FetchResponse> {
    const response = await this.createTransport(credentials).requestObject(credentials, key, query);
    if (!response.ok) throw new Error(`CONNECTOR_S3_HTTP_${response.status}`);
    return response;
  }

  async test(credentials: S3ConnectionCredentials): Promise<{ entries: number }> {
    const response = await this.request(credentials, '', { 'list-type': '2', 'max-keys': '1' });
    const body = await response.text();
    return { entries: parseListResponse(body).objects.length };
  }

  async listObjects(credentials: S3ConnectionCredentials, maxEntries: number): Promise<S3RemoteObject[]> {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new Error('CONNECTOR_S3_SCAN_LIMIT');
    const objects: S3RemoteObject[] = [];
    let token: string | null = null;
    do {
      const query: Record<string, string> = { 'list-type': '2', 'max-keys': '1000' };
      if (credentials.prefix) query.prefix = credentials.prefix;
      if (token) query['continuation-token'] = token;
      // oxlint-disable-next-line no-await-in-loop
      const response = await this.request(credentials, '', query);
      // oxlint-disable-next-line no-await-in-loop
      const body = await response.text();
      const page = parseListResponse(body);
      objects.push(...page.objects);
      token = page.nextToken;
      if (objects.length > maxEntries) throw new Error('CONNECTOR_S3_SCAN_LIMIT');
    } while (token);
    return objects.toSorted((left, right) => left.key.localeCompare(right.key));
  }

  async downloadToFile(
    credentials: S3ConnectionCredentials,
    object: S3RemoteObject,
    destinationPath: string,
    maxBytes: number
  ): Promise<void> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('CONNECTOR_S3_FILE_TOO_LARGE');
    if (object.sizeBytes > maxBytes) throw new Error('CONNECTOR_S3_FILE_TOO_LARGE');
    const response = await this.request(credentials, object.key, {});
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) throw new Error('CONNECTOR_S3_FILE_TOO_LARGE');
    const { writeFileSync, rmSync, chmodSync } = await import('node:fs');
    try {
      writeFileSync(destinationPath, buffer, { mode: 0o600 });
      chmodSync(destinationPath, 0o600);
    } catch (error) {
      rmSync(destinationPath, { force: true });
      throw error;
    }
  }
}

export { parseListResponse };
