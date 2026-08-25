import type {
  InboxAsset,
  InboxAssetOrigin,
  InboxItem,
  InboxItemDetail,
  InboxListQuery,
  InboxListResult,
  InboxMutationResult,
  InboxPendingSummary,
  SourceLink,
} from '@/common/types/searcht/inbox';
import { normalizeInboxBatchIds, normalizeInboxSearch } from '@/common/searcht/inboxValidation';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';

type ItemRow = {
  id: string;
  kind: InboxItem['kind'];
  state: InboxItem['state'];
  title: string;
  text_content: string | null;
  url: string | null;
  origin_id: string | null;
  captured_at: number;
  organized_at: number | null;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

type AssetRow = {
  id: string;
  sha256: string;
  managed_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: number;
};

type OriginRow = {
  id: string;
  asset_id: string;
  original_name: string;
  original_path: string | null;
  imported_at: number;
};

type LinkRow = {
  id: string;
  source_type: SourceLink['sourceType'];
  source_id: string;
  target_type: SourceLink['targetType'];
  target_id: string;
  created_at: number;
};

export class InboxRepository {
  constructor(private readonly driver: ISqliteDriver) {}

  transaction<T>(operation: () => T): T {
    return this.driver.transaction(operation)();
  }

  insertAsset(asset: InboxAsset): InboxAsset {
    this.driver
      .prepare(
        'INSERT INTO inbox_assets (id, sha256, managed_name, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(asset.id, asset.sha256, asset.managedName, asset.mimeType, asset.sizeBytes, asset.createdAt);
    return this.findAssetById(asset.id)!;
  }

  findAssetById(id: string): InboxAsset | null {
    const row = this.driver.prepare('SELECT * FROM inbox_assets WHERE id = ?').get(id) as AssetRow | undefined;
    return row ? mapAsset(row) : null;
  }

  findAssetBySha256(sha256: string): InboxAsset | null {
    const row = this.driver.prepare('SELECT * FROM inbox_assets WHERE sha256 = ?').get(sha256) as AssetRow | undefined;
    return row ? mapAsset(row) : null;
  }

  insertOrigin(origin: InboxAssetOrigin): InboxAssetOrigin {
    this.driver
      .prepare(
        'INSERT INTO inbox_asset_origins (id, asset_id, original_name, original_path, imported_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(origin.id, origin.assetId, origin.originalName, origin.originalPath, origin.importedAt);
    return this.findOriginById(origin.id)!;
  }

  findOriginById(id: string): InboxAssetOrigin | null {
    const row = this.driver.prepare('SELECT * FROM inbox_asset_origins WHERE id = ?').get(id) as OriginRow | undefined;
    return row ? mapOrigin(row) : null;
  }

  insertItem(item: InboxItem): InboxItem {
    this.driver
      .prepare(`INSERT INTO inbox_items (
        id, kind, state, title, text_content, url, origin_id, captured_at,
        organized_at, archived_at, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        item.id,
        item.kind,
        item.state,
        item.title,
        item.textContent,
        item.url,
        item.originId,
        item.capturedAt,
        item.organizedAt,
        item.archivedAt,
        item.createdAt,
        item.updatedAt,
        item.deletedAt
      );
    return this.findItemById(item.id)!;
  }

  updateItem(item: InboxItem): InboxItem {
    const result = this.driver
      .prepare(`UPDATE inbox_items SET state = ?, title = ?, text_content = ?, url = ?, origin_id = ?,
        organized_at = ?, archived_at = ?, updated_at = ?, deleted_at = ? WHERE id = ?`)
      .run(
        item.state,
        item.title,
        item.textContent,
        item.url,
        item.originId,
        item.organizedAt,
        item.archivedAt,
        item.updatedAt,
        item.deletedAt,
        item.id
      );
    if (result.changes !== 1) throw new Error('INBOX_ITEM_NOT_FOUND');
    return this.findItemById(item.id)!;
  }

  findItemById(id: string): InboxItem | null {
    const row = this.driver.prepare('SELECT * FROM inbox_items WHERE id = ?').get(id) as ItemRow | undefined;
    return row ? mapItem(row) : null;
  }

  getDetail(id: string): InboxItemDetail | null {
    const inboxItem = this.findItemById(id);
    if (!inboxItem) return null;
    const origin = inboxItem.originId ? this.findOriginById(inboxItem.originId) : null;
    const asset = origin ? this.findAssetById(origin.assetId) : null;
    return { item: inboxItem, asset, origin, sourceLinks: this.listSourceLinks(id) };
  }

  list(query: InboxListQuery): InboxListResult {
    const { where, params } = buildListFilter(query);
    const limit = Math.max(1, Math.min(query.limit ?? 50, 100));
    const cursor = decodeCursor(query.cursor);
    const pageWhere = cursor ? `${where} AND (i.captured_at < ? OR (i.captured_at = ? AND i.id < ?))` : where;
    const pageParams = cursor ? [...params, cursor.capturedAt, cursor.capturedAt, cursor.id] : params;
    const rows = this.driver
      .prepare(
        `SELECT DISTINCT i.* FROM inbox_items i LEFT JOIN inbox_asset_origins o ON o.id = i.origin_id
         WHERE ${pageWhere} ORDER BY i.captured_at DESC, i.id DESC LIMIT ?`
      )
      .all(...pageParams, limit + 1) as ItemRow[];
    const total = (
      this.driver
        .prepare(
          `SELECT COUNT(DISTINCT i.id) AS count FROM inbox_items i LEFT JOIN inbox_asset_origins o ON o.id = i.origin_id WHERE ${where}`
        )
        .get(...params) as { count: number }
    ).count;
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(mapItem);
    const last = hasMore ? items.at(-1) : undefined;
    return { items, total, nextCursor: last ? encodeCursor(last) : null };
  }

  archive(ids: readonly string[], now: number): InboxMutationResult {
    return this.batchUpdate(ids, (placeholders, values) =>
      this.driver
        .prepare(
          `UPDATE inbox_items SET state = 'archived', archived_at = ?, updated_at = ? WHERE id IN (${placeholders})`
        )
        .run(now, now, ...values)
    );
  }

  remove(ids: readonly string[], now: number): InboxMutationResult {
    return this.batchUpdate(ids, (placeholders, values) =>
      this.driver
        .prepare(`UPDATE inbox_items SET deleted_at = ?, updated_at = ? WHERE id IN (${placeholders})`)
        .run(now, now, ...values)
    );
  }

  restore(ids: readonly string[], now: number): InboxMutationResult {
    return this.batchUpdate(ids, (placeholders, values) =>
      this.driver
        .prepare(`UPDATE inbox_items SET deleted_at = NULL, updated_at = ? WHERE id IN (${placeholders})`)
        .run(now, ...values)
    );
  }

  markOrganized(id: string, now: number): InboxItem {
    const result = this.driver
      .prepare("UPDATE inbox_items SET state = 'organized', organized_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, id);
    if (result.changes !== 1) throw new Error('INBOX_ITEM_NOT_FOUND');
    return this.findItemById(id)!;
  }

  destroy(ids: readonly string[]): InboxMutationResult {
    const normalized = normalizeInboxBatchIds(ids);
    return this.transaction(() => {
      this.requireItems(normalized);
      const placeholders = sqlPlaceholders(normalized);
      const origins = this.driver
        .prepare(
          `SELECT DISTINCT origin_id AS id FROM inbox_items WHERE id IN (${placeholders}) AND origin_id IS NOT NULL`
        )
        .all(...normalized) as Array<{ id: string }>;
      const affectedCount = this.driver
        .prepare(`DELETE FROM inbox_items WHERE id IN (${placeholders})`)
        .run(...normalized).changes;
      for (const { id } of origins) {
        this.driver
          .prepare(
            'DELETE FROM inbox_asset_origins WHERE id = ? AND NOT EXISTS (SELECT 1 FROM inbox_items WHERE origin_id = ?)'
          )
          .run(id, id);
      }
      return { affectedIds: normalized, affectedCount };
    });
  }

  insertSourceLink(link: SourceLink): SourceLink {
    this.driver
      .prepare(
        'INSERT INTO source_links (id, source_type, source_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(link.id, link.sourceType, link.sourceId, link.targetType, link.targetId, link.createdAt);
    return link;
  }

  listSourceLinks(sourceId: string): SourceLink[] {
    return (
      this.driver
        .prepare('SELECT * FROM source_links WHERE source_id = ? ORDER BY created_at, id')
        .all(sourceId) as LinkRow[]
    ).map(mapLink);
  }

  findSourceLink(targetType: SourceLink['targetType'], targetId: string): SourceLink | null {
    const row = this.driver
      .prepare('SELECT * FROM source_links WHERE target_type = ? AND target_id = ?')
      .get(targetType, targetId) as LinkRow | undefined;
    return row ? mapLink(row) : null;
  }

  getPendingSummary(limit: number): InboxPendingSummary {
    const count = (
      this.driver
        .prepare("SELECT COUNT(*) AS count FROM inbox_items WHERE deleted_at IS NULL AND state = 'pending'")
        .get() as {
        count: number;
      }
    ).count;
    const items = (
      this.driver
        .prepare(
          "SELECT * FROM inbox_items WHERE deleted_at IS NULL AND state = 'pending' ORDER BY captured_at DESC, id DESC LIMIT ?"
        )
        .all(Math.max(0, limit)) as ItemRow[]
    ).map(mapItem);
    return { count, items };
  }

  listUnreferencedAssets(): InboxAsset[] {
    return (
      this.driver
        .prepare(
          'SELECT a.* FROM inbox_assets a WHERE NOT EXISTS (SELECT 1 FROM inbox_asset_origins o WHERE o.asset_id = a.id) ORDER BY a.created_at, a.id'
        )
        .all() as AssetRow[]
    ).map(mapAsset);
  }

  deleteAsset(id: string): boolean {
    return (
      this.driver
        .prepare(
          'DELETE FROM inbox_assets WHERE id = ? AND NOT EXISTS (SELECT 1 FROM inbox_asset_origins WHERE asset_id = ?)'
        )
        .run(id, id).changes === 1
    );
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

  private batchUpdate(
    ids: readonly string[],
    update: (placeholders: string, normalized: string[]) => { changes: number }
  ): InboxMutationResult {
    const normalized = normalizeInboxBatchIds(ids);
    return this.transaction(() => {
      this.requireItems(normalized);
      const affectedCount = update(sqlPlaceholders(normalized), normalized).changes;
      return { affectedIds: normalized, affectedCount };
    });
  }

  private requireItems(ids: string[]): void {
    const count = (
      this.driver
        .prepare(`SELECT COUNT(*) AS count FROM inbox_items WHERE id IN (${sqlPlaceholders(ids)})`)
        .get(...ids) as {
        count: number;
      }
    ).count;
    if (count !== ids.length) throw new Error('INBOX_ITEM_NOT_FOUND');
  }
}

function buildListFilter(query: InboxListQuery): { where: string; params: unknown[] } {
  const conditions = [query.view === 'trash' ? 'i.deleted_at IS NOT NULL' : 'i.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (query.view !== 'trash') {
    conditions.push('i.state = ?');
    params.push(query.view);
  }
  if (query.kinds?.length) {
    conditions.push(`i.kind IN (${sqlPlaceholders(query.kinds)})`);
    params.push(...query.kinds);
  }
  const search = normalizeInboxSearch(query.search);
  if (search) {
    const like = `%${search.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    conditions.push(
      "(i.title LIKE ? ESCAPE '\\' OR i.text_content LIKE ? ESCAPE '\\' OR i.url LIKE ? ESCAPE '\\' OR o.original_name LIKE ? ESCAPE '\\')"
    );
    params.push(like, like, like, like);
  }
  return { where: conditions.join(' AND '), params };
}

function sqlPlaceholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}

function encodeCursor(item: InboxItem): string {
  return JSON.stringify([item.capturedAt, item.id]);
}

function decodeCursor(cursor?: string | null): { capturedAt: number; id: string } | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(cursor) as unknown;
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      !Number.isSafeInteger(value[0]) ||
      typeof value[1] !== 'string'
    ) {
      throw new Error();
    }
    return { capturedAt: value[0] as number, id: value[1] };
  } catch {
    throw new Error('INBOX_CURSOR_INVALID');
  }
}

function mapItem(row: ItemRow): InboxItem {
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    title: row.title,
    textContent: row.text_content,
    url: row.url,
    originId: row.origin_id,
    capturedAt: row.captured_at,
    organizedAt: row.organized_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function mapAsset(row: AssetRow): InboxAsset {
  return {
    id: row.id,
    sha256: row.sha256,
    managedName: row.managed_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

function mapOrigin(row: OriginRow): InboxAssetOrigin {
  return {
    id: row.id,
    assetId: row.asset_id,
    originalName: row.original_name,
    originalPath: row.original_path,
    importedAt: row.imported_at,
  };
}

function mapLink(row: LinkRow): SourceLink {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    targetType: row.target_type,
    targetId: row.target_id,
    createdAt: row.created_at,
  };
}
