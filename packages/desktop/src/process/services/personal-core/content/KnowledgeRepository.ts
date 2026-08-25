import type {
  KnowledgeIndexStatus,
  KnowledgeSearchQuery,
  KnowledgeSearchResult,
  KnowledgeSource,
  KnowledgeSourceType,
} from '@/common/types/searcht/knowledge';
import type { Note } from '@/common/types/searcht/notes';
import {
  buildKnowledgeMatchQuery,
  KNOWLEDGE_SEARCH_DEFAULT_LIMIT,
  KNOWLEDGE_SEARCH_MAX_LIMIT,
  normalizeKnowledgeQuery,
  rankKnowledgeSources,
} from '@/common/searcht/knowledgeSearch';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';

type SourceRow = {
  id: string;
  source_type: KnowledgeSourceType;
  source_id: string;
  title: string;
  content_text: string;
  content_hash: string;
  indexed_at: number;
  created_at: number;
  updated_at: number;
};

type NoteRow = {
  id: string;
  title: string;
  body: string;
  revision_number: number;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

export type KnowledgeInboxLink = {
  sourceId: string;
  targetId: string;
};

export class KnowledgeRepository {
  constructor(private readonly driver: ISqliteDriver) {}

  transaction<T>(operation: () => T): T {
    return this.driver.transaction(operation)();
  }

  upsert(source: KnowledgeSource): KnowledgeSource {
    return this.transaction(() => {
      this.driver.prepare('DELETE FROM knowledge_fts WHERE source_id = ?').run(source.id);
      this.driver
        .prepare(`INSERT INTO knowledge_sources (
          id, source_type, source_id, title, content_text, content_hash, indexed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_type, source_id) DO UPDATE SET
          id = excluded.id,
          title = excluded.title,
          content_text = excluded.content_text,
          content_hash = excluded.content_hash,
          indexed_at = excluded.indexed_at,
          updated_at = excluded.updated_at`)
        .run(
          source.id,
          source.sourceType,
          source.sourceId,
          source.title,
          source.contentText,
          source.contentHash,
          source.indexedAt,
          source.createdAt,
          source.updatedAt
        );
      this.driver
        .prepare('INSERT INTO knowledge_fts (source_id, title, content_text) VALUES (?, ?, ?)')
        .run(source.id, source.title, source.contentText);
      return this.findById(source.id)!;
    });
  }

  findById(id: string): KnowledgeSource | null {
    const row = this.driver.prepare('SELECT * FROM knowledge_sources WHERE id = ?').get(id) as SourceRow | undefined;
    return row ? mapSource(row) : null;
  }

  findBySource(sourceType: KnowledgeSourceType, sourceId: string): KnowledgeSource | null {
    const row = this.driver
      .prepare('SELECT * FROM knowledge_sources WHERE source_type = ? AND source_id = ?')
      .get(sourceType, sourceId) as SourceRow | undefined;
    return row ? mapSource(row) : null;
  }

  search(query: KnowledgeSearchQuery): KnowledgeSearchResult {
    const normalized = normalizeKnowledgeQuery(query.query);
    const sourceTypes = normalizeSourceTypes(query.sourceTypes);
    const limit = normalizeLimit(query.limit);
    const typeClause = sourceTypes.length ? ` AND s.source_type IN (${placeholders(sourceTypes)})` : '';
    const matchQuery = buildKnowledgeMatchQuery(normalized);
    let rows: SourceRow[];
    if (matchQuery) {
      rows = this.driver
        .prepare(`SELECT s.* FROM knowledge_fts f JOIN knowledge_sources s ON s.id = f.source_id
          WHERE knowledge_fts MATCH ?${typeClause}`)
        .all(matchQuery, ...sourceTypes) as SourceRow[];
    } else {
      rows = this.driver
        .prepare(`SELECT s.* FROM knowledge_sources s WHERE 1 = 1${typeClause}`)
        .all(...sourceTypes) as SourceRow[];
    }
    const sources = rows.map(mapSource);
    return {
      hits: rankKnowledgeSources(sources, normalized, limit, sourceTypes.length ? sourceTypes : undefined),
      total: sources.length,
    };
  }

  getStatus(): KnowledgeIndexStatus {
    const row = this.driver
      .prepare(`SELECT COUNT(*) AS source_count,
        SUM(CASE WHEN source_type = 'note' THEN 1 ELSE 0 END) AS note_count,
        SUM(CASE WHEN source_type = 'inbox-item' THEN 1 ELSE 0 END) AS inbox_count,
        MAX(indexed_at) AS last_indexed_at
        FROM knowledge_sources`)
      .get() as {
      source_count: number;
      note_count: number | null;
      inbox_count: number | null;
      last_indexed_at: number | null;
    };
    return {
      sourceCount: row.source_count,
      noteCount: row.note_count ?? 0,
      inboxCount: row.inbox_count ?? 0,
      lastIndexedAt: row.last_indexed_at,
    };
  }

  removeById(id: string): void {
    this.transaction(() => {
      this.driver.prepare('DELETE FROM knowledge_fts WHERE source_id = ?').run(id);
      this.driver.prepare('DELETE FROM knowledge_sources WHERE id = ?').run(id);
    });
  }

  removeBySource(sourceType: KnowledgeSourceType, sourceId: string): void {
    const source = this.findBySource(sourceType, sourceId);
    if (source) this.removeById(source.id);
  }

  removeAllNoteSources(): void {
    const ids = (
      this.driver.prepare("SELECT id FROM knowledge_sources WHERE source_type = 'note'").all() as Array<{ id: string }>
    ).map((row) => row.id);
    if (ids.length === 0) return;
    this.driver.prepare(`DELETE FROM knowledge_fts WHERE source_id IN (${placeholders(ids)})`).run(...ids);
    this.driver.prepare("DELETE FROM knowledge_sources WHERE source_type = 'note'").run();
  }

  rebuildFts(): void {
    this.transaction(() => {
      this.driver.prepare('DELETE FROM knowledge_fts').run();
      this.driver.exec(`INSERT INTO knowledge_fts (source_id, title, content_text)
        SELECT id, title, content_text FROM knowledge_sources`);
    });
  }

  listActiveNotes(): Note[] {
    return (
      this.driver
        .prepare('SELECT * FROM notes WHERE deleted_at IS NULL AND archived_at IS NULL ORDER BY updated_at DESC, id')
        .all() as NoteRow[]
    ).map(mapNote);
  }

  listInboxLinks(): KnowledgeInboxLink[] {
    return (
      this.driver
        .prepare(`SELECT source_id, target_id FROM source_links
          WHERE source_type = 'inbox-item' AND target_type = 'knowledge-source'
          ORDER BY created_at, id`)
        .all() as Array<{ source_id: string; target_id: string }>
    ).map((row) => ({ sourceId: row.source_id, targetId: row.target_id }));
  }

  deleteInboxLinkByTarget(targetId: string): void {
    this.driver
      .prepare("DELETE FROM source_links WHERE target_type = 'knowledge-source' AND target_id = ?")
      .run(targetId);
  }

  insertAudit(action: string, detail: Record<string, unknown>, now: number): void {
    this.driver
      .prepare('INSERT INTO personal_audit_log (id, action, outcome, detail_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), action, 'success', JSON.stringify(detail), now);
  }
}

function mapSource(row: SourceRow): KnowledgeSource {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    title: row.title,
    contentText: row.content_text,
    contentHash: row.content_hash,
    indexedAt: row.indexed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    revisionNumber: row.revision_number,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function normalizeSourceTypes(sourceTypes?: readonly KnowledgeSourceType[]): KnowledgeSourceType[] {
  if (!sourceTypes?.length) return [];
  const normalized = [...new Set(sourceTypes)];
  if (normalized.some((type) => type !== 'note' && type !== 'inbox-item')) {
    throw new Error('KNOWLEDGE_SOURCE_TYPE_INVALID');
  }
  return normalized;
}

function normalizeLimit(limit?: number): number {
  if (limit === undefined) return KNOWLEDGE_SEARCH_DEFAULT_LIMIT;
  if (!Number.isFinite(limit)) throw new Error('KNOWLEDGE_LIMIT_INVALID');
  return Math.max(1, Math.min(Math.trunc(limit), KNOWLEDGE_SEARCH_MAX_LIMIT));
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}
