import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { S3ConnectorService } from '@process/services/personal-core/connectors/s3/S3ConnectorService';
import type { S3ConnectionCredentials, S3RemoteObject } from '@process/services/personal-core/connectors/s3/types';
import type { InboxImportResult } from '@/common/types/searcht/inbox';

let directory: string;
let database: PersonalDatabase;
let service: S3ConnectorService;
let remoteMocks: {
  test: ReturnType<typeof vi.fn>;
  listObjects: ReturnType<typeof vi.fn>;
  downloadToFile: ReturnType<typeof vi.fn>;
};
let secretsStore: Map<string, unknown>;
let importCounter: number;

const object = (key: string, etag = 'e1'): S3RemoteObject => ({
  key,
  name: key.split('/').pop() || key,
  sizeBytes: 12,
  modifiedAt: 1_000,
  etag,
});

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-s3-connector-'));
  database = PersonalDatabase.open(directory);
  remoteMocks = {
    test: vi.fn(async () => ({ entries: 0 })),
    listObjects: vi.fn(async (_credentials: S3ConnectionCredentials, max: number) =>
      ['notes/a.md', 'notes/b.md'].map((key) => object(key)).slice(0, max)
    ),
    downloadToFile: vi.fn(async (_credentials, file: S3RemoteObject, destination: string) => {
      writeFileSync(destination, `content of ${file.key}`);
    }),
  };
  secretsStore = new Map();
  importCounter = 0;
  const inbox = {
    importFiles: vi.fn(async (): Promise<InboxImportResult> => {
      importCounter += 1;
      return {
        imported: [{ outcome: 'created', detail: { item: { id: `item-${importCounter}` } } }],
        failed: [],
      } as unknown as InboxImportResult;
    }),
  };
  const secrets = {
    setS3: (id: string, value: unknown) => void secretsStore.set(id, value),
    getS3: (id: string) => (secretsStore.get(id) as never) ?? null,
    delete: (id: string) => void secretsStore.delete(id),
  };
  service = new S3ConnectorService(database.driver, inbox, secrets, remoteMocks, path.join(directory, 'tmp'));
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

function makeCreateInput() {
  return {
    kind: 's3' as const,
    provider: 'custom-s3' as const,
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    bucket: 'bucket',
    accessKeyId: process.env.SEARCHT_UNIT_TEST_S3_ACCESS_KEY_ID ?? 'unit-test-access-key-id',
    secretAccessKey: process.env.SEARCHT_UNIT_TEST_S3_SECRET_ACCESS_KEY ?? 'unit-test-secret-access-key',
    initialSync: 'import-existing' as const,
  };
}

describe('S3ConnectorService', () => {
  it('creates a connection, imports every object once, and stays idempotent', async () => {
    const first = await service.create(makeCreateInput(), 1_000);
    expect(first).toMatchObject({ scanned: 2, imported: 2, failed: 0 });
    expect(remoteMocks.downloadToFile).toHaveBeenCalledTimes(2);
    expect(service.list()).toHaveLength(1);
    expect(service.list()[0]).toMatchObject({ kind: 's3', state: 'active' });

    const second = await service.sync(first.connector.id, 2_000);
    expect(second).toMatchObject({ scanned: 2, imported: 0, skipped: 2 });
    expect(remoteMocks.downloadToFile).toHaveBeenCalledTimes(2);
  });

  it('re-imports an object after its etag changes', async () => {
    const created = await service.create(makeCreateInput(), 1_000);
    remoteMocks.listObjects.mockResolvedValue([object('notes/a.md', 'e2'), object('notes/b.md')]);

    const result = await service.sync(created.connector.id, 2_000);

    expect(result).toMatchObject({ imported: 1, skipped: 1 });
  });

  it('rejects duplicate connections for the same bucket and prefix', async () => {
    await service.create(makeCreateInput(), 1_000);
    await expect(service.create(makeCreateInput(), 2_000)).rejects.toThrow('CONNECTOR_ALREADY_EXISTS');
  });

  it('records a failed sync with a stable error code and supports disconnect', async () => {
    const created = await service.create(makeCreateInput(), 1_000);
    remoteMocks.listObjects.mockRejectedValue(new Error('boom'));

    await expect(service.sync(created.connector.id, 3_000)).rejects.toThrow('CONNECTOR_S3_CONNECTION_FAILED');
    expect(service.list()[0]).toMatchObject({ state: 'error', lastErrorCode: 'CONNECTOR_S3_CONNECTION_FAILED' });

    service.disconnect(created.connector.id, 4_000);
    expect(service.list()).toHaveLength(0);
    expect(secretsStore.size).toBe(0);
  });
});
