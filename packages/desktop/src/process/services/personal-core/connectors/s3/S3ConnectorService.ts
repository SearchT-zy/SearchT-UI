import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type {
  ConnectorAccount,
  ConnectorSetStateInput,
  ConnectorSyncResult,
  S3ConnectorCreateInput,
  S3ConnectorTestInput,
} from '@/common/types/searcht/connectors';
import type { InboxFileImportInput, InboxImportResult } from '@/common/types/searcht/inbox';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import type { S3ConnectorSecret } from '../ConnectorSecretStore';
import {
  ConnectorRepository,
  type S3ConnectorCursor,
  type StoredConnectorAccount,
  type WebDavConnectorCursorEntry,
} from '../ConnectorRepository';
import { WebDavIngestRepository } from '../webdav/WebDavIngestRepository';
import { resolveS3Connection } from './providerPresets';
import type { S3ConnectionCredentials, S3RemoteObject } from './types';
import type { S3ReadClient } from './S3ReadClient';

const MAX_SCAN_ENTRIES = 2_000;
const MAX_IMPORTS_PER_SYNC = 50;
const MAX_FILE_BYTES = 100 * 1024 * 1024;

type S3InboxPort = {
  importFiles(input: InboxFileImportInput, now?: number): Promise<InboxImportResult>;
};

type S3SecretPort = {
  setS3(id: string, value: S3ConnectorSecret): void;
  getS3(id: string): S3ConnectorSecret | null;
  delete(id: string): void;
};

type S3ClientPort = Pick<S3ReadClient, 'test' | 'listObjects' | 'downloadToFile'>;

export class S3ConnectorService {
  private readonly repository: ConnectorRepository;
  private readonly ingest: WebDavIngestRepository;
  private readonly syncLocks = new Map<string, Promise<ConnectorSyncResult>>();

  constructor(
    driver: ISqliteDriver,
    private readonly inbox: S3InboxPort,
    private readonly secrets: S3SecretPort,
    private readonly remote: S3ClientPort,
    private readonly temporaryRoot: string
  ) {
    this.repository = new ConnectorRepository(driver);
    this.ingest = new WebDavIngestRepository(driver);
  }

  async test(input: S3ConnectorTestInput): Promise<void> {
    const credentials = resolveS3Connection(input);
    try {
      await this.remote.test(credentials);
    } catch (error) {
      // Raw transport errors can contain server response details and must not cross IPC.
      // oxlint-disable-next-line preserve-caught-error
      throw new Error(s3ErrorCode(error));
    }
  }

  async create(input: S3ConnectorCreateInput, now = Date.now()): Promise<ConnectorSyncResult> {
    if (input.kind !== 's3') throw new Error('CONNECTOR_KIND_UNSUPPORTED');
    if (input.initialSync !== 'from-now' && input.initialSync !== 'import-existing') {
      throw new Error('CONNECTOR_S3_INITIAL_SYNC_INVALID');
    }
    const credentials = resolveS3Connection(input);
    const displayName = normalizeDisplayName(input.displayName, input.provider);
    if (this.repository.findS3(input.provider, credentials.bucket, credentials.prefix)) {
      throw new Error('CONNECTOR_ALREADY_EXISTS');
    }

    let initialObjects: S3RemoteObject[] | null = null;
    try {
      await this.remote.test(credentials);
      if (input.initialSync === 'from-now') {
        initialObjects = await this.remote.listObjects(credentials, MAX_SCAN_ENTRIES);
      }
    } catch (error) {
      // oxlint-disable-next-line preserve-caught-error
      throw new Error(s3ErrorCode(error));
    }

    const initialCursor: S3ConnectorCursor = initialObjects ? cursorFromObjects(initialObjects) : {};
    const account = this.repository.insert({
      id: randomUUID(),
      kind: 's3',
      displayName,
      state: 'active',
      config: {
        provider: input.provider,
        bucket: credentials.bucket,
        prefix: credentials.prefix,
        pathStyle: credentials.pathStyle,
        initialSync: input.initialSync,
      },
      cursor: initialCursor,
      lastSyncAt: initialObjects ? now : null,
      lastSuccessAt: initialObjects ? now : null,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    });
    try {
      this.secrets.setS3(account.id, {
        endpoint: credentials.endpoint,
        region: credentials.region,
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
      });
    } catch (error) {
      this.repository.deletePermanently(account.id);
      throw error;
    }
    this.repository.insertAudit(
      randomUUID(),
      'connector_create',
      'success',
      { connectorId: account.id, provider: input.provider, bucket: credentials.bucket },
      now
    );
    if (input.initialSync === 'import-existing') return this.sync(account.id, now);
    return {
      connector: publicAccount(requireKind(account)),
      scanned: initialObjects!.length,
      imported: 0,
      reused: 0,
      skipped: initialObjects!.length,
      failed: 0,
    };
  }

  list(): ConnectorAccount[] {
    return this.repository
      .list()
      .filter((account): account is Extract<StoredConnectorAccount, { kind: 's3' }> => account.kind === 's3')
      .map(publicAccount);
  }

  sync(id: string, now = Date.now()): Promise<ConnectorSyncResult> {
    const running = this.syncLocks.get(id);
    if (running) return running;
    const operation = this.performSync(id, now).finally(() => {
      if (this.syncLocks.get(id) === operation) this.syncLocks.delete(id);
    });
    this.syncLocks.set(id, operation);
    return operation;
  }

  setState(input: ConnectorSetStateInput, now = Date.now()): ConnectorAccount {
    const current = this.requireS3Account(input.id);
    const account = this.repository.setState(current.id, input.state, null, now);
    this.repository.insertAudit(
      randomUUID(),
      input.state === 'paused' ? 'connector_pause' : 'connector_resume',
      'success',
      { connectorId: input.id },
      now
    );
    return publicAccount(requireKind(account));
  }

  disconnect(id: string, now = Date.now()): void {
    this.requireS3Account(id);
    this.repository.disconnect(id, now);
    this.secrets.delete(id);
    this.repository.insertAudit(randomUUID(), 'connector_disconnect', 'success', { connectorId: id }, now);
  }

  private async performSync(id: string, now: number): Promise<ConnectorSyncResult> {
    const account = this.requireS3Account(id);
    if (account.state === 'paused') throw new Error('CONNECTOR_PAUSED');
    const secret = this.secrets.getS3(id);
    if (!secret) return this.failSync(account, 'CONNECTOR_S3_CREDENTIAL_MISSING', now);
    const credentials: S3ConnectionCredentials = {
      provider: account.config.provider,
      bucket: account.config.bucket,
      prefix: account.config.prefix,
      pathStyle: account.config.pathStyle,
      ...secret,
    };
    let objects: S3RemoteObject[];
    try {
      objects = await this.remote.listObjects(credentials, MAX_SCAN_ENTRIES);
    } catch (error) {
      return this.failSync(account, s3ErrorCode(error), now);
    }

    const cursor: S3ConnectorCursor = { ...account.cursor };
    let imported = 0;
    let reused = 0;
    let skipped = 0;
    let failed = 0;
    let errorCode: string | null = null;
    for (const object of objects) {
      const version = cursorEntry(object);
      if (sameVersion(cursor[object.key], version)) {
        skipped += 1;
        continue;
      }
      if (object.sizeBytes > MAX_FILE_BYTES || imported >= MAX_IMPORTS_PER_SYNC) {
        skipped += 1;
        if (object.sizeBytes > MAX_FILE_BYTES) cursor[object.key] = version;
        continue;
      }
      const contentHash = JSON.stringify([version.etag, version.modifiedAt, version.sizeBytes]);
      const existing = this.ingest.find(account.id, object.key);
      if (existing?.state === 'complete' && existing.contentHash === contentHash) {
        cursor[object.key] = version;
        skipped += 1;
        continue;
      }
      try {
        // oxlint-disable-next-line no-await-in-loop
        const outcome = await this.importObject(account.id, credentials, object, contentHash, now);
        cursor[object.key] = version;
        imported += 1;
        if (outcome === 'reused') reused += 1;
      } catch (error) {
        failed += 1;
        errorCode ??= s3ErrorCode(error);
      }
    }
    const updated =
      failed === 0
        ? this.repository.recordSuccess(id, cursor, now)
        : this.repository.recordPartialFailure(id, cursor, errorCode!, now);
    this.repository.insertAudit(
      randomUUID(),
      'connector_sync',
      failed === 0 ? 'success' : 'failure',
      { connectorId: id, scanned: objects.length, imported, reused, skipped, failed, code: errorCode },
      now
    );
    return {
      connector: publicAccount(requireKind(updated)),
      scanned: objects.length,
      imported,
      reused,
      skipped,
      failed,
    };
  }

  private async importObject(
    connectorId: string,
    credentials: S3ConnectionCredentials,
    object: S3RemoteObject,
    contentHash: string,
    now: number
  ): Promise<'created' | 'reused'> {
    this.ingest.begin(connectorId, object.key, contentHash, now);
    mkdirSync(this.temporaryRoot, { recursive: true, mode: 0o700 });
    const temporaryDirectory = mkdtempSync(path.join(this.temporaryRoot, 'object-'));
    const temporaryPath = path.join(temporaryDirectory, safeFileName(object.name));
    try {
      await this.remote.downloadToFile(credentials, object, temporaryPath, MAX_FILE_BYTES);
      const result = await this.inbox.importFiles(
        {
          files: [
            {
              kind: 'path',
              name: object.name,
              path: temporaryPath,
              originalPath: object.key,
              sizeBytes: object.sizeBytes,
            },
          ],
        },
        now
      );
      const imported = result.imported[0];
      if (!imported) throw new Error(result.failed[0]?.code ?? 'INBOX_IMPORT_FAILED');
      this.ingest.appendInboxItem(connectorId, object.key, imported.detail.item.id, now);
      this.ingest.complete(connectorId, object.key, now);
      return imported.outcome;
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }

  private requireS3Account(id: string): Extract<StoredConnectorAccount, { kind: 's3' }> {
    const account = this.repository.findById(id);
    if (!account) throw new Error('CONNECTOR_NOT_FOUND');
    if (account.kind !== 's3') throw new Error('CONNECTOR_KIND_UNSUPPORTED');
    return account;
  }

  private failSync(account: StoredConnectorAccount, code: string, now: number): never {
    this.repository.recordFailure(account.id, code, now);
    this.repository.insertAudit(randomUUID(), 'connector_sync', 'failure', { connectorId: account.id, code }, now);
    throw new Error(code);
  }
}

function normalizeDisplayName(value: string | undefined, provider: S3ConnectorCreateInput['provider']): string {
  const defaults: Record<string, string> = {
    'aws-s3': 'Amazon S3',
    'cloudflare-r2': 'Cloudflare R2',
    'custom-s3': 'S3 compatible storage',
  };
  const normalized = value?.trim() || defaults[provider];
  if (normalized.length > 200) throw new Error('CONNECTOR_DISPLAY_NAME_INVALID');
  return normalized;
}

function cursorEntry(object: S3RemoteObject): WebDavConnectorCursorEntry {
  return { etag: object.etag, modifiedAt: object.modifiedAt, sizeBytes: object.sizeBytes };
}

function cursorFromObjects(objects: S3RemoteObject[]): S3ConnectorCursor {
  return Object.fromEntries(objects.map((object) => [object.key, cursorEntry(object)]));
}

function sameVersion(left: WebDavConnectorCursorEntry | undefined, right: WebDavConnectorCursorEntry): boolean {
  return (
    !!left && left.etag === right.etag && left.modifiedAt === right.modifiedAt && left.sizeBytes === right.sizeBytes
  );
}

function requireKind(account: StoredConnectorAccount): Extract<StoredConnectorAccount, { kind: 's3' }> {
  if (account.kind !== 's3') throw new Error('CONNECTOR_KIND_UNSUPPORTED');
  return account;
}

function publicAccount(account: Extract<StoredConnectorAccount, { kind: 's3' }>): ConnectorAccount {
  return {
    id: account.id,
    kind: account.kind,
    displayName: account.displayName,
    state: account.state,
    config: account.config,
    lastSyncAt: account.lastSyncAt,
    lastSuccessAt: account.lastSuccessAt,
    lastErrorCode: account.lastErrorCode,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function s3ErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) return error.message;
  return 'CONNECTOR_S3_CONNECTION_FAILED';
}

function safeFileName(value: string): string {
  const invalidCharacters = '<>:"/\\|?*';
  const normalized = [...path.basename(value)]
    .map((character) => (character.charCodeAt(0) < 32 || invalidCharacters.includes(character) ? '_' : character))
    .join('')
    .trim();
  return normalized || 'download';
}
