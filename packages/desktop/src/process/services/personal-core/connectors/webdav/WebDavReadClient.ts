import { createWriteStream, chmodSync, rmSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createClient, getPatcher } from 'webdav';
import { fetch as buttercupFetch } from '@buttercup/fetch';
import type {
  WebDavConnectionCredentials,
  WebDavFileStat,
  WebDavRemoteFile,
  WebDavTransport,
  WebDavTransportFactory,
} from './types';

let strictRedirectPolicyInstalled = false;

function installStrictRedirectPolicy(): void {
  if (strictRedirectPolicyInstalled) return;
  const patcher = getPatcher();
  if (!patcher.isPatched('fetch')) {
    patcher.patch('fetch', (input: unknown, init: unknown) => {
      const options = (init && typeof init === 'object' ? init : {}) as Record<string, unknown>;
      return buttercupFetch(input as never, { ...options, redirect: 'error' });
    });
  }
  strictRedirectPolicyInstalled = true;
}

function defaultTransportFactory(
  serverUrl: string,
  options: { username: string; password: string; redirect: 'error' }
): WebDavTransport {
  installStrictRedirectPolicy();
  const client = createClient(serverUrl, {
    username: options.username,
    password: options.password,
    maxContentLength: 100 * 1024 * 1024,
  });
  return {
    getDirectoryContents: (remotePath) => client.getDirectoryContents(remotePath, { deep: false }),
    createReadStream: (remotePath) => client.createReadStream(remotePath),
  };
}

function normalizeRemotePath(value: string): string {
  if (typeof value !== 'string' || value.includes('\u0000')) throw new Error('CONNECTOR_WEBDAV_PATH_INVALID');
  const normalized = `/${value.replaceAll('\\', '/').split('/').filter(Boolean).join('/')}`;
  const segments = normalized.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('CONNECTOR_WEBDAV_PATH_INVALID');
  }
  return normalized;
}

function assertWithinRoot(rootPath: string, remotePath: string): string {
  const root = normalizeRemotePath(rootPath);
  const normalized = normalizeRemotePath(remotePath);
  if (root !== '/' && normalized !== root && !normalized.startsWith(`${root}/`)) {
    throw new Error('CONNECTOR_WEBDAV_PATH_OUTSIDE_ROOT');
  }
  return normalized;
}

function normalizeStat(stat: WebDavFileStat, rootPath: string): WebDavRemoteFile | null {
  const filePath = assertWithinRoot(rootPath, stat.filename);
  if (stat.type === 'directory') return null;
  if (!Number.isFinite(stat.size) || stat.size < 0) throw new Error('CONNECTOR_WEBDAV_FILE_SIZE_UNKNOWN');
  const modifiedAt = stat.lastmod ? Date.parse(stat.lastmod) : NaN;
  return {
    path: filePath,
    name: stat.basename || filePath.split('/').pop() || filePath,
    sizeBytes: stat.size,
    modifiedAt: Number.isFinite(modifiedAt) ? modifiedAt : null,
    etag: stat.etag || null,
  };
}

export class WebDavReadClient {
  constructor(private readonly factory: WebDavTransportFactory = defaultTransportFactory) {}

  createTransport(credentials: WebDavConnectionCredentials): WebDavTransport {
    return this.factory(credentials.serverUrl, {
      username: credentials.username,
      password: credentials.password,
      redirect: 'error',
    });
  }

  async test(credentials: WebDavConnectionCredentials): Promise<{ entries: number }> {
    const transport = this.createTransport(credentials);
    const entries = await transport.getDirectoryContents(normalizeRemotePath(credentials.rootPath));
    return { entries: entries.length };
  }

  async listFiles(credentials: WebDavConnectionCredentials, maxEntries: number): Promise<WebDavRemoteFile[]> {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new Error('CONNECTOR_WEBDAV_SCAN_LIMIT');
    const transport = this.createTransport(credentials);
    const queue = [normalizeRemotePath(credentials.rootPath)];
    const files: WebDavRemoteFile[] = [];
    let scanned = 0;
    while (queue.length) {
      const currentPath = queue.shift()!;
      // Keep traversal sequential so a wide tree cannot create an unbounded request burst.
      // oxlint-disable-next-line no-await-in-loop
      const entries = await transport.getDirectoryContents(currentPath);
      scanned += entries.length;
      if (scanned > maxEntries) throw new Error('CONNECTOR_WEBDAV_SCAN_LIMIT');
      for (const entry of entries) {
        const normalizedPath = assertWithinRoot(credentials.rootPath, entry.filename);
        if (entry.type === 'directory') {
          if (normalizedPath !== currentPath) queue.push(normalizedPath);
          continue;
        }
        const file = normalizeStat({ ...entry, filename: normalizedPath }, credentials.rootPath);
        if (file) files.push(file);
      }
    }
    return files.toSorted((left, right) => left.path.localeCompare(right.path));
  }

  async downloadToFile(
    credentials: WebDavConnectionCredentials,
    remotePath: string,
    destinationPath: string,
    maxBytes: number
  ): Promise<void> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('CONNECTOR_WEBDAV_FILE_TOO_LARGE');
    const normalizedPath = assertWithinRoot(credentials.rootPath, remotePath);
    const transport = this.createTransport(credentials);
    let bytes = 0;
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > maxBytes) {
          callback(new Error('CONNECTOR_WEBDAV_FILE_TOO_LARGE'));
          return;
        }
        callback(null, chunk);
      },
    });
    try {
      await pipeline(
        transport.createReadStream(normalizedPath),
        counter,
        createWriteStream(destinationPath, { mode: 0o600 })
      );
      chmodSync(destinationPath, 0o600);
    } catch (error) {
      rmSync(destinationPath, { force: true });
      throw error;
    }
  }
}
