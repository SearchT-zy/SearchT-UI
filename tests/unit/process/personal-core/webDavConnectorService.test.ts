import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WebDavConnectorCreateInput } from '@/common/types/searcht/connectors';
import { InboxFileStore } from '@process/services/personal-core/InboxFileStore';
import { InboxService } from '@process/services/personal-core/InboxService';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import type { WebDavConnectorSecret } from '@process/services/personal-core/connectors/ConnectorSecretStore';
import { WebDavConnectorService } from '@process/services/personal-core/connectors/webdav/WebDavConnectorService';
import type {
  WebDavConnectionCredentials,
  WebDavRemoteFile,
} from '@process/services/personal-core/connectors/webdav/types';

const NOW = Date.parse('2026-08-21T12:00:00Z');
let directory: string;
let database: PersonalDatabase;
let inbox: InboxService;
let remote: FakeWebDavClient;
let secrets: FakeSecretStore;
let service: WebDavConnectorService;

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-webdav-connector-'));
  database = PersonalDatabase.open(directory);
  inbox = new InboxService(database.driver, new InboxFileStore(path.join(directory, 'personal-core', 'inbox')));
  remote = new FakeWebDavClient();
  secrets = new FakeSecretStore();
  service = new WebDavConnectorService(database.driver, inbox, secrets, remote, path.join(directory, 'webdav-temp'));
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

function createInput(initialSync: WebDavConnectorCreateInput['initialSync'] = 'from-now'): WebDavConnectorCreateInput {
  return {
    kind: 'webdav',
    provider: 'custom-webdav',
    serverUrl: 'https://dav.example.com/base',
    username: ' person ',
    password: ' secret ',
    rootPath: '\\documents\\',
    displayName: 'Documents',
    initialSync,
  };
}

function file(remotePath: string, version: string, content = remotePath): WebDavRemoteFile {
  return {
    path: remotePath,
    name: path.posix.basename(remotePath),
    sizeBytes: Buffer.byteLength(content),
    modifiedAt: NOW,
    etag: version,
  };
}

describe('WebDavConnectorService', () => {
  it('tests normalized credentials before persisting only a redacted account', async () => {
    const result = await service.create(createInput(), NOW);

    expect(remote.tested[0]).toEqual({
      provider: 'custom-webdav',
      serverUrl: 'https://dav.example.com/base/',
      username: 'person',
      password: 'secret',
      rootPath: '/documents',
    });
    expect(secrets.entries.get(result.connector.id)).toEqual({
      serverUrl: 'https://dav.example.com/base/',
      username: 'person',
      password: 'secret',
    });
    expect(result.connector).toMatchObject({
      kind: 'webdav',
      displayName: 'Documents',
      config: { provider: 'custom-webdav', rootPath: '/documents', initialSync: 'from-now' },
    });
    expect(JSON.stringify(result.connector)).not.toMatch(/dav\.example|person|secret/i);
  });

  it('rolls back the account when encrypted secret persistence fails', async () => {
    secrets.setError = new Error('CONNECTOR_SECRET_WRITE_FAILED');

    await expect(service.create(createInput(), NOW)).rejects.toThrow('CONNECTOR_SECRET_WRITE_FAILED');

    expect(database.driver.prepare('SELECT COUNT(*) AS count FROM connector_accounts').get()).toEqual({ count: 0 });
  });

  it('seeds the cursor without importing history for from-now', async () => {
    remote.setFiles([file('/documents/old.txt', 'v1', 'old')]);

    const result = await service.create(createInput('from-now'), NOW);

    expect(result).toMatchObject({ scanned: 1, imported: 0, skipped: 1, failed: 0 });
    expect(remote.downloaded).toEqual([]);
    expect(inbox.list({ view: 'pending' }).total).toBe(0);
  });

  it('imports existing files once, preserves remote paths, and imports changed versions', async () => {
    remote.setFiles([file('/documents/note.txt', 'v1', 'first')]);

    const created = await service.create(createInput('import-existing'), NOW);
    const repeated = await service.sync(created.connector.id, NOW + 1);
    remote.setFiles([file('/documents/note.txt', 'v2', 'second')]);
    const changed = await service.sync(created.connector.id, NOW + 2);

    expect(created).toMatchObject({ imported: 1, failed: 0 });
    expect(repeated).toMatchObject({ imported: 0, skipped: 1, failed: 0 });
    expect(changed).toMatchObject({ imported: 1, failed: 0 });
    const items = inbox.list({ view: 'pending' }).items;
    expect(items).toHaveLength(2);
    expect(inbox.get(items[0]!.id)?.origin?.originalPath).toBe('/documents/note.txt');
  });

  it('keeps failed files retryable while continuing other imports', async () => {
    const created = await service.create(createInput(), NOW);
    remote.setFiles([file('/documents/a.txt', 'v1', 'a'), file('/documents/b.txt', 'v1', 'b')]);
    remote.failOnce.add('/documents/a.txt');

    const partial = await service.sync(created.connector.id, NOW + 1);
    const retried = await service.sync(created.connector.id, NOW + 2);

    expect(partial).toMatchObject({ scanned: 2, imported: 1, failed: 1 });
    expect(retried).toMatchObject({ scanned: 2, imported: 1, skipped: 1, failed: 0 });
    expect(inbox.list({ view: 'pending' }).total).toBe(2);
  });

  it('keeps imported Inbox items and deletes the secret when disconnected', async () => {
    remote.setFiles([file('/documents/note.txt', 'v1', 'content')]);
    const created = await service.create(createInput('import-existing'), NOW);

    service.disconnect(created.connector.id, NOW + 1);

    expect(service.list()).toEqual([]);
    expect(secrets.entries.has(created.connector.id)).toBe(false);
    expect(inbox.list({ view: 'pending' }).total).toBe(1);
  });

  it('shares one in-flight sync between overlapping requests', async () => {
    const created = await service.create(createInput(), NOW);
    remote.setFiles([file('/documents/note.txt', 'v1', 'content')]);
    remote.downloadGate = new Promise<void>((resolve) => {
      remote.releaseDownload = resolve;
    });

    const first = service.sync(created.connector.id, NOW + 1);
    const second = service.sync(created.connector.id, NOW + 2);
    remote.releaseDownload?.();

    expect(second).toBe(first);
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(inbox.list({ view: 'pending' }).total).toBe(1);
  });
});

class FakeSecretStore {
  readonly entries = new Map<string, WebDavConnectorSecret>();
  setError: Error | null = null;

  setWebDav(id: string, value: WebDavConnectorSecret): void {
    if (this.setError) throw this.setError;
    this.entries.set(id, value);
  }

  getWebDav(id: string): WebDavConnectorSecret | null {
    return this.entries.get(id) ?? null;
  }

  delete(id: string): void {
    this.entries.delete(id);
  }
}

class FakeWebDavClient {
  readonly tested: WebDavConnectionCredentials[] = [];
  readonly downloaded: string[] = [];
  readonly failOnce = new Set<string>();
  downloadGate: Promise<void> | null = null;
  releaseDownload: (() => void) | null = null;
  private files: WebDavRemoteFile[] = [];
  private contents = new Map<string, string>();

  setFiles(files: WebDavRemoteFile[]): void {
    this.files = files;
    this.contents = new Map(
      files.map((entry) => [
        entry.path,
        entry.etag === 'v2'
          ? 'second'
          : entry.name[0] === 'a' || entry.name[0] === 'b'
            ? entry.name[0]
            : entry.name === 'old.txt'
              ? 'old'
              : entry.etag === 'v1'
                ? 'first'
                : entry.name,
      ])
    );
  }

  async test(credentials: WebDavConnectionCredentials): Promise<{ entries: number }> {
    this.tested.push({ ...credentials });
    return { entries: this.files.length };
  }

  async listFiles(): Promise<WebDavRemoteFile[]> {
    return this.files.map((entry) => ({ ...entry }));
  }

  async downloadToFile(
    _credentials: WebDavConnectionCredentials,
    remotePath: string,
    destinationPath: string
  ): Promise<void> {
    this.downloaded.push(remotePath);
    await this.downloadGate;
    if (this.failOnce.delete(remotePath)) throw new Error('CONNECTOR_WEBDAV_DOWNLOAD_FAILED');
    writeFileSync(destinationPath, this.contents.get(remotePath) ?? remotePath);
  }
}
