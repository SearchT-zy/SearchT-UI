import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { CloudSyncService, type CloudSyncSecrets } from '@process/services/personal-core/cloudSync/CloudSyncService';
import { createMemorySyncTransport } from '@process/services/personal-core/cloudSync/CloudSyncTransport';
import { encryptBundle } from '@process/services/personal-core/cloudSync/CloudSyncCrypto';

let directory: string;
let secondDirectory: string;
let database: PersonalDatabase;
let secondDatabase: PersonalDatabase | null = null;
let sharedTransport: ReturnType<typeof createMemorySyncTransport>;
let secrets: Map<string, CloudSyncSecrets>;
let clock: number;

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-cloud-sync-'));
  database = PersonalDatabase.open(directory);
  sharedTransport = createMemorySyncTransport();
  secrets = new Map();
  clock = 1_000;
});

afterEach(() => {
  database.close();
  secondDatabase?.close();
  rmSync(directory, { recursive: true, force: true });
  if (secondDirectory) rmSync(secondDirectory, { recursive: true, force: true });
});

function makeService(): CloudSyncService {
  return new CloudSyncService(
    database.driver,
    () => sharedTransport,
    {
      set: (id, value) => void secrets.set(id, value),
      get: (id) => secrets.get(id) ?? null,
      delete: (id) => void secrets.delete(id),
    },
    () => clock
  );
}

function makeSecondDeviceService(): CloudSyncService {
  secondDirectory = mkdtempSync(path.join(os.tmpdir(), 'searcht-cloud-sync-second-'));
  secondDatabase = PersonalDatabase.open(secondDirectory);
  const secondSecrets = new Map<string, CloudSyncSecrets>();
  secrets = secondSecrets;
  return new CloudSyncService(
    secondDatabase.driver,
    () => sharedTransport,
    {
      set: (id, value) => void secondSecrets.set(id, value),
      get: (id) => secondSecrets.get(id) ?? null,
      delete: (id) => void secondSecrets.delete(id),
    },
    () => clock
  );
}

function webdavConnection() {
  return {
    mode: 'webdav' as const,
    serverUrl: 'https://dav.example.com/sync',
    username: process.env.SEARCHT_UNIT_TEST_WEBDAV_USERNAME ?? 'unit-test-username',
    password: process.env.SEARCHT_UNIT_TEST_WEBDAV_PASSWORD ?? 'unit-test-password',
    rootPath: '/searcht',
  };
}

function seedNote(id: string, title: string, updatedAt: number): void {
  database.driver
    .prepare(`INSERT INTO notes (id, title, body, revision_number, archived_at, created_at, updated_at, deleted_at)
      VALUES (?, ?, 'body', 1, NULL, ?, ?, NULL)`)
    .run(id, title, updatedAt, updatedAt);
}

describe('CloudSyncService', () => {
  it('configures a sync root, pushes an encrypted snapshot, and pulls it on a second device', async () => {
    seedNote('note-1', 'First note', 500);
    const first = makeService();
    await first.configure({ mode: 'webdav', passphrase: 'correct horse battery', connection: webdavConnection() });

    const push = await first.syncNow();

    expect(push.errorCode).toBeNull();
    expect(push.pushed).toBe(1);
    // Remote only ever sees opaque encrypted bundles plus the salted key file.
    const keyFile = JSON.parse(sharedTransport.store.get('searcht-sync/keyfile.json')!.toString('utf8'));
    expect(keyFile.masterSalt).toBeTruthy();
    expect(keyFile.verifier).toBeTruthy();
    const bundle = sharedTransport.store.get('searcht-sync/manifest.zxsync')!;
    expect(bundle.subarray(0, 7).toString('utf8')).toBe('ZXSYNC1');
    expect(bundle.toString('utf8')).not.toContain('First note');

    // A fresh device joins the same remote root with the same passphrase.
    const second = makeSecondDeviceService();
    const status = await second.configure({
      mode: 'webdav',
      passphrase: 'correct horse battery',
      connection: webdavConnection(),
    });
    expect(status.mode).toBe('webdav');
    const pull = await second.syncNow();
    expect(pull.pulled).toBe(1);
    expect(pull.errorCode).toBeNull();
    const note = secondDatabase!.driver.prepare("SELECT title FROM notes WHERE id = 'note-1'").get() as {
      title: string;
    };
    expect(note.title).toBe('First note');
  });

  it('rejects a wrong passphrase when joining an existing root', async () => {
    const first = makeService();
    await first.configure({ mode: 'webdav', passphrase: 'correct horse battery', connection: webdavConnection() });

    const second = makeSecondDeviceService();
    await expect(
      second.configure({ mode: 'webdav', passphrase: 'wrong passphrase!', connection: webdavConnection() })
    ).rejects.toThrow('CLOUD_SYNC_PASSPHRASE_MISMATCH');
  });

  it('queues pushes offline and drains the outbox on the next successful sync', async () => {
    seedNote('note-2', 'Offline note', 600);
    let putShouldFail = false;
    const service = new CloudSyncService(
      database.driver,
      () => ({
        put: async (key: string, body: Buffer) => {
          if (putShouldFail) throw new Error('NETWORK_UNREACHABLE');
          await sharedTransport.put(key, body);
        },
        get: (key: string) => sharedTransport.get(key),
      }),
      {
        set: (id, value) => void secrets.set(id, value),
        get: (id) => secrets.get(id) ?? null,
        delete: (id) => void secrets.delete(id),
      },
      () => clock
    );
    await service.configure({ mode: 'webdav', passphrase: 'correct horse battery', connection: webdavConnection() });

    putShouldFail = true;
    const offline = await service.syncNow();
    expect(offline.errorCode).toBe('NETWORK_UNREACHABLE');
    expect(offline.outboxRemaining).toBe(1);

    clock += 3_600_000;
    putShouldFail = false;
    const recovered = await service.syncNow();
    expect(recovered.errorCode).toBeNull();
    expect(recovered.outboxRemaining).toBe(0);
    expect(recovered.pushed).toBe(1);
  });

  it('keeps local edits and creates an explicit conflict copy for concurrent note edits', async () => {
    seedNote('note-3', 'Local title', 900);
    const first = makeService();
    await first.configure({ mode: 'webdav', passphrase: 'correct horse battery', connection: webdavConnection() });
    await first.syncNow();

    // Simulate a concurrent remote edit by a different device after the shared base.
    clock += 1_000;
    const remoteSnapshot = {
      deviceId: 'device-remote',
      capturedAt: clock,
      records: [
        {
          table: 'notes',
          id: 'note-3',
          row: {
            id: 'note-3',
            title: 'Remote title',
            body: 'remote body',
            revision_number: 2,
            archived_at: null,
            created_at: 900,
            updated_at: clock,
            deleted_at: null,
          },
          updatedAt: clock,
          deletedAt: null,
        },
      ],
    };
    const secret = secrets.get('cloud-sync')!;
    const masterKey = Buffer.from(secret.masterKey!, 'base64');
    const bundle = encryptBundle(Buffer.from(JSON.stringify(remoteSnapshot), 'utf8'), masterKey);
    await sharedTransport.put('searcht-sync/data-remote.zxsync', bundle);
    await sharedTransport.put(
      'searcht-sync/manifest.zxsync',
      encryptBundle(
        Buffer.from(
          JSON.stringify({
            formatVersion: 1,
            deviceId: 'device-remote',
            updatedAt: clock,
            bundleKey: 'searcht-sync/data-remote.zxsync',
            recordCount: 1,
          }),
          'utf8'
        ),
        masterKey
      )
    );

    // Local edit after the shared base makes both sides changed.
    database.driver
      .prepare('UPDATE notes SET title = ?, updated_at = ? WHERE id = ?')
      .run('Local title v2', clock + 1, 'note-3');

    const report = await first.syncNow();

    expect(report.conflicts).toEqual([
      expect.objectContaining({ table: 'notes', recordId: 'note-3', remoteDeviceId: 'device-remote' }),
    ]);
    const local = database.driver.prepare("SELECT title FROM notes WHERE id = 'note-3'").get() as { title: string };
    expect(local.title).toBe('Local title v2');
    const conflictCopy = database.driver.prepare("SELECT title FROM notes WHERE id LIKE 'note-3.conflict-%'").get() as
      | { title: string }
      | undefined;
    expect(conflictCopy?.title).toBe('Remote title');
  });

  it('reports disabled state without touching the remote', async () => {
    const service = makeService();
    const report = await service.syncNow();
    expect(report.errorCode).toBe('CLOUD_SYNC_DISABLED');
    expect(service.getStatus().mode).toBe('disabled');
  });
});
