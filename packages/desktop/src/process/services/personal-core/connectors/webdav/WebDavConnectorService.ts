import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type {
  ConnectorAccount,
  ConnectorSetStateInput,
  ConnectorSyncResult,
  WebDavConnectorCreateInput,
  WebDavConnectorTestInput,
} from '@/common/types/searcht/connectors';
import type { InboxFileImportInput, InboxImportResult } from '@/common/types/searcht/inbox';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import type { WebDavConnectorSecret } from '../ConnectorSecretStore';
import {
  ConnectorRepository,
  type StoredConnectorAccount,
  type WebDavConnectorCursor,
  type WebDavConnectorCursorEntry,
} from '../ConnectorRepository';
import { resolveWebDavConnection } from './providerPresets';
import type { WebDavConnectionCredentials, WebDavRemoteFile } from './types';
import type { WebDavReadClient } from './WebDavReadClient';
import { WebDavIngestRepository } from './WebDavIngestRepository';

const MAX_SCAN_ENTRIES = 2_000;
const MAX_IMPORTS_PER_SYNC = 50;
const MAX_FILE_BYTES = 100 * 1024 * 1024;

type WebDavInboxPort = {
  importFiles(input: InboxFileImportInput, now?: number): Promise<InboxImportResult>;
};

type WebDavSecretPort = {
  setWebDav(id: string, value: WebDavConnectorSecret): void;
  getWebDav(id: string): WebDavConnectorSecret | null;
  delete(id: string): void;
};

type WebDavClientPort = Pick<WebDavReadClient, 'test' | 'listFiles' | 'downloadToFile'>;

export class WebDavConnectorService {
  private readonly repository: ConnectorRepository;
  private readonly ingest: WebDavIngestRepository;
  private readonly syncLocks = new Map<string, Promise<ConnectorSyncResult>>();

  constructor(
    driver: ISqliteDriver,
    private readonly inbox: WebDavInboxPort,
    private readonly secrets: WebDavSecretPort,
    private readonly remote: WebDavClientPort,
    private readonly temporaryRoot: string
  ) {
    this.repository = new ConnectorRepository(driver);
    this.ingest = new WebDavIngestRepository(driver);
  }

  async test(input: WebDavConnectorTestInput): Promise<void> {
    const credentials = resolveWebDavConnection(input);
    try {
      await this.remote.test(credentials);
    } catch (error) {
      // Raw transport errors can contain server response details and must not cross IPC.
      // oxlint-disable-next-line preserve-caught-error
      throw new Error(connectorErrorCode(error));
    }
  }

  async create(input: WebDavConnectorCreateInput, now = Date.now()): Promise<ConnectorSyncResult> {
    if (input.kind !== 'webdav') throw new Error('CONNECTOR_KIND_UNSUPPORTED');
    if (input.initialSync !== 'from-now' && input.initialSync !== 'import-existing') {
      throw new Error('CONNECTOR_WEBDAV_INITIAL_SYNC_INVALID');
    }
    const credentials = resolveWebDavConnection(input);
    const displayName = normalizeDisplayName(input.displayName, input.provider);
    if (this.repository.findWebDav(input.provider, credentials.rootPath)) throw new Error('CONNECTOR_ALREADY_EXISTS');

    let initialFiles: WebDavRemoteFile[] | null = null;
    try {
      await this.remote.test(credentials);
      if (input.initialSync === 'from-now') {
        initialFiles = await this.remote.listFiles(credentials, MAX_SCAN_ENTRIES);
      }
    } catch (error) {
      // Raw transport errors can contain server response details and must not cross IPC.
      // oxlint-disable-next-line preserve-caught-error
      throw new Error(connectorErrorCode(error));
    }

    const initialCursor = initialFiles ? cursorFromFiles(initialFiles) : {};
    const account = this.repository.insert({
      id: randomUUID(),
      kind: 'webdav',
      displayName,
      state: 'active',
      config: { provider: input.provider, rootPath: credentials.rootPath, initialSync: input.initialSync },
      cursor: initialCursor,
      lastSyncAt: initialFiles ? now : null,
      lastSuccessAt: initialFiles ? now : null,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    });
    try {
      this.secrets.setWebDav(account.id, {
        serverUrl: credentials.serverUrl,
        username: credentials.username,
        password: credentials.password,
      });
    } catch (error) {
      this.repository.deletePermanently(account.id);
      throw error;
    }
    this.repository.insertAudit(
      randomUUID(),
      'connector_create',
      'success',
      { connectorId: account.id, provider: input.provider },
      now
    );
    if (input.initialSync === 'import-existing') return this.sync(account.id, now);
    return {
      connector: publicAccount(account),
      scanned: initialFiles!.length,
      imported: 0,
      reused: 0,
      skipped: initialFiles!.length,
      failed: 0,
    };
  }

  list(): ConnectorAccount[] {
    return this.repository
      .list()
      .filter((account): account is Extract<StoredConnectorAccount, { kind: 'webdav' }> => account.kind === 'webdav')
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
    const current = this.requireWebDavAccount(input.id);
    const account = this.repository.setState(current.id, input.state, null, now);
    this.repository.insertAudit(
      randomUUID(),
      input.state === 'paused' ? 'connector_pause' : 'connector_resume',
      'success',
      { connectorId: input.id },
      now
    );
    return publicAccount(account);
  }

  disconnect(id: string, now = Date.now()): void {
    this.requireWebDavAccount(id);
    this.repository.disconnect(id, now);
    this.secrets.delete(id);
    this.repository.insertAudit(randomUUID(), 'connector_disconnect', 'success', { connectorId: id }, now);
  }

  private async performSync(id: string, now: number): Promise<ConnectorSyncResult> {
    const account = this.requireWebDavAccount(id);
    if (account.state === 'paused') throw new Error('CONNECTOR_PAUSED');
    const secret = this.secrets.getWebDav(id);
    if (!secret) return this.failSync(account, 'CONNECTOR_WEBDAV_CREDENTIAL_MISSING', now);
    const credentials: WebDavConnectionCredentials = {
      provider: account.config.provider,
      rootPath: account.config.rootPath,
      ...secret,
    };
    let files: WebDavRemoteFile[];
    try {
      files = await this.remote.listFiles(credentials, MAX_SCAN_ENTRIES);
    } catch (error) {
      return this.failSync(account, connectorErrorCode(error), now);
    }

    const cursor: WebDavConnectorCursor = { ...account.cursor };
    let imported = 0;
    let reused = 0;
    let skipped = 0;
    let failed = 0;
    let errorCode: string | null = null;
    for (const file of files) {
      const version = cursorEntry(file);
      if (sameVersion(cursor[file.path], version)) {
        skipped += 1;
        continue;
      }
      if (file.sizeBytes > MAX_FILE_BYTES || imported >= MAX_IMPORTS_PER_SYNC) {
        skipped += 1;
        if (file.sizeBytes > MAX_FILE_BYTES) cursor[file.path] = version;
        continue;
      }
      const contentHash = versionFingerprint(version);
      const existing = this.ingest.find(account.id, file.path);
      if (existing?.state === 'complete' && existing.contentHash === contentHash) {
        cursor[file.path] = version;
        skipped += 1;
        continue;
      }
      try {
        // Keep remote downloads and managed-file imports sequential to bound disk IO.
        // oxlint-disable-next-line no-await-in-loop
        const outcome = await this.importFile(account.id, credentials, file, contentHash, now);
        cursor[file.path] = version;
        imported += 1;
        if (outcome === 'reused') reused += 1;
      } catch (error) {
        failed += 1;
        errorCode ??= connectorErrorCode(error);
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
      { connectorId: id, scanned: files.length, imported, reused, skipped, failed, code: errorCode },
      now
    );
    return { connector: publicAccount(updated), scanned: files.length, imported, reused, skipped, failed };
  }

  private async importFile(
    connectorId: string,
    credentials: WebDavConnectionCredentials,
    file: WebDavRemoteFile,
    contentHash: string,
    now: number
  ): Promise<'created' | 'reused'> {
    this.ingest.begin(connectorId, file.path, contentHash, now);
    mkdirSync(this.temporaryRoot, { recursive: true, mode: 0o700 });
    const temporaryDirectory = mkdtempSync(path.join(this.temporaryRoot, 'file-'));
    const temporaryPath = path.join(temporaryDirectory, safeFileName(file.name));
    try {
      await this.remote.downloadToFile(credentials, file.path, temporaryPath, MAX_FILE_BYTES);
      const result = await this.inbox.importFiles(
        {
          files: [
            {
              kind: 'path',
              name: file.name,
              path: temporaryPath,
              originalPath: file.path,
              sizeBytes: file.sizeBytes,
            },
          ],
        },
        now
      );
      const imported = result.imported[0];
      if (!imported) throw new Error(result.failed[0]?.code ?? 'INBOX_IMPORT_FAILED');
      this.ingest.appendInboxItem(connectorId, file.path, imported.detail.item.id, now);
      this.ingest.complete(connectorId, file.path, now);
      return imported.outcome;
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }

  private requireWebDavAccount(id: string): Extract<StoredConnectorAccount, { kind: 'webdav' }> {
    const account = this.repository.findById(id);
    if (!account) throw new Error('CONNECTOR_NOT_FOUND');
    if (account.kind !== 'webdav') throw new Error('CONNECTOR_KIND_UNSUPPORTED');
    return account;
  }

  private failSync(account: StoredConnectorAccount, code: string, now: number): never {
    this.repository.recordFailure(account.id, code, now);
    this.repository.insertAudit(randomUUID(), 'connector_sync', 'failure', { connectorId: account.id, code }, now);
    throw new Error(code);
  }
}

function normalizeDisplayName(value: string | undefined, provider: WebDavConnectorCreateInput['provider']): string {
  const normalized = value?.trim() || (provider === 'jianguoyun' ? 'Jianguoyun' : 'WebDAV');
  if (normalized.length > 200) throw new Error('CONNECTOR_DISPLAY_NAME_INVALID');
  return normalized;
}

function cursorEntry(file: WebDavRemoteFile): WebDavConnectorCursorEntry {
  return { etag: file.etag, modifiedAt: file.modifiedAt, sizeBytes: file.sizeBytes };
}

function cursorFromFiles(files: WebDavRemoteFile[]): WebDavConnectorCursor {
  return Object.fromEntries(files.map((file) => [file.path, cursorEntry(file)]));
}

function sameVersion(left: WebDavConnectorCursorEntry | undefined, right: WebDavConnectorCursorEntry): boolean {
  return (
    !!left && left.etag === right.etag && left.modifiedAt === right.modifiedAt && left.sizeBytes === right.sizeBytes
  );
}

function versionFingerprint(version: WebDavConnectorCursorEntry): string {
  return JSON.stringify([version.etag, version.modifiedAt, version.sizeBytes]);
}

function publicAccount(account: StoredConnectorAccount): ConnectorAccount {
  const base = {
    id: account.id,
    displayName: account.displayName,
    state: account.state,
    lastSyncAt: account.lastSyncAt,
    lastSuccessAt: account.lastSuccessAt,
    lastErrorCode: account.lastErrorCode,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
  if (account.kind === 'local-folder') return { ...base, kind: account.kind, config: account.config };
  if (account.kind === 'email-imap') return { ...base, kind: account.kind, config: account.config };
  return { ...base, kind: account.kind, config: account.config } as ConnectorAccount;
}

function connectorErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) return error.message;
  return 'CONNECTOR_WEBDAV_CONNECTION_FAILED';
}

function safeFileName(value: string): string {
  const invalidCharacters = '<>:"/\\|?*';
  const normalized = [...path.basename(value)]
    .map((character) => (character.charCodeAt(0) < 32 || invalidCharacters.includes(character) ? '_' : character))
    .join('')
    .trim();
  return normalized || 'download';
}
