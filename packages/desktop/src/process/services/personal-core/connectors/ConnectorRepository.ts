import type {
  CalendarIcsConnectorConfig,
  ConnectorAccount,
  ConnectorKind,
  ConnectorState,
  EmailConnectorConfig,
  LocalFolderConnectorConfig,
  S3ConnectorConfig,
  WebDavConnectorConfig,
} from '@/common/types/searcht/connectors';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';

export type ConnectorCursorEntry = {
  sizeBytes: number;
  modifiedAt: number;
};

export type LocalFolderConnectorCursor = Record<string, ConnectorCursorEntry>;

export type EmailConnectorCursor = {
  uidValidity: string | null;
  lastUid: number | null;
};

export type WebDavConnectorCursorEntry = {
  etag: string | null;
  modifiedAt: number | null;
  sizeBytes: number;
};

export type WebDavConnectorCursor = Record<string, WebDavConnectorCursorEntry>;

export type S3ConnectorCursor = Record<string, WebDavConnectorCursorEntry>;

export type CalendarIcsConnectorCursor = {
  bodyFingerprint: string | null;
  eventIds: string[];
};

export type ConnectorCursor =
  | LocalFolderConnectorCursor
  | EmailConnectorCursor
  | WebDavConnectorCursor
  | S3ConnectorCursor
  | CalendarIcsConnectorCursor;

export type StoredConnectorAccount =
  | (Extract<ConnectorAccount, { kind: 'local-folder' }> & { cursor: LocalFolderConnectorCursor })
  | (Extract<ConnectorAccount, { kind: 'email-imap' }> & { cursor: EmailConnectorCursor })
  | (Extract<ConnectorAccount, { kind: 'webdav' }> & { cursor: WebDavConnectorCursor })
  | (Extract<ConnectorAccount, { kind: 's3' }> & { cursor: S3ConnectorCursor })
  | (Extract<ConnectorAccount, { kind: 'calendar-ics' }> & { cursor: CalendarIcsConnectorCursor });

type ConnectorRow = {
  id: string;
  kind: ConnectorKind;
  display_name: string;
  state: ConnectorState;
  config_json: string;
  cursor_json: string;
  last_sync_at: number | null;
  last_success_at: number | null;
  last_error_code: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

export class ConnectorRepository {
  constructor(private readonly driver: ISqliteDriver) {}

  insert(account: StoredConnectorAccount): StoredConnectorAccount {
    this.driver
      .prepare(`INSERT INTO connector_accounts (
        id, kind, display_name, state, config_json, cursor_json, last_sync_at,
        last_success_at, last_error_code, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
      .run(
        account.id,
        account.kind,
        account.displayName,
        account.state,
        JSON.stringify(account.config),
        JSON.stringify(account.cursor),
        account.lastSyncAt,
        account.lastSuccessAt,
        account.lastErrorCode,
        account.createdAt,
        account.updatedAt
      );
    return this.findById(account.id)!;
  }

  list(): StoredConnectorAccount[] {
    return (
      this.driver
        .prepare('SELECT * FROM connector_accounts WHERE deleted_at IS NULL ORDER BY created_at, id')
        .all() as ConnectorRow[]
    ).map(mapConnector);
  }

  findById(id: string): StoredConnectorAccount | null {
    const row = this.driver.prepare('SELECT * FROM connector_accounts WHERE id = ? AND deleted_at IS NULL').get(id) as
      | ConnectorRow
      | undefined;
    return row ? mapConnector(row) : null;
  }

  findLocalFolderByPath(folderPath: string): StoredConnectorAccount | null {
    return this.list().find((account) => account.kind === 'local-folder' && account.config.path === folderPath) ?? null;
  }

  findEmailByAddress(emailAddress: string): StoredConnectorAccount | null {
    const normalized = emailAddress.trim().toLowerCase();
    return (
      this.list().find(
        (account) => account.kind === 'email-imap' && account.config.emailAddress.toLowerCase() === normalized
      ) ?? null
    );
  }

  findWebDav(provider: WebDavConnectorConfig['provider'], rootPath: string): StoredConnectorAccount | null {
    return (
      this.list().find(
        (account) =>
          account.kind === 'webdav' && account.config.provider === provider && account.config.rootPath === rootPath
      ) ?? null
    );
  }

  findS3(provider: S3ConnectorConfig['provider'], bucket: string, prefix: string): StoredConnectorAccount | null {
    return (
      this.list().find(
        (account) =>
          account.kind === 's3' &&
          account.config.provider === provider &&
          account.config.bucket === bucket &&
          account.config.prefix === prefix
      ) ?? null
    );
  }

  findCalendarIcs(provider: CalendarIcsConnectorConfig['provider']): StoredConnectorAccount | null {
    return (
      this.list().find((account) => account.kind === 'calendar-ics' && account.config.provider === provider) ?? null
    );
  }

  setState(id: string, state: ConnectorState, lastErrorCode: string | null, now: number): StoredConnectorAccount {
    const result = this.driver
      .prepare(
        'UPDATE connector_accounts SET state = ?, last_error_code = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
      )
      .run(state, lastErrorCode, now, id);
    if (result.changes !== 1) throw new Error('CONNECTOR_NOT_FOUND');
    return this.findById(id)!;
  }

  recordSuccess(id: string, cursor: ConnectorCursor, now: number): StoredConnectorAccount {
    const result = this.driver
      .prepare(`UPDATE connector_accounts SET state = 'active', cursor_json = ?, last_sync_at = ?,
        last_success_at = ?, last_error_code = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NULL`)
      .run(JSON.stringify(cursor), now, now, now, id);
    if (result.changes !== 1) throw new Error('CONNECTOR_NOT_FOUND');
    return this.findById(id)!;
  }

  recordPartialFailure(id: string, cursor: ConnectorCursor, errorCode: string, now: number): StoredConnectorAccount {
    const result = this.driver
      .prepare(`UPDATE connector_accounts SET state = 'error', cursor_json = ?, last_sync_at = ?,
        last_error_code = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`)
      .run(JSON.stringify(cursor), now, errorCode, now, id);
    if (result.changes !== 1) throw new Error('CONNECTOR_NOT_FOUND');
    return this.findById(id)!;
  }

  recordFailure(id: string, errorCode: string, now: number): StoredConnectorAccount {
    const result = this.driver
      .prepare(`UPDATE connector_accounts SET state = 'error', last_sync_at = ?,
        last_error_code = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`)
      .run(now, errorCode, now, id);
    if (result.changes !== 1) throw new Error('CONNECTOR_NOT_FOUND');
    return this.findById(id)!;
  }

  disconnect(id: string, now: number): void {
    const result = this.driver
      .prepare('UPDATE connector_accounts SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
      .run(now, now, id);
    if (result.changes !== 1) throw new Error('CONNECTOR_NOT_FOUND');
  }

  deletePermanently(id: string): void {
    this.driver.prepare('DELETE FROM connector_accounts WHERE id = ?').run(id);
  }

  insertAudit(
    id: string,
    action: string,
    outcome: 'success' | 'failure',
    detail: Record<string, unknown>,
    now: number
  ): void {
    this.driver
      .prepare('INSERT INTO personal_audit_log (id, action, outcome, detail_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, action, outcome, JSON.stringify(detail), now);
  }
}

function mapConnector(row: ConnectorRow): StoredConnectorAccount {
  const base = {
    id: row.id,
    displayName: row.display_name,
    state: row.state,
    lastSyncAt: row.last_sync_at,
    lastSuccessAt: row.last_success_at,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.kind === 'local-folder') {
    return {
      ...base,
      kind: row.kind,
      config: parseLocalFolderConfig(row.config_json),
      cursor: parseLocalFolderCursor(row.cursor_json),
    };
  }
  if (row.kind === 'email-imap') {
    return {
      ...base,
      kind: row.kind,
      config: parseEmailConfig(row.config_json),
      cursor: parseEmailCursor(row.cursor_json),
    };
  }
  if (row.kind === 'webdav') {
    return {
      ...base,
      kind: row.kind,
      config: parseWebDavConfig(row.config_json),
      cursor: parseWebDavCursor(row.cursor_json),
    };
  }
  if (row.kind === 's3') {
    return {
      ...base,
      kind: row.kind,
      config: parseS3Config(row.config_json),
      cursor: parseS3Cursor(row.cursor_json),
    };
  }
  if (row.kind === 'calendar-ics') {
    return {
      ...base,
      kind: row.kind,
      config: parseCalendarIcsConfig(row.config_json),
      cursor: parseCalendarIcsCursor(row.cursor_json),
    };
  }
  throw new Error('CONNECTOR_KIND_INVALID');
}

function parseLocalFolderConfig(value: string): LocalFolderConnectorConfig {
  const parsed = JSON.parse(value) as Partial<LocalFolderConnectorConfig>;
  if (typeof parsed.path !== 'string' || typeof parsed.includeSubfolders !== 'boolean') {
    throw new Error('CONNECTOR_CONFIG_INVALID');
  }
  return { path: parsed.path, includeSubfolders: parsed.includeSubfolders };
}

function parseEmailConfig(value: string): EmailConnectorConfig {
  const parsed = JSON.parse(value) as Partial<EmailConnectorConfig>;
  if (
    (parsed.provider !== 'qq-mail' && parsed.provider !== 'netease-163') ||
    typeof parsed.emailAddress !== 'string' ||
    parsed.mailbox !== 'INBOX' ||
    (parsed.initialSync !== 'from-now' && parsed.initialSync !== 'last-7-days')
  ) {
    throw new Error('CONNECTOR_CONFIG_INVALID');
  }
  return {
    provider: parsed.provider,
    emailAddress: parsed.emailAddress,
    mailbox: parsed.mailbox,
    initialSync: parsed.initialSync,
  };
}

function parseWebDavConfig(value: string): WebDavConnectorConfig {
  const parsed = JSON.parse(value) as Partial<WebDavConnectorConfig>;
  if (
    (parsed.provider !== 'jianguoyun' && parsed.provider !== 'custom-webdav') ||
    typeof parsed.rootPath !== 'string' ||
    (parsed.initialSync !== 'from-now' && parsed.initialSync !== 'import-existing')
  ) {
    throw new Error('CONNECTOR_CONFIG_INVALID');
  }
  return { provider: parsed.provider, rootPath: parsed.rootPath, initialSync: parsed.initialSync };
}

function parseS3Config(value: string): S3ConnectorConfig {
  const parsed = JSON.parse(value) as Partial<S3ConnectorConfig>;
  if (
    (parsed.provider !== 'aws-s3' && parsed.provider !== 'cloudflare-r2' && parsed.provider !== 'custom-s3') ||
    typeof parsed.bucket !== 'string' ||
    typeof parsed.prefix !== 'string' ||
    typeof parsed.pathStyle !== 'boolean' ||
    (parsed.initialSync !== 'from-now' && parsed.initialSync !== 'import-existing')
  ) {
    throw new Error('CONNECTOR_CONFIG_INVALID');
  }
  return {
    provider: parsed.provider,
    bucket: parsed.bucket,
    prefix: parsed.prefix,
    pathStyle: parsed.pathStyle,
    initialSync: parsed.initialSync,
  };
}

function parseCalendarIcsConfig(value: string): CalendarIcsConnectorConfig {
  const parsed = JSON.parse(value) as Partial<CalendarIcsConnectorConfig>;
  if (
    !['feishu', 'outlook', 'dingtalk', 'wecom', 'custom-ics'].includes(parsed.provider as string) ||
    parsed.initialSync !== 'import-existing'
  ) {
    throw new Error('CONNECTOR_CONFIG_INVALID');
  }
  return { provider: parsed.provider, initialSync: 'import-existing' };
}

function parseS3Cursor(value: string): S3ConnectorCursor {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('CONNECTOR_CURSOR_INVALID');
  const cursor: S3ConnectorCursor = {};
  for (const [remotePath, entry] of Object.entries(parsed)) {
    const item = entry as Partial<WebDavConnectorCursorEntry>;
    if (
      !entry ||
      typeof entry !== 'object' ||
      (item.etag !== null && typeof item.etag !== 'string') ||
      (item.modifiedAt !== null && !Number.isFinite(item.modifiedAt)) ||
      !Number.isFinite(item.sizeBytes) ||
      (item.sizeBytes ?? -1) < 0
    ) {
      throw new Error('CONNECTOR_CURSOR_INVALID');
    }
    cursor[remotePath] = {
      etag: item.etag ?? null,
      modifiedAt: item.modifiedAt ?? null,
      sizeBytes: item.sizeBytes!,
    };
  }
  return cursor;
}

function parseCalendarIcsCursor(value: string): CalendarIcsConnectorCursor {
  const parsed = JSON.parse(value) as Partial<CalendarIcsConnectorCursor>;
  if (
    (parsed.bodyFingerprint !== null && typeof parsed.bodyFingerprint !== 'string') ||
    !Array.isArray(parsed.eventIds) ||
    !parsed.eventIds.every((entry) => typeof entry === 'string')
  ) {
    throw new Error('CONNECTOR_CURSOR_INVALID');
  }
  return { bodyFingerprint: parsed.bodyFingerprint ?? null, eventIds: parsed.eventIds ?? [] };
}

function parseLocalFolderCursor(value: string): LocalFolderConnectorCursor {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('CONNECTOR_CURSOR_INVALID');
  const cursor: LocalFolderConnectorCursor = {};
  for (const [relativePath, entry] of Object.entries(parsed)) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !Number.isFinite((entry as Partial<ConnectorCursorEntry>).sizeBytes) ||
      !Number.isFinite((entry as Partial<ConnectorCursorEntry>).modifiedAt)
    ) {
      throw new Error('CONNECTOR_CURSOR_INVALID');
    }
    cursor[relativePath] = {
      sizeBytes: (entry as ConnectorCursorEntry).sizeBytes,
      modifiedAt: (entry as ConnectorCursorEntry).modifiedAt,
    };
  }
  return cursor;
}

function parseEmailCursor(value: string): EmailConnectorCursor {
  const parsed = JSON.parse(value) as Partial<EmailConnectorCursor>;
  if (
    (parsed.uidValidity !== null && typeof parsed.uidValidity !== 'string') ||
    (parsed.lastUid !== null && (!Number.isInteger(parsed.lastUid) || (parsed.lastUid ?? -1) < 0))
  ) {
    throw new Error('CONNECTOR_CURSOR_INVALID');
  }
  return { uidValidity: parsed.uidValidity ?? null, lastUid: parsed.lastUid ?? null };
}

function parseWebDavCursor(value: string): WebDavConnectorCursor {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('CONNECTOR_CURSOR_INVALID');
  const cursor: WebDavConnectorCursor = {};
  for (const [remotePath, entry] of Object.entries(parsed)) {
    const item = entry as Partial<WebDavConnectorCursorEntry>;
    if (
      !entry ||
      typeof entry !== 'object' ||
      (item.etag !== null && typeof item.etag !== 'string') ||
      (item.modifiedAt !== null && !Number.isFinite(item.modifiedAt)) ||
      !Number.isFinite(item.sizeBytes) ||
      (item.sizeBytes ?? -1) < 0
    ) {
      throw new Error('CONNECTOR_CURSOR_INVALID');
    }
    cursor[remotePath] = {
      etag: item.etag ?? null,
      modifiedAt: item.modifiedAt ?? null,
      sizeBytes: item.sizeBytes!,
    };
  }
  return cursor;
}
