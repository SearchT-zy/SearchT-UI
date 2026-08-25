import { randomUUID } from 'node:crypto';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import type { CloudSyncMode, CloudSyncStoredConnection } from '@/common/types/searcht/cloudSync';

/** Tables included in the encrypted sync snapshot. */
export const SYNCED_TABLES = ['tasks', 'calendar_events', 'notes'] as const;

export type SyncRecord = {
  table: string;
  id: string;
  row: Record<string, unknown>;
  updatedAt: number;
  deletedAt: number | null;
};

export type SyncSnapshot = {
  deviceId: string;
  capturedAt: number;
  records: SyncRecord[];
};

export type SyncManifest = {
  formatVersion: 1;
  deviceId: string;
  updatedAt: number;
  bundleKey: string;
  recordCount: number;
};

export type StoredSyncState = {
  mode: CloudSyncMode;
  deviceId: string;
  connection: CloudSyncStoredConnection | null;
  masterSalt: string | null;
  verifier: string | null;
  remoteManifest: SyncManifest | null;
  lastSyncAt: number | null;
  lastSuccessAt: number | null;
  lastErrorCode: string | null;
};

export type MergeConflict = {
  table: string;
  recordId: string;
  localUpdatedAt: number;
  remoteUpdatedAt: number;
  remoteDeviceId: string;
};

export type MergeResult = {
  pulled: number;
  merged: number;
  conflicts: MergeConflict[];
};

type StateRow = {
  mode: CloudSyncMode;
  device_id: string;
  connection_json: string | null;
  remote_manifest_json: string | null;
  last_sync_at: number | null;
  last_success_at: number | null;
  last_error_code: string | null;
};

type OutboxRow = {
  id: string;
  operation: string;
  payload_json: string;
  attempts: number;
  next_attempt_at: number;
  last_error_code: string | null;
};

const SECRETS_ROW_ID = 'cloud-sync-secrets';

export class CloudSyncRepository {
  constructor(
    private readonly driver: ISqliteDriver,
    private readonly now: () => number = Date.now
  ) {}

  getState(): StoredSyncState {
    this.driver
      .prepare(`INSERT OR IGNORE INTO cloud_sync_state (id, mode, device_id, remote_manifest_json, updated_at)
        VALUES (1, 'disabled', ?, NULL, ?)`)
      .run(randomUUID(), this.now());
    const row = this.driver.prepare('SELECT * FROM cloud_sync_state WHERE id = 1').get() as StateRow;
    const secrets = this.readSecrets();
    let connection: CloudSyncStoredConnection | null = null;
    if (row.connection_json) {
      try {
        connection = JSON.parse(row.connection_json) as CloudSyncStoredConnection;
      } catch {
        connection = null;
      }
    }
    return {
      mode: row.mode,
      deviceId: row.device_id,
      connection,
      masterSalt: secrets.masterSalt,
      verifier: secrets.verifier,
      remoteManifest: row.remote_manifest_json ? (JSON.parse(row.remote_manifest_json) as SyncManifest) : null,
      lastSyncAt: row.last_sync_at,
      lastSuccessAt: row.last_success_at,
      lastErrorCode: row.last_error_code,
    };
  }

  setMode(mode: CloudSyncMode, connection: CloudSyncStoredConnection | null = null, now = this.now()): void {
    this.driver
      .prepare('UPDATE cloud_sync_state SET mode = ?, connection_json = ?, updated_at = ? WHERE id = 1')
      .run(mode, connection ? JSON.stringify(connection) : null, now);
  }

  saveRemoteManifest(manifest: SyncManifest | null, now = this.now()): void {
    this.driver
      .prepare('UPDATE cloud_sync_state SET remote_manifest_json = ?, updated_at = ? WHERE id = 1')
      .run(manifest ? JSON.stringify(manifest) : null, now);
  }

  recordSuccess(now = this.now()): void {
    this.driver
      .prepare(`UPDATE cloud_sync_state SET last_sync_at = ?, last_success_at = ?, last_error_code = NULL, updated_at = ?
        WHERE id = 1`)
      .run(now, now, now);
  }

  recordSyncAttempt(errorCode: string | null, now = this.now()): void {
    this.driver
      .prepare('UPDATE cloud_sync_state SET last_sync_at = ?, last_error_code = ?, updated_at = ? WHERE id = 1')
      .run(now, errorCode, now);
  }

  storeSecrets(masterSalt: string, verifier: string): void {
    this.driver
      .prepare(`INSERT INTO cloud_sync_outbox (id, operation, payload_json, attempts, next_attempt_at, created_at, updated_at)
        VALUES (?, 'key-rotation', ?, 0, 0, ?, ?)
        ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`)
      .run(SECRETS_ROW_ID, JSON.stringify({ masterSalt, verifier }), this.now(), this.now());
  }

  readSecrets(): { masterSalt: string | null; verifier: string | null } {
    const row = this.driver.prepare('SELECT payload_json FROM cloud_sync_outbox WHERE id = ?').get(SECRETS_ROW_ID) as
      | { payload_json: string }
      | undefined;
    if (!row) return { masterSalt: null, verifier: null };
    try {
      const parsed = JSON.parse(row.payload_json) as { masterSalt?: string; verifier?: string };
      return { masterSalt: parsed.masterSalt ?? null, verifier: parsed.verifier ?? null };
    } catch {
      return { masterSalt: null, verifier: null };
    }
  }

  enqueueSnapshot(snapshot: SyncSnapshot, now = this.now()): void {
    this.driver
      .prepare(`INSERT INTO cloud_sync_outbox (id, operation, payload_json, attempts, next_attempt_at, created_at, updated_at)
        VALUES (?, 'push-snapshot', ?, 0, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, attempts = 0,
          next_attempt_at = excluded.next_attempt_at, updated_at = excluded.updated_at`)
      .run(`push-${snapshot.deviceId}`, JSON.stringify(snapshot), now, now, now);
  }

  dueSnapshot(now = this.now()): { id: string; snapshot: SyncSnapshot } | null {
    const rows = this.driver
      .prepare("SELECT * FROM cloud_sync_outbox WHERE operation = 'push-snapshot' AND next_attempt_at <= ? LIMIT 1")
      .all(now) as OutboxRow[];
    const row = rows[0];
    if (!row) return null;
    return { id: row.id, snapshot: JSON.parse(row.payload_json) as SyncSnapshot };
  }

  markOutboxAttempt(id: string, errorCode: string | null, now = this.now()): void {
    if (errorCode === null) {
      this.driver.prepare('DELETE FROM cloud_sync_outbox WHERE id = ?').run(id);
      return;
    }
    const row = this.driver.prepare('SELECT attempts FROM cloud_sync_outbox WHERE id = ?').get(id) as
      | { attempts: number }
      | undefined;
    const attempts = (row?.attempts ?? 0) + 1;
    const backoffMs = Math.min(3_600_000, 30_000 * 2 ** Math.min(attempts, 7));
    this.driver
      .prepare(`UPDATE cloud_sync_outbox SET attempts = ?, next_attempt_at = ?, last_error_code = ?, updated_at = ?
        WHERE id = ?`)
      .run(attempts, now + backoffMs, errorCode, now, id);
  }

  pendingOutbox(): number {
    const row = this.driver
      .prepare("SELECT COUNT(*) AS count FROM cloud_sync_outbox WHERE operation = 'push-snapshot'")
      .get() as { count: number };
    return row.count;
  }

  captureSnapshot(deviceId: string, now = this.now()): SyncSnapshot {
    const records: SyncRecord[] = [];
    for (const table of SYNCED_TABLES) {
      const rows = this.driver.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
      for (const row of rows) {
        records.push({
          table,
          id: String(row.id),
          row,
          updatedAt: Number(row.updated_at ?? 0),
          deletedAt: row.deleted_at === null || row.deleted_at === undefined ? null : Number(row.deleted_at),
        });
      }
    }
    return { deviceId, capturedAt: now, records };
  }

  /**
   * Three-way merge per record against the last agreed base version:
   * - only one side changed → that side wins (tombstones suppress resurrection);
   * - both sides changed identically → counts as merged;
   * - both sides changed differently → conflict: local wins, the remote record
   *   is preserved as an explicit `<id>.conflict-<deviceId>` copy for notes.
   */
  applySnapshot(incoming: SyncSnapshot): MergeResult {
    const transaction = this.driver.transaction(() => this.mergeRecords(incoming));
    return transaction();
  }

  private mergeRecords(incoming: SyncSnapshot): MergeResult {
    let pulled = 0;
    let merged = 0;
    const conflicts: MergeConflict[] = [];

    for (const record of incoming.records) {
      if (!SYNCED_TABLES.includes(record.table as (typeof SYNCED_TABLES)[number])) continue;
      const local = this.findRecord(record.table, record.id);
      if (!local) {
        if (record.deletedAt === null) {
          this.upsertRecord(record.table, record.row);
          this.setBase(record.table, record.id, record.updatedAt);
          pulled += 1;
        }
        continue;
      }
      const base = this.getBase(record.table, record.id) ?? 0;
      const localChanged = local.updatedAt !== base;
      const remoteChanged = record.updatedAt !== base;
      if (remoteChanged && !localChanged) {
        this.updateFromRemote(record.table, record.row);
        this.setBase(record.table, record.id, record.updatedAt);
        pulled += 1;
        continue;
      }
      if (!remoteChanged && localChanged) {
        merged += 1;
        continue;
      }
      if (local.updatedAt === record.updatedAt) {
        this.setBase(record.table, record.id, record.updatedAt);
        merged += 1;
        continue;
      }
      conflicts.push({
        table: record.table,
        recordId: record.id,
        localUpdatedAt: local.updatedAt,
        remoteUpdatedAt: record.updatedAt,
        remoteDeviceId: incoming.deviceId,
      });
      if (record.table === 'notes' && record.deletedAt === null) {
        this.upsertRecord(record.table, { ...record.row, id: `${record.id}.conflict-${incoming.deviceId}` });
      }
      merged += 1;
    }
    return { pulled, merged, conflicts };
  }

  /** After a successful push the pushed versions become the new base. */
  markPushedBase(snapshot: SyncSnapshot): void {
    const transaction = this.driver.transaction(() => {
      for (const record of snapshot.records) this.setBase(record.table, record.id, record.updatedAt);
    });
    transaction();
  }

  private getBase(table: string, id: string): number | null {
    const row = this.driver
      .prepare('SELECT base_updated_at FROM cloud_sync_base WHERE record_key = ?')
      .get(`${table}:${id}`) as { base_updated_at: number } | undefined;
    return row ? row.base_updated_at : null;
  }

  private setBase(table: string, id: string, updatedAt: number): void {
    this.driver
      .prepare(`INSERT INTO cloud_sync_base (record_key, base_updated_at) VALUES (?, ?)
        ON CONFLICT(record_key) DO UPDATE SET base_updated_at = excluded.base_updated_at`)
      .run(`${table}:${id}`, updatedAt);
  }

  private findRecord(table: string, id: string): SyncRecord | null {
    const row = this.driver.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return {
      table,
      id: String(row.id),
      row,
      updatedAt: Number(row.updated_at ?? 0),
      deletedAt: row.deleted_at === null || row.deleted_at === undefined ? null : Number(row.deleted_at),
    };
  }

  private upsertRecord(table: string, row: Record<string, unknown>): void {
    const columns = Object.keys(row);
    const placeholders = columns.map(() => '?').join(', ');
    this.driver
      .prepare(`INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`)
      .run(...columns.map((column) => serializeValue(row[column])));
  }

  private updateFromRemote(table: string, remote: Record<string, unknown>): void {
    const remoteColumns = Object.keys(remote);
    const localRow = this.driver.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(String(remote.id)) as Record<
      string,
      unknown
    > | null;
    if (!localRow) {
      this.upsertRecord(table, remote);
      return;
    }
    const localKeys = new Set(Object.keys(localRow));
    const columns = remoteColumns.filter((column) => localKeys.has(column));
    const assignments = columns.map((column) => `${column} = ?`).join(', ');
    this.driver
      .prepare(`UPDATE ${table} SET ${assignments} WHERE id = ?`)
      .run(...columns.map((column) => serializeValue(remote[column])), String(remote.id));
  }
}

function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}
