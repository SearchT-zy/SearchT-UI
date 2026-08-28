import path from 'node:path';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import type {
  SearchtImportCategory,
  SearchtImportPlan,
  SearchtImportPlanCategory,
  SearchtImportReport,
  SearchtImportReportCategory,
} from '@/common/types/searcht/workspace';

/**
 * One-shot, non-destructive importer from a legacy SearchT installation.
 *
 * The source tree is only ever read from; all writes go to the SearchT data
 * directory. Every mutation is journaled so `rollback` can undo an import
 * without touching the source.
 */

export type SearchtMigrationFileIO = {
  exists(target: string): boolean;
  readFile(target: string): string;
  writeFile(target: string, data: string): void;
  listFiles(directory: string): string[];
  isDirectory(target: string): boolean;
  ensureDirectory(directory: string): void;
  copyFile(from: string, to: string): void;
  removeFile(target: string): void;
};

export type SourceCatalog = {
  tableNames(): string[];
  columns(table: string): string[];
  readAll(table: string): Record<string, unknown>[];
};

export type TargetCatalog = {
  tableNames(): string[];
  columns(table: string): string[];
  transaction(body: () => void): void;
  existingIds(table: string, ids: string[]): Set<string>;
  insertIgnore(table: string, columns: string[], rows: unknown[][]): number;
  deleteRows(table: string, ids: string[]): void;
};

export type SearchtMigrationReportStore = {
  save(report: SearchtImportReport, journal: RollbackJournal): void;
  load(id: string): { report: SearchtImportReport; journal: RollbackJournal } | null;
  markRolledBack(id: string, report: SearchtImportReport): void;
};

export type RollbackJournal = {
  insertedRows: Record<string, string[]>;
  originalConfig: string | null;
  addedConfigKeys: string[];
  mergedChatKeys: string[];
  originalChatFile: string | null;
  copiedFiles: string[];
  removedFlagKeys: string[];
  createdConfigFile: boolean;
  createdChatFile: boolean;
};

export type SearchtMigrationOptions = {
  now?: () => number;
  randomUUID?: () => string;
};

const DB_CATEGORY_TABLES: Array<{ category: SearchtImportCategory; tables: string[] }> = [
  { category: 'conversations', tables: ['conversations', 'messages'] },
  { category: 'workspaces', tables: ['teams', 'mailbox', 'team_tasks'] },
  { category: 'assistants', tables: ['assistant_plugins', 'assistant_users', 'assistant_sessions'] },
  { category: 'scheduled-tasks', tables: ['cron_jobs'] },
];

const CONFIG_CATEGORY_KEYS: Array<{ category: SearchtImportCategory; keys: string[] }> = [
  { category: 'models', keys: ['model.config'] },
  { category: 'mcp', keys: ['mcp.config'] },
  { category: 'themes', keys: ['theme.activeId', 'theme.userThemes'] },
];

const CONFIG_FILE_NAME = 'aionui-config.txt';
const CHAT_LIST_FILE_NAME = 'aionui-chat.txt';
const CHAT_HISTORY_DIRECTORY = 'aionui-chat-history';
const COPY_DIRECTORIES: Array<{ category: SearchtImportCategory; directory: string }> = [
  { category: 'assistants', directory: 'assistants' },
  { category: 'skills', directory: 'skills' },
  { category: 'scheduled-tasks', directory: 'cron-skills' },
  { category: 'conversations', directory: CHAT_HISTORY_DIRECTORY },
];

const TARGET_SYSTEM_USER_ID = 'system_default_user';

export class SearchtMigrationService {
  private readonly now: () => number;
  private readonly randomUUID: () => string;

  constructor(
    private readonly databasePath: string | null,
    private readonly source: SourceCatalog | null,
    private readonly target: TargetCatalog | null,
    private readonly sourceConfigDirectory: string | null,
    private readonly targetConfigDirectory: string,
    private readonly files: SearchtMigrationFileIO,
    private readonly reportStore: SearchtMigrationReportStore,
    options: SearchtMigrationOptions = {}
  ) {
    this.now = options.now ?? Date.now;
    this.randomUUID = options.randomUUID ?? (() => crypto.randomUUID());
  }

  plan(): SearchtImportPlan {
    const totals = new Map<SearchtImportCategory, number>();
    const add = (category: SearchtImportCategory, planned: number): void => {
      if (planned <= 0) return;
      totals.set(category, (totals.get(category) ?? 0) + planned);
    };

    if (this.source) {
      const sourceTables = new Set(this.source.tableNames());
      for (const group of DB_CATEGORY_TABLES) {
        for (const table of group.tables) {
          if (sourceTables.has(table)) add(group.category, this.source.readAll(table).length);
        }
      }
    }

    const sourceConfig = this.readSourceConfig();
    if (sourceConfig) {
      for (const group of CONFIG_CATEGORY_KEYS) {
        for (const key of group.keys) {
          if (key in sourceConfig) add(group.category, 1);
        }
      }
    }

    for (const entry of COPY_DIRECTORIES) {
      const sourceDirectory = this.resolveSourceDirectory(entry.directory);
      if (sourceDirectory) add(entry.category, this.countFiles(sourceDirectory));
    }

    const sourceChat = this.readSourceChat();
    if (sourceChat) add('conversations', Object.keys(sourceChat).length);

    return {
      databasePath: this.databasePath ?? '',
      configDirectory: this.sourceConfigDirectory,
      categories: [...totals.entries()]
        .map(([category, planned]) => ({ category, planned }))
        .sort((left, right) => left.category.localeCompare(right.category)),
    };
  }

  execute(): SearchtImportReport {
    const id = this.randomUUID();
    const startedAt = this.now();
    const journal: RollbackJournal = {
      insertedRows: {},
      originalConfig: null,
      addedConfigKeys: [],
      mergedChatKeys: [],
      originalChatFile: null,
      copiedFiles: [],
      removedFlagKeys: [],
      createdConfigFile: false,
      createdChatFile: false,
    };
    const categories: SearchtImportReportCategory[] = [];
    let failure: string | null = null;

    const emit = (category: SearchtImportCategory): SearchtImportReportCategory => {
      let existing = categories.find((entry) => entry.category === category);
      if (!existing) {
        existing = { category, planned: 0, imported: 0, skipped: 0, failed: 0, errors: [] };
        categories.push(existing);
      }
      return existing;
    };

    try {
      journal.originalConfig = this.readRawOrNull(this.targetConfigPath());
      journal.originalChatFile = this.readRawOrNull(this.targetChatPath());

      if (this.source && this.target) {
        const source = this.source;
        const target = this.target;
        target.transaction(() => {
          const sourceTables = new Set(source.tableNames());
          const targetTables = new Set(target.tableNames());
          for (const group of DB_CATEGORY_TABLES) {
            for (const table of group.tables) {
              if (!sourceTables.has(table)) continue;
              const entry = emit(group.category);
              if (!targetTables.has(table)) {
                entry.errors.push(`target table missing: ${table}`);
                continue;
              }
              const sourceColumns = source.columns(table);
              const targetColumnSet = new Set(target.columns(table));
              const columns = sourceColumns.filter((column) => targetColumnSet.has(column));
              const rows = source.readAll(table);
              entry.planned += rows.length;
              if (rows.length === 0) continue;
              const idIndex = columns.indexOf('id');
              const userIdIndex = columns.indexOf('user_id');
              const ids = rows.map((row) => String(row.id));
              const existingIds = target.existingIds(table, ids);
              const fresh: unknown[][] = [];
              const insertedIds: string[] = [];
              for (let index = 0; index < rows.length; index += 1) {
                const row = rows[index];
                const values = columns.map((column) => row[column] ?? null);
                if (userIdIndex >= 0) values[userIdIndex] = TARGET_SYSTEM_USER_ID;
                if (idIndex >= 0 && existingIds.has(ids[index])) {
                  entry.skipped += 1;
                  continue;
                }
                fresh.push(values);
                insertedIds.push(ids[index]);
              }
              const inserted = target.insertIgnore(table, columns, fresh);
              entry.imported += inserted;
              entry.skipped += fresh.length - inserted;
              journal.insertedRows[table] = [...(journal.insertedRows[table] ?? []), ...insertedIds];
            }
          }
        });
      }

      this.mergeConfig(emit, journal);
      this.mergeChatList(emit, journal);
      for (const entry of COPY_DIRECTORIES) {
        const sourceDirectory = this.resolveSourceDirectory(entry.directory);
        if (!sourceDirectory) continue;
        this.copyTree(
          sourceDirectory,
          path.join(this.targetConfigDirectory, entry.directory),
          emit(entry.category),
          journal
        );
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      for (const entry of categories) {
        entry.failed = Math.max(0, entry.planned - entry.imported - entry.skipped);
      }
    }

    const report: SearchtImportReport = {
      id,
      startedAt,
      finishedAt: this.now(),
      status: failure ? 'failed' : 'succeeded',
      categories: categories.sort((left, right) => left.category.localeCompare(right.category)),
      rollbackAvailable:
        Object.keys(journal.insertedRows).length > 0 ||
        journal.addedConfigKeys.length > 0 ||
        journal.mergedChatKeys.length > 0 ||
        journal.copiedFiles.length > 0 ||
        journal.removedFlagKeys.length > 0,
    };
    this.reportStore.save(report, journal);
    if (failure) throw new Error(`SEARCHT_IMPORT_FAILED: ${failure}`);
    return report;
  }

  rollback(reportId: string): SearchtImportReport {
    const record = this.reportStore.load(reportId);
    if (!record) throw new Error('SEARCHT_IMPORT_NOT_FOUND');
    if (record.report.status === 'rolled-back') throw new Error('SEARCHT_IMPORT_ALREADY_ROLLED_BACK');
    const journal = record.journal;

    if (this.target) {
      this.target.transaction(() => {
        for (const [table, ids] of Object.entries(journal.insertedRows)) {
          if (ids.length > 0) this.target!.deleteRows(table, ids);
        }
      });
    }

    if (journal.originalConfig !== null) {
      this.files.ensureDirectory(this.targetConfigDirectory);
      this.files.writeFile(this.targetConfigPath(), journal.originalConfig);
    } else if (journal.createdConfigFile && this.files.exists(this.targetConfigPath())) {
      this.files.removeFile(this.targetConfigPath());
    }
    if (journal.originalChatFile !== null) {
      this.files.ensureDirectory(this.targetConfigDirectory);
      this.files.writeFile(this.targetChatPath(), journal.originalChatFile);
    } else if (journal.createdChatFile && this.files.exists(this.targetChatPath())) {
      this.files.removeFile(this.targetChatPath());
    }
    for (const file of [...journal.copiedFiles].reverse()) {
      if (this.files.exists(file)) this.files.removeFile(file);
    }

    const report: SearchtImportReport = { ...record.report, status: 'rolled-back', rollbackAvailable: false };
    this.reportStore.markRolledBack(reportId, report);
    return report;
  }

  private mergeConfig(
    emit: (category: SearchtImportCategory) => SearchtImportReportCategory,
    journal: RollbackJournal
  ): void {
    const sourceConfig = this.readSourceConfig();
    if (sourceConfig === null) return;
    const targetRaw = this.readRawOrNull(this.targetConfigPath());
    const targetConfig = targetRaw !== null ? decodeConfigFile(targetRaw) : {};

    for (const group of CONFIG_CATEGORY_KEYS) {
      const entry = emit(group.category);
      for (const key of group.keys) {
        if (!(key in sourceConfig)) continue;
        entry.planned += 1;
        if (key in targetConfig) {
          entry.skipped += 1;
          continue;
        }
        if (key === 'model.config' && targetConfig['migration.providersMigrated_v1'] === true) {
          entry.skipped += 1;
          entry.errors.push('target already migrated its own model providers');
          continue;
        }
        targetConfig[key] = sourceConfig[key];
        journal.addedConfigKeys.push(key);
        entry.imported += 1;
      }
    }

    if (journal.addedConfigKeys.length === 0 && journal.removedFlagKeys.length === 0) return;
    if (journal.addedConfigKeys.includes('model.config') && targetConfig['migration.providersMigrated_v1'] === true) {
      delete targetConfig['migration.providersMigrated_v1'];
      journal.removedFlagKeys.push('migration.providersMigrated_v1');
    }
    this.files.ensureDirectory(this.targetConfigDirectory);
    if (journal.originalConfig === null) journal.createdConfigFile = true;
    this.files.writeFile(this.targetConfigPath(), encodeConfigFile(targetConfig));
  }

  private mergeChatList(
    emit: (category: SearchtImportCategory) => SearchtImportReportCategory,
    journal: RollbackJournal
  ): void {
    const sourceChat = this.readSourceChat();
    if (sourceChat === null) return;
    const entry = emit('conversations');
    const targetRaw = this.readRawOrNull(this.targetChatPath());
    const targetChat = targetRaw !== null && targetRaw.trim() ? decodeConfigFile(targetRaw) : {};
    const merged: Record<string, unknown> = { ...targetChat };
    let changed = false;
    for (const [conversationId, conversation] of Object.entries(sourceChat)) {
      entry.planned += 1;
      if (conversationId in targetChat) {
        entry.skipped += 1;
        continue;
      }
      merged[conversationId] = conversation;
      journal.mergedChatKeys.push(conversationId);
      entry.imported += 1;
      changed = true;
    }
    if (!changed) return;
    this.files.ensureDirectory(this.targetConfigDirectory);
    if (journal.originalChatFile === null) journal.createdChatFile = true;
    this.files.writeFile(this.targetChatPath(), encodeConfigFile(merged));
  }

  private copyTree(
    sourceDirectory: string,
    targetDirectory: string,
    entry: SearchtImportReportCategory,
    journal: RollbackJournal
  ): void {
    this.files.ensureDirectory(targetDirectory);
    const targetRoot = path.resolve(targetDirectory);
    for (const name of this.files.listFiles(sourceDirectory)) {
      const sourcePath = safeJoin(sourceDirectory, name);
      const targetPath = safeJoin(targetDirectory, name);
      if (!sourcePath || !targetPath) continue;
      if (!isWithinRoot(targetRoot, targetPath)) continue;
      if (this.files.isDirectory(sourcePath)) {
        this.copyTree(sourcePath, targetPath, entry, journal);
        continue;
      }
      entry.planned += 1;
      if (this.files.exists(targetPath)) {
        entry.skipped += 1;
        continue;
      }
      this.files.copyFile(sourcePath, targetPath);
      journal.copiedFiles.push(targetPath);
      entry.imported += 1;
    }
  }

  private countFiles(directory: string): number {
    let count = 0;
    for (const name of this.files.listFiles(directory)) {
      const child = safeJoin(directory, name);
      if (!child) continue;
      if (this.files.isDirectory(child)) count += this.countFiles(child);
      else count += 1;
    }
    return count;
  }

  private resolveSourceDirectory(directory: string): string | null {
    if (!this.sourceConfigDirectory) return null;
    const resolved = path.join(this.sourceConfigDirectory, directory);
    return this.files.exists(resolved) ? resolved : null;
  }

  private targetConfigPath(): string {
    return path.join(this.targetConfigDirectory, CONFIG_FILE_NAME);
  }

  private targetChatPath(): string {
    return path.join(this.targetConfigDirectory, CHAT_LIST_FILE_NAME);
  }

  private readSourceConfig(): Record<string, unknown> | null {
    if (!this.sourceConfigDirectory) return null;
    const sourcePath = path.join(this.sourceConfigDirectory, CONFIG_FILE_NAME);
    if (!this.files.exists(sourcePath)) return null;
    return decodeConfigFile(this.files.readFile(sourcePath));
  }

  private readSourceChat(): Record<string, unknown> | null {
    if (!this.sourceConfigDirectory) return null;
    const chatPath = path.join(this.sourceConfigDirectory, CHAT_LIST_FILE_NAME);
    if (!this.files.exists(chatPath)) return null;
    return decodeConfigFile(this.files.readFile(chatPath));
  }

  private readRawOrNull(target: string): string | null {
    if (!this.files.exists(target)) return null;
    return this.files.readFile(target);
  }
}

/**
 * Join a directory entry name into its parent. Entry names that contain path
 * separators or parent references are rejected so a hostile source listing
 * cannot escape the copy root.
 */
function safeJoin(directory: string, name: string): string | null {
  if (!name || name === '.' || name === '..') return null;
  if (name.includes('/') || name.includes('\\')) return null;
  return path.join(directory, name);
}

function isWithinRoot(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + path.sep);
}

export function decodeConfigFile(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const decoded = decodeURIComponent(atob(trimmed));
    const parsed: unknown = JSON.parse(decoded);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function encodeConfigFile(value: Record<string, unknown>): string {
  return btoa(encodeURIComponent(JSON.stringify(value)));
}

export class SqliteSourceCatalog implements SourceCatalog {
  constructor(private readonly driver: ISqliteDriver) {}

  tableNames(): string[] {
    const rows = this.driver
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }

  columns(table: string): string[] {
    const rows = this.driver.pragma(`table_info(${quoteIdentifier(table)})`) as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }

  readAll(table: string): Record<string, unknown>[] {
    return this.driver.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all() as Record<string, unknown>[];
  }
}

export class SqliteTargetCatalog implements TargetCatalog {
  constructor(private readonly driver: ISqliteDriver) {}

  tableNames(): string[] {
    const rows = this.driver
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }

  columns(table: string): string[] {
    const rows = this.driver.pragma(`table_info(${quoteIdentifier(table)})`) as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }

  transaction(body: () => void): void {
    this.driver.transaction(body)();
  }

  existingIds(table: string, ids: string[]): Set<string> {
    if (ids.length === 0) return new Set();
    const placeholders = ids.map(() => '?').join(', ');
    const rows = this.driver
      .prepare(`SELECT id FROM ${quoteIdentifier(table)} WHERE id IN (${placeholders})`)
      .all(...ids) as Array<{ id: string }>;
    return new Set(rows.map((row) => String(row.id)));
  }

  insertIgnore(table: string, columns: string[], rows: unknown[][]): number {
    if (rows.length === 0) return 0;
    const columnList = columns.map(quoteIdentifier).join(', ');
    const placeholders = columns.map(() => '?').join(', ');
    const statement = this.driver.prepare(
      `INSERT OR IGNORE INTO ${quoteIdentifier(table)} (${columnList}) VALUES (${placeholders})`
    );
    let inserted = 0;
    for (const row of rows) {
      const result = statement.run(...row);
      inserted += result.changes > 0 ? 1 : 0;
    }
    return inserted;
  }

  deleteRows(table: string, ids: string[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(', ');
    this.driver.prepare(`DELETE FROM ${quoteIdentifier(table)} WHERE id IN (${placeholders})`).run(...ids);
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}
