import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';

export type EmailIngestRecord = {
  connectorId: string;
  externalId: string;
  state: 'importing' | 'complete';
  inboxItemIds: string[];
  contentHash: string;
  importedAt: number;
  updatedAt: number;
};

type EmailIngestRow = {
  connector_id: string;
  external_id: string;
  state: EmailIngestRecord['state'];
  inbox_item_ids_json: string;
  content_hash: string;
  imported_at: number;
  updated_at: number;
};

export class EmailIngestRepository {
  constructor(private readonly driver: ISqliteDriver) {}

  find(connectorId: string, externalId: string): EmailIngestRecord | null {
    const row = this.driver
      .prepare('SELECT * FROM connector_ingest_records WHERE connector_id = ? AND external_id = ?')
      .get(connectorId, externalId) as EmailIngestRow | undefined;
    return row ? mapRecord(row) : null;
  }

  begin(connectorId: string, externalId: string, contentHash: string, now: number): EmailIngestRecord {
    this.driver
      .prepare(`INSERT OR IGNORE INTO connector_ingest_records (
        connector_id, external_id, state, inbox_item_ids_json, content_hash, imported_at, updated_at
      ) VALUES (?, ?, 'importing', '[]', ?, ?, ?)`)
      .run(connectorId, externalId, contentHash, now, now);
    const record = this.find(connectorId, externalId)!;
    if (record.contentHash !== contentHash) throw new Error('CONNECTOR_EMAIL_CONTENT_CHANGED');
    return record;
  }

  appendInboxItem(connectorId: string, externalId: string, inboxItemId: string, now: number): EmailIngestRecord {
    const current = this.find(connectorId, externalId);
    if (!current || current.state !== 'importing') throw new Error('CONNECTOR_EMAIL_INGEST_STATE_INVALID');
    if (current.inboxItemIds.includes(inboxItemId)) return current;
    const nextIds = [...current.inboxItemIds, inboxItemId];
    this.driver
      .prepare(`UPDATE connector_ingest_records SET inbox_item_ids_json = ?, updated_at = ?
        WHERE connector_id = ? AND external_id = ? AND state = 'importing'`)
      .run(JSON.stringify(nextIds), now, connectorId, externalId);
    return this.find(connectorId, externalId)!;
  }

  complete(connectorId: string, externalId: string, now: number): EmailIngestRecord {
    const result = this.driver
      .prepare(`UPDATE connector_ingest_records SET state = 'complete', updated_at = ?
        WHERE connector_id = ? AND external_id = ? AND state = 'importing'`)
      .run(now, connectorId, externalId);
    if (result.changes !== 1) throw new Error('CONNECTOR_EMAIL_INGEST_STATE_INVALID');
    return this.find(connectorId, externalId)!;
  }
}

function mapRecord(row: EmailIngestRow): EmailIngestRecord {
  const parsed = JSON.parse(row.inbox_item_ids_json) as unknown;
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string' || !value)) {
    throw new Error('CONNECTOR_EMAIL_INGEST_RECORD_INVALID');
  }
  return {
    connectorId: row.connector_id,
    externalId: row.external_id,
    state: row.state,
    inboxItemIds: parsed,
    contentHash: row.content_hash,
    importedAt: row.imported_at,
    updatedAt: row.updated_at,
  };
}
