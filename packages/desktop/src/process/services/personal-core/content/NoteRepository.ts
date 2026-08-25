import type {
  Note,
  NoteDetail,
  NoteListQuery,
  NoteListResult,
  NoteMutationResult,
  NoteRevision,
  NoteRevisionListQuery,
  NoteRevisionListResult,
  NoteSourceReference,
} from '@/common/types/searcht/notes';
import { normalizeNoteId, normalizeNoteListLimit, normalizeNoteSearch } from '@/common/searcht/noteValidation';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';

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

type RevisionRow = {
  id: string;
  note_id: string;
  revision_number: number;
  title: string;
  body: string;
  created_at: number;
};

type ReferenceRow = {
  id: string;
  source_type: NoteSourceReference['sourceType'];
  source_id: string;
  created_at: number;
};

export class NoteRepository {
  constructor(private readonly driver: ISqliteDriver) {}

  transaction<T>(operation: () => T): T {
    return this.driver.transaction(operation)();
  }

  insertNote(note: Note): Note {
    this.driver
      .prepare(`INSERT INTO notes (
        id, title, body, revision_number, archived_at, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        note.id,
        note.title,
        note.body,
        note.revisionNumber,
        note.archivedAt,
        note.createdAt,
        note.updatedAt,
        note.deletedAt
      );
    return this.findById(note.id)!;
  }

  updateNote(note: Note): Note {
    const result = this.driver
      .prepare(`UPDATE notes SET title = ?, body = ?, revision_number = ?, archived_at = ?,
        updated_at = ?, deleted_at = ? WHERE id = ?`)
      .run(note.title, note.body, note.revisionNumber, note.archivedAt, note.updatedAt, note.deletedAt, note.id);
    if (result.changes !== 1) throw new Error('NOTE_NOT_FOUND');
    return this.findById(note.id)!;
  }

  findById(id: string): Note | null {
    const row = this.driver.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow | undefined;
    return row ? mapNote(row) : null;
  }

  getDetail(id: string): NoteDetail | null {
    const note = this.findById(id);
    if (!note) return null;
    const rows = this.driver
      .prepare(`SELECT id, source_type, source_id, created_at FROM source_links
        WHERE target_type = 'note' AND target_id = ? ORDER BY created_at DESC, id`)
      .all(id) as ReferenceRow[];
    return { note, sourceReferences: rows.map(mapReference) };
  }

  list(query: NoteListQuery): NoteListResult {
    const search = normalizeNoteSearch(query.search);
    const limit = normalizeNoteListLimit(query.limit);
    const cursor = decodeCursor(query.cursor);
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (query.view === 'trash') {
      clauses.push('deleted_at IS NOT NULL');
    } else {
      clauses.push('deleted_at IS NULL');
      clauses.push(query.view === 'archived' ? 'archived_at IS NOT NULL' : 'archived_at IS NULL');
    }
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      clauses.push("(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')");
      params.push(pattern, pattern);
    }
    const where = clauses.join(' AND ');
    const total = (
      this.driver.prepare(`SELECT COUNT(*) AS count FROM notes WHERE ${where}`).get(...params) as {
        count: number;
      }
    ).count;
    const pageWhere = cursor ? `${where} AND (updated_at < ? OR (updated_at = ? AND id < ?))` : where;
    const pageParams = cursor ? [...params, cursor.updatedAt, cursor.updatedAt, cursor.id] : params;
    const rows = this.driver
      .prepare(`SELECT * FROM notes WHERE ${pageWhere} ORDER BY updated_at DESC, id DESC LIMIT ?`)
      .all(...pageParams, limit + 1) as NoteRow[];
    const hasMore = rows.length > limit;
    const notes = rows.slice(0, limit).map(mapNote);
    const last = hasMore ? notes.at(-1) : undefined;
    return { notes, total, nextCursor: last ? encodeCursor(last) : null };
  }

  insertRevision(revision: NoteRevision): NoteRevision {
    this.driver
      .prepare(`INSERT INTO note_revisions (
        id, note_id, revision_number, title, body, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(revision.id, revision.noteId, revision.revisionNumber, revision.title, revision.body, revision.createdAt);
    return this.findRevision(revision.noteId, revision.id)!;
  }

  findRevision(noteId: string, revisionId: string): NoteRevision | null {
    const row = this.driver
      .prepare('SELECT * FROM note_revisions WHERE note_id = ? AND id = ?')
      .get(noteId, revisionId) as RevisionRow | undefined;
    return row ? mapRevision(row) : null;
  }

  listRevisions(query: NoteRevisionListQuery): NoteRevisionListResult {
    const noteId = normalizeNoteId(query.noteId);
    const limit = normalizeNoteListLimit(query.limit);
    const cursor = query.cursor ?? null;
    const rows = this.driver
      .prepare(`SELECT * FROM note_revisions WHERE note_id = ? ${cursor === null ? '' : 'AND revision_number < ?'}
        ORDER BY revision_number DESC LIMIT ?`)
      .all(...(cursor === null ? [noteId, limit + 1] : [noteId, cursor, limit + 1])) as RevisionRow[];
    const hasMore = rows.length > limit;
    const revisions = rows.slice(0, limit).map(mapRevision);
    return { revisions, nextCursor: hasMore ? (revisions.at(-1)?.revisionNumber ?? null) : null };
  }

  archive(ids: readonly string[], now: number): NoteMutationResult {
    return this.batchUpdate(ids, `UPDATE notes SET archived_at = ?, updated_at = ? WHERE id IN`, [now, now]);
  }

  unarchive(ids: readonly string[], now: number): NoteMutationResult {
    return this.batchUpdate(ids, `UPDATE notes SET archived_at = NULL, updated_at = ? WHERE id IN`, [now]);
  }

  remove(ids: readonly string[], now: number): NoteMutationResult {
    return this.batchUpdate(ids, `UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id IN`, [now, now]);
  }

  restore(ids: readonly string[], now: number): NoteMutationResult {
    return this.batchUpdate(ids, `UPDATE notes SET deleted_at = NULL, updated_at = ? WHERE id IN`, [now]);
  }

  destroy(ids: readonly string[]): NoteMutationResult {
    const normalized = normalizeNoteIds(ids);
    return this.transaction(() => {
      this.requireNotes(normalized);
      const placeholders = sqlPlaceholders(normalized);
      this.driver
        .prepare(`DELETE FROM source_links WHERE target_type = 'note' AND target_id IN (${placeholders})`)
        .run(...normalized);
      const result = this.driver.prepare(`DELETE FROM notes WHERE id IN (${placeholders})`).run(...normalized);
      return { affectedIds: normalized, affectedCount: result.changes };
    });
  }

  listTrashIds(): string[] {
    return (
      this.driver.prepare('SELECT id FROM notes WHERE deleted_at IS NOT NULL ORDER BY id').all() as Array<{
        id: string;
      }>
    ).map((row) => row.id);
  }

  insertAudit(action: string, detail: Record<string, unknown>, now: number): void {
    this.driver
      .prepare('INSERT INTO personal_audit_log (id, action, outcome, detail_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), action, 'success', JSON.stringify(detail), now);
  }

  private batchUpdate(ids: readonly string[], sqlPrefix: string, prefixValues: readonly unknown[]): NoteMutationResult {
    const normalized = normalizeNoteIds(ids);
    return this.transaction(() => {
      this.requireNotes(normalized);
      const result = this.driver
        .prepare(`${sqlPrefix} (${sqlPlaceholders(normalized)})`)
        .run(...prefixValues, ...normalized);
      return { affectedIds: normalized, affectedCount: result.changes };
    });
  }

  private requireNotes(ids: readonly string[]): void {
    const rows = this.driver
      .prepare(`SELECT id FROM notes WHERE id IN (${sqlPlaceholders(ids)})`)
      .all(...ids) as Array<{ id: string }>;
    if (rows.length !== ids.length) throw new Error('NOTE_NOT_FOUND');
  }
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

function mapRevision(row: RevisionRow): NoteRevision {
  return {
    id: row.id,
    noteId: row.note_id,
    revisionNumber: row.revision_number,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
  };
}

function mapReference(row: ReferenceRow): NoteSourceReference {
  return { id: row.id, sourceType: row.source_type, sourceId: row.source_id, createdAt: row.created_at };
}

function normalizeNoteIds(ids: readonly string[]): string[] {
  if (ids.length === 0) throw new Error('NOTE_BATCH_REQUIRED');
  if (ids.length > 500) throw new Error('NOTE_BATCH_TOO_LARGE');
  const normalized = ids.map(normalizeNoteId);
  if (new Set(normalized).size !== normalized.length) throw new Error('NOTE_BATCH_DUPLICATE');
  return normalized;
}

function sqlPlaceholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function encodeCursor(note: Note): string {
  return Buffer.from(JSON.stringify({ updatedAt: note.updatedAt, id: note.id }), 'utf8').toString('base64url');
}

function decodeCursor(cursor?: string | null): { updatedAt: number; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (!Number.isSafeInteger(parsed.updatedAt) || typeof parsed.id !== 'string' || !parsed.id) throw new Error();
    return { updatedAt: parsed.updatedAt as number, id: parsed.id };
  } catch {
    throw new Error('NOTE_CURSOR_INVALID');
  }
}
