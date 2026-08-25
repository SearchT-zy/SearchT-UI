import { randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  ConnectorAccount,
  LocalFolderConnectorCreateInput,
  ConnectorSetStateInput,
  ConnectorSyncResult,
} from '@/common/types/searcht/connectors';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import type { InboxService } from '../InboxService';
import {
  ConnectorRepository,
  type ConnectorCursorEntry,
  type LocalFolderConnectorCursor,
  type StoredConnectorAccount,
} from './ConnectorRepository';

type InboxImporter = Pick<InboxService, 'importFiles'>;

type DiscoveredFile = ConnectorCursorEntry & {
  absolutePath: string;
  relativePath: string;
  name: string;
};

export class LocalFolderConnectorService {
  private readonly repository: ConnectorRepository;
  private readonly syncLocks = new Map<string, Promise<ConnectorSyncResult>>();

  constructor(
    driver: ISqliteDriver,
    private readonly inbox: InboxImporter
  ) {
    this.repository = new ConnectorRepository(driver);
  }

  create(input: LocalFolderConnectorCreateInput, now = Date.now()): ConnectorAccount {
    const folderPath = normalizeFolderPath(input.path);
    assertAvailableFolder(folderPath);
    if (this.repository.findLocalFolderByPath(folderPath)) throw new Error('CONNECTOR_ALREADY_EXISTS');
    const displayName = input.displayName?.trim() || path.basename(folderPath) || folderPath;
    const account = this.repository.insert({
      id: randomUUID(),
      kind: 'local-folder',
      displayName,
      state: 'active',
      config: { path: folderPath, includeSubfolders: input.includeSubfolders },
      cursor: {},
      lastSyncAt: null,
      lastSuccessAt: null,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    });
    this.repository.insertAudit(randomUUID(), 'connector_create', 'success', { connectorId: account.id }, now);
    return publicAccount(account);
  }

  list(): ConnectorAccount[] {
    return this.repository
      .list()
      .filter(
        (account): account is Extract<StoredConnectorAccount, { kind: 'local-folder' }> =>
          account.kind === 'local-folder'
      )
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
    const account = this.repository.setState(input.id, input.state, null, now);
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
    this.repository.disconnect(id, now);
    this.repository.insertAudit(randomUUID(), 'connector_disconnect', 'success', { connectorId: id }, now);
  }

  private async performSync(id: string, now: number): Promise<ConnectorSyncResult> {
    const account = this.repository.findById(id);
    if (!account) throw new Error('CONNECTOR_NOT_FOUND');
    if (account.kind !== 'local-folder') throw new Error('CONNECTOR_KIND_UNSUPPORTED');
    if (account.state === 'paused') throw new Error('CONNECTOR_PAUSED');

    let files: DiscoveredFile[];
    try {
      files = await discoverFiles(account.config.path, account.config.includeSubfolders);
    } catch (error) {
      const code = connectorErrorCode(error);
      this.repository.recordFailure(id, code, now);
      this.repository.insertAudit(randomUUID(), 'connector_sync', 'failure', { connectorId: id, code }, now);
      throw new Error(code, { cause: error });
    }

    const nextCursor: LocalFolderConnectorCursor = {};
    let imported = 0;
    let reused = 0;
    let skipped = 0;
    let failed = 0;
    for (const file of files) {
      const previous = account.cursor[file.relativePath];
      if (previous?.sizeBytes === file.sizeBytes && previous.modifiedAt === file.modifiedAt) {
        nextCursor[file.relativePath] = cursorEntry(file);
        skipped += 1;
        continue;
      }
      // Keep folder ingestion sequential so the existing Inbox pipeline bounds disk IO.
      // oxlint-disable-next-line no-await-in-loop
      const result = await this.inbox.importFiles(
        { files: [{ kind: 'path', name: file.name, path: file.absolutePath, sizeBytes: file.sizeBytes }] },
        now
      );
      const importedFile = result.imported[0];
      if (importedFile) {
        nextCursor[file.relativePath] = cursorEntry(file);
        imported += 1;
        if (importedFile.outcome === 'reused') reused += 1;
      } else {
        if (previous) nextCursor[file.relativePath] = previous;
        failed += 1;
      }
    }

    const connector =
      failed === 0
        ? this.repository.recordSuccess(id, nextCursor, now)
        : this.repository.recordPartialFailure(id, nextCursor, 'CONNECTOR_IMPORT_PARTIAL_FAILURE', now);
    const result = {
      connector: publicAccount(connector),
      scanned: files.length,
      imported,
      reused,
      skipped,
      failed,
    };
    this.repository.insertAudit(
      randomUUID(),
      'connector_sync',
      failed === 0 ? 'success' : 'failure',
      { connectorId: id, scanned: files.length, imported, reused, skipped, failed },
      now
    );
    return result;
  }
}

async function discoverFiles(root: string, includeSubfolders: boolean): Promise<DiscoveredFile[]> {
  await assertAvailableFolderAsync(root);
  const files: DiscoveredFile[] = [];
  await visitDirectory(root, root, includeSubfolders, files);
  return files.toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function visitDirectory(
  root: string,
  directory: string,
  includeSubfolders: boolean,
  files: DiscoveredFile[]
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (includeSubfolders && !entry.name.startsWith('.')) {
        // oxlint-disable-next-line no-await-in-loop
        await visitDirectory(root, absolutePath, true, files);
      }
      continue;
    }
    if (!entry.isFile()) continue;
    // Re-check the entry to avoid importing a file replaced by a symbolic link after readdir.
    // oxlint-disable-next-line no-await-in-loop
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) continue;
    files.push({
      absolutePath,
      relativePath: path.relative(root, absolutePath).split(path.sep).join('/'),
      name: entry.name,
      sizeBytes: metadata.size,
      modifiedAt: metadata.mtimeMs,
    });
  }
}

function normalizeFolderPath(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error('CONNECTOR_FOLDER_REQUIRED');
  return path.resolve(normalized);
}

function assertAvailableFolder(folderPath: string): void {
  try {
    const metadata = lstatSync(folderPath);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error();
  } catch {
    throw new Error('CONNECTOR_FOLDER_UNAVAILABLE');
  }
}

async function assertAvailableFolderAsync(folderPath: string): Promise<void> {
  try {
    const metadata = await lstat(folderPath);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error();
  } catch {
    throw new Error('CONNECTOR_FOLDER_UNAVAILABLE');
  }
}

function cursorEntry(file: ConnectorCursorEntry): ConnectorCursorEntry {
  return { sizeBytes: file.sizeBytes, modifiedAt: file.modifiedAt };
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
  return 'CONNECTOR_FOLDER_UNAVAILABLE';
}
