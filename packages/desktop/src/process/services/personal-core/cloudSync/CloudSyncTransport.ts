import { createHmac, createHash } from 'node:crypto';

/**
 * Remote storage contract for SearchT-UI cloud sync. Objects are opaque encrypted
 * bundles; only a flat key space under a fixed root prefix is used.
 */
export type CloudSyncTransport = {
  put(key: string, body: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
};

export type WebDavSyncCredentials = {
  serverUrl: string;
  username: string;
  password: string;
  rootPath: string;
};

export type S3SyncCredentials = {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  pathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
};

type SyncFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: Buffer }
) => Promise<Response>;

function emptyPayloadHash(): string {
  return createHash('sha256').update('').digest('hex');
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replaceAll(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function encodeKeyPath(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeRfc3986(segment))
    .join('/');
}

export function createS3SyncTransport(
  credentials: S3SyncCredentials,
  fetchImpl: SyncFetch = (url, init) => fetch(url, init as RequestInit)
): CloudSyncTransport {
  const endpoint = new URL(credentials.endpoint);
  const objectUrl = (key: string): { url: string; host: string; canonicalUri: string } => {
    const encoded = encodeKeyPath(key);
    if (credentials.pathStyle) {
      const canonicalUri = `/${credentials.bucket}${encoded ? `/${encoded}` : ''}`;
      return { url: `https://${endpoint.host}${canonicalUri}`, host: endpoint.host, canonicalUri };
    }
    return {
      url: `https://${credentials.bucket}.${endpoint.host}${encoded ? `/${encoded}` : ''}`,
      host: `${credentials.bucket}.${endpoint.host}`,
      canonicalUri: encoded ? `/${encoded}` : '/',
    };
  };

  const request = async (method: 'PUT' | 'GET', key: string, body?: Buffer): Promise<Response> => {
    const { url, host, canonicalUri } = objectUrl(`${credentials.prefix}${key}`);
    const now = new Date();
    const amzDate = `${now.toISOString().replaceAll(/[-:]/g, '').slice(0, 15)}Z`;
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = body ? createHash('sha256').update(body).digest('hex') : emptyPayloadHash();
    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (body) headers['content-length'] = String(body.byteLength);
    const signedHeaders = Object.keys(headers).sort().join(';');
    const canonicalHeaders = Object.keys(headers)
      .sort()
      .map((name) => `${name}:${headers[name].trim()}\n`)
      .join('');
    const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${dateStamp}/${credentials.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');
    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, dateStamp), credentials.region), 's3'),
      'aws4_request'
    );
    const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const response = await fetchImpl(url, { method, headers });
    if (!response.ok) throw new Error(`CLOUD_SYNC_TRANSPORT_HTTP_${response.status}`);
    return response;
  };

  return {
    async put(key, body) {
      await request('PUT', key, body);
    },
    async get(key) {
      const response = await request('GET', key);
      if (response.status === 404 && response.ok === false) return null;
      return Buffer.from(await response.arrayBuffer());
    },
  };
}

export function createWebDavSyncTransport(
  credentials: WebDavSyncCredentials,
  fetchImpl: SyncFetch = (url, init) => fetch(url, init as RequestInit)
): CloudSyncTransport {
  const baseUrl = () => {
    const root = `${credentials.serverUrl.replace(/\/+$/, '')}${credentials.rootPath.replace(/\/+$/, '')}`;
    return root.endsWith('/') ? root : `${root}/`;
  };
  const authHeader = () => `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`;

  return {
    async put(key, body) {
      const response = await fetchImpl(baseUrl() + encodeKeyPath(key), {
        method: 'PUT',
        headers: { authorization: authHeader(), 'content-type': 'application/octet-stream' },
        body,
      });
      // 201 created, 204 updated are both success.
      if (![200, 201, 204].includes(response.status)) {
        throw new Error(`CLOUD_SYNC_TRANSPORT_HTTP_${response.status}`);
      }
    },
    async get(key) {
      const response = await fetchImpl(baseUrl() + encodeKeyPath(key), {
        method: 'GET',
        headers: { authorization: authHeader() },
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`CLOUD_SYNC_TRANSPORT_HTTP_${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    },
  };
}

export function createMemorySyncTransport(): CloudSyncTransport & { store: Map<string, Buffer> } {
  const store = new Map<string, Buffer>();
  return {
    store,
    async put(key, body) {
      store.set(key, Buffer.from(body));
    },
    async get(key) {
      const value = store.get(key);
      return value ? Buffer.from(value) : null;
    },
  };
}
