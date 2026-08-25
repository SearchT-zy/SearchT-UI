import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebDavReadClient } from '@process/services/personal-core/connectors/webdav/WebDavReadClient';
import type {
  WebDavConnectionCredentials,
  WebDavTransport,
} from '@process/services/personal-core/connectors/webdav/types';

const credentials: WebDavConnectionCredentials = {
  provider: 'custom-webdav',
  serverUrl: 'https://dav.example.com/',
  username: 'person',
  password: 'secret',
  rootPath: '/',
};
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('WebDavReadClient', () => {
  it('lists files recursively with bounded depth-one reads and normalized metadata', async () => {
    const transport: WebDavTransport = {
      getDirectoryContents: vi.fn(async (remotePath) =>
        remotePath === '/'
          ? [
              { filename: '/docs', basename: 'docs', type: 'directory', size: 0, lastmod: '', etag: null },
              {
                filename: '/root.txt',
                basename: 'root.txt',
                type: 'file',
                size: 4,
                lastmod: '2026-08-21T00:00:00Z',
                etag: 'r1',
              },
            ]
          : [{ filename: '/docs/note.md', basename: 'note.md', type: 'file', size: 8, lastmod: '', etag: null }]
      ),
      createReadStream: vi.fn(),
    };
    const client = new WebDavReadClient(() => transport);

    await expect(client.listFiles(credentials, 10)).resolves.toEqual([
      { path: '/docs/note.md', name: 'note.md', sizeBytes: 8, modifiedAt: null, etag: null },
      { path: '/root.txt', name: 'root.txt', sizeBytes: 4, modifiedAt: Date.parse('2026-08-21T00:00:00Z'), etag: 'r1' },
    ]);
    expect(transport.getDirectoryContents).toHaveBeenCalledTimes(2);
  });

  it('stops before an excessive directory listing can consume unbounded resources', async () => {
    const transport: WebDavTransport = {
      getDirectoryContents: vi.fn(async () =>
        Array.from({ length: 4 }, (_, index) => ({
          filename: `/file-${index}.txt`,
          basename: `file-${index}.txt`,
          type: 'file' as const,
          size: 1,
          lastmod: '',
          etag: null,
        }))
      ),
      createReadStream: vi.fn(),
    };
    const client = new WebDavReadClient(() => transport);

    await expect(client.listFiles(credentials, 3)).rejects.toThrow('CONNECTOR_WEBDAV_SCAN_LIMIT');
  });

  it('downloads through a stream and enforces the byte limit', async () => {
    const transport: WebDavTransport = {
      getDirectoryContents: vi.fn(),
      createReadStream: vi.fn(() => Readable.from([Buffer.from('hello')])),
    };
    const client = new WebDavReadClient(() => transport);
    const directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-webdav-client-'));
    directories.push(directory);
    const destination = path.join(directory, 'file.txt');

    await client.downloadToFile(credentials, '/file.txt', destination, 5);
    expect(readFileSync(destination, 'utf8')).toBe('hello');
    await expect(client.downloadToFile(credentials, '/file.txt', destination, 4)).rejects.toThrow(
      'CONNECTOR_WEBDAV_FILE_TOO_LARGE'
    );
  });

  it('creates a transport with redirects rejected and exposes no write operation', () => {
    const factory = vi.fn(
      (): WebDavTransport => ({
        getDirectoryContents: vi.fn(),
        createReadStream: vi.fn(),
      })
    );
    const client = new WebDavReadClient(factory);

    client.createTransport(credentials);
    expect(factory).toHaveBeenCalledWith('https://dav.example.com/', {
      username: 'person',
      password: 'secret',
      redirect: 'error',
    });
    expect(Object.keys(client).join(' ')).not.toMatch(/upload|delete|move|write/i);
  });
});
