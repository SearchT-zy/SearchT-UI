import type {
  MemoryCandidate,
  MemoryItem,
  MemoryListQuery,
  MemoryListResult,
  MemoryScope,
  MemorySourceKind,
  MemorySourceReference,
  MemoryStatus,
  MemoryType,
} from '@/common/types/searcht/memory';
import { tokenizeMemoryQuery } from '@/common/searcht/memorySearch';
import { normalizeMemoryListLimit, normalizeMemorySources } from '@/common/searcht/memoryValidation';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';

type CandidateRow = {
  id: string;
  operation_id: string;
  content: string;
  memory_type: MemoryType;
  proposed_scope_kind: MemoryScope['kind'];
  proposed_scope_id: string | null;
  sensitivity: MemoryCandidate['sensitivity'];
  confidence: number;
  reason: string;
  source_refs_json: string;
  suggested_expires_at: number | null;
  created_at: number;
  updated_at: number;
};

type MemoryRow = {
  id: string;
  content: string;
  memory_type: MemoryType;
  scope_kind: MemoryScope['kind'];
  scope_id: string | null;
  sensitivity: MemoryItem['sensitivity'];
  confidence: number;
  reason: string;
  source_refs_json: string;
  confirmed_at: number;
  expires_at: number | null;
  review_at: number | null;
  last_retrieved_at: number | null;
  created_at: number;
  updated_at: number;
};

export class MemoryRepository {
  constructor(private readonly driver: ISqliteDriver) {}

  transaction<T>(operation: () => T): T {
    return this.driver.transaction(operation)();
  }

  insertCandidate(candidate: MemoryCandidate): MemoryCandidate {
    this.driver
      .prepare(`INSERT INTO memory_candidates (
        id, operation_id, content, memory_type, proposed_scope_kind, proposed_scope_id,
        sensitivity, confidence, reason, source_refs_json, suggested_expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        candidate.id,
        candidate.operationId,
        candidate.content,
        candidate.memoryType,
        candidate.proposedScope.kind,
        candidate.proposedScope.id,
        candidate.sensitivity,
        candidate.confidence,
        candidate.reason,
        JSON.stringify(candidate.sourceReferences),
        candidate.suggestedExpiresAt,
        candidate.createdAt,
        candidate.updatedAt
      );
    return this.findCandidateById(candidate.id)!;
  }

  findCandidateById(id: string): MemoryCandidate | null {
    const row = this.driver.prepare('SELECT * FROM memory_candidates WHERE id = ?').get(id) as CandidateRow | undefined;
    return row ? mapCandidate(row) : null;
  }

  findCandidateByOperationId(operationId: string): MemoryCandidate | null {
    const row = this.driver.prepare('SELECT * FROM memory_candidates WHERE operation_id = ?').get(operationId) as
      | CandidateRow
      | undefined;
    return row ? mapCandidate(row) : null;
  }

  listCandidates(limit: number): MemoryCandidate[] {
    return (
      this.driver
        .prepare('SELECT * FROM memory_candidates ORDER BY updated_at DESC, id LIMIT ?')
        .all(limit) as CandidateRow[]
    ).map(mapCandidate);
  }

  countCandidates(): number {
    return (this.driver.prepare('SELECT COUNT(*) AS count FROM memory_candidates').get() as { count: number }).count;
  }

  deleteCandidate(id: string): void {
    this.driver.prepare('DELETE FROM memory_candidates WHERE id = ?').run(id);
  }

  insertMemory(memory: MemoryItem): MemoryItem {
    this.driver
      .prepare(`INSERT INTO memory_items (
        id, content, memory_type, scope_kind, scope_id, sensitivity, confidence, reason,
        source_refs_json, confirmed_at, expires_at, review_at, last_retrieved_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(...memoryValues(memory));
    return this.findMemoryById(memory.id)!;
  }

  updateMemory(memory: MemoryItem): MemoryItem {
    this.driver
      .prepare(`UPDATE memory_items SET
        content = ?, memory_type = ?, scope_kind = ?, scope_id = ?, sensitivity = ?, confidence = ?, reason = ?,
        source_refs_json = ?, confirmed_at = ?, expires_at = ?, review_at = ?, last_retrieved_at = ?,
        created_at = ?, updated_at = ? WHERE id = ?`)
      .run(
        memory.content,
        memory.memoryType,
        memory.scope.kind,
        memory.scope.id,
        memory.sensitivity,
        memory.confidence,
        memory.reason,
        JSON.stringify(memory.sourceReferences),
        memory.confirmedAt,
        memory.expiresAt,
        memory.reviewAt,
        memory.lastRetrievedAt,
        memory.createdAt,
        memory.updatedAt,
        memory.id
      );
    return this.findMemoryById(memory.id)!;
  }

  findMemoryById(id: string): MemoryItem | null {
    const row = this.driver.prepare('SELECT * FROM memory_items WHERE id = ?').get(id) as MemoryRow | undefined;
    return row ? mapMemory(row) : null;
  }

  listMemories(query: MemoryListQuery & { now: number }): MemoryListResult {
    const conditions = [
      query.view === 'active'
        ? '(expires_at IS NULL OR expires_at > ?)'
        : '(expires_at IS NOT NULL AND expires_at <= ?)',
    ];
    const values: unknown[] = [query.now];
    const search = query.search?.trim().toLocaleLowerCase();
    if (search) {
      conditions.push('LOWER(content) LIKE ?');
      values.push(`%${escapeLike(search)}%`);
    }
    const memoryTypes = [...new Set(query.memoryTypes ?? [])];
    if (memoryTypes.length) {
      conditions.push(`memory_type IN (${placeholders(memoryTypes)})`);
      values.push(...memoryTypes);
    }
    const where = conditions.join(' AND ');
    const total = (
      this.driver.prepare(`SELECT COUNT(*) AS count FROM memory_items WHERE ${where}`).get(...values) as {
        count: number;
      }
    ).count;
    const limit = normalizeMemoryListLimit(query.limit);
    const rows = this.driver
      .prepare(`SELECT * FROM memory_items WHERE ${where} ORDER BY updated_at DESC, id LIMIT ?`)
      .all(...values, limit) as MemoryRow[];
    return { memories: rows.map(mapMemory), total };
  }

  findRetrievalCandidates(
    query: string,
    scopes: readonly MemoryScope[],
    includeSensitive: boolean,
    now: number
  ): MemoryItem[] {
    if (!scopes.length) return [];
    const conditions = ['(m.expires_at IS NULL OR m.expires_at > ?)'];
    const values: unknown[] = [now];
    const scopeConditions: string[] = [];
    for (const scope of scopes) {
      if (scope.kind === 'global') {
        scopeConditions.push("(m.scope_kind = 'global' AND m.scope_id IS NULL)");
      } else {
        scopeConditions.push('(m.scope_kind = ? AND m.scope_id = ?)');
        values.push(scope.kind, scope.id);
      }
    }
    conditions.push(`(${scopeConditions.join(' OR ')})`);
    if (!includeSensitive) conditions.push("m.sensitivity = 'normal'");
    const match = buildMatchQuery(query);
    const join = match ? 'JOIN memory_fts f ON f.memory_id = m.id' : '';
    if (match) {
      conditions.unshift('memory_fts MATCH ?');
      values.unshift(match);
    }
    return (
      this.driver
        .prepare(`SELECT m.* FROM memory_items m ${join} WHERE ${conditions.join(' AND ')}
          ORDER BY m.updated_at DESC, m.id LIMIT 500`)
        .all(...values) as MemoryRow[]
    ).map(mapMemory);
  }

  touchRetrieved(ids: readonly string[], now: number): void {
    if (!ids.length) return;
    this.driver
      .prepare(`UPDATE memory_items SET last_retrieved_at = ? WHERE id IN (${placeholders(ids)})`)
      .run(now, ...ids);
  }

  deleteMemory(id: string): void {
    this.driver.prepare('DELETE FROM memory_items WHERE id = ?').run(id);
  }

  searchMemoryIds(query: string): string[] {
    const match = buildMatchQuery(query);
    if (!match) return [];
    return (
      this.driver
        .prepare('SELECT memory_id FROM memory_fts WHERE memory_fts MATCH ? ORDER BY memory_id')
        .all(match) as Array<{ memory_id: string }>
    ).map((row) => row.memory_id);
  }

  getStatus(now: number): MemoryStatus {
    const itemCounts = this.driver
      .prepare(`SELECT
        SUM(CASE WHEN expires_at IS NULL OR expires_at > ? THEN 1 ELSE 0 END) AS active_count,
        SUM(CASE WHEN expires_at IS NOT NULL AND expires_at <= ? THEN 1 ELSE 0 END) AS expired_count,
        SUM(CASE WHEN sensitivity = 'sensitive' THEN 1 ELSE 0 END) AS sensitive_count
        FROM memory_items`)
      .get(now, now) as { active_count: number | null; expired_count: number | null; sensitive_count: number | null };
    return {
      pendingCount: this.countCandidates(),
      activeCount: itemCounts.active_count ?? 0,
      expiredCount: itemCounts.expired_count ?? 0,
      sensitiveCount: itemCounts.sensitive_count ?? 0,
    };
  }

  listAllMemories(): MemoryItem[] {
    return (this.driver.prepare('SELECT * FROM memory_items ORDER BY updated_at DESC, id').all() as MemoryRow[]).map(
      mapMemory
    );
  }

  insertAudit(id: string, action: string, detail: Record<string, unknown>, now: number): void {
    this.driver
      .prepare('INSERT INTO personal_audit_log (id, action, outcome, detail_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, action, 'success', JSON.stringify(detail), now);
  }
}

function mapCandidate(row: CandidateRow): MemoryCandidate {
  return {
    id: row.id,
    operationId: row.operation_id,
    content: row.content,
    memoryType: row.memory_type,
    proposedScope: { kind: row.proposed_scope_kind, id: row.proposed_scope_id },
    sensitivity: row.sensitivity,
    confidence: row.confidence,
    reason: row.reason,
    sourceReferences: parseSources(row.source_refs_json),
    suggestedExpiresAt: row.suggested_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMemory(row: MemoryRow): MemoryItem {
  return {
    id: row.id,
    content: row.content,
    memoryType: row.memory_type,
    scope: { kind: row.scope_kind, id: row.scope_id },
    sensitivity: row.sensitivity,
    confidence: row.confidence,
    reason: row.reason,
    sourceReferences: parseSources(row.source_refs_json),
    confirmedAt: row.confirmed_at,
    expiresAt: row.expires_at,
    reviewAt: row.review_at,
    lastRetrievedAt: row.last_retrieved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function memoryValues(memory: MemoryItem): unknown[] {
  return [
    memory.id,
    memory.content,
    memory.memoryType,
    memory.scope.kind,
    memory.scope.id,
    memory.sensitivity,
    memory.confidence,
    memory.reason,
    JSON.stringify(memory.sourceReferences),
    memory.confirmedAt,
    memory.expiresAt,
    memory.reviewAt,
    memory.lastRetrievedAt,
    memory.createdAt,
    memory.updatedAt,
  ];
}

function parseSources(value: string): MemorySourceReference[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error('MEMORY_SOURCE_REFS_CORRUPT');
  const sources = parsed.map((source): MemorySourceReference => {
    if (typeof source !== 'object' || source === null) throw new Error('MEMORY_SOURCE_REFS_CORRUPT');
    const record = source as Record<string, unknown>;
    if (typeof record.kind !== 'string' || typeof record.id !== 'string') {
      throw new Error('MEMORY_SOURCE_REFS_CORRUPT');
    }
    if (record.label !== undefined && typeof record.label !== 'string') {
      throw new Error('MEMORY_SOURCE_REFS_CORRUPT');
    }
    const normalizedSource: MemorySourceReference = {
      kind: record.kind as MemorySourceKind,
      id: record.id,
    };
    if (typeof record.label === 'string') normalizedSource.label = record.label;
    return normalizedSource;
  });
  return normalizeMemorySources(sources);
}

function buildMatchQuery(query: string): string {
  return tokenizeMemoryQuery(query)
    .map((token) => `"${token.replaceAll('"', '""')}"*`)
    .join(' AND ');
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}
