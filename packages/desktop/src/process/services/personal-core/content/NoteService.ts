import { randomUUID } from 'node:crypto';
import type {
  Note,
  NoteCreateInput,
  NoteDetail,
  NoteListQuery,
  NoteListResult,
  NoteMutationResult,
  NoteRevisionListQuery,
  NoteRevisionListResult,
  NoteRevisionRestoreInput,
  NoteUpdateInput,
} from '@/common/types/searcht/notes';
import { normalizeNoteContent, normalizeNoteId } from '@/common/searcht/noteValidation';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import { NoteRepository } from './NoteRepository';

export type NoteKnowledgeProjection = {
  upsertNote(note: Note, now: number): void;
  removeNote(noteId: string): void;
};

const NOOP_PROJECTION: NoteKnowledgeProjection = {
  upsertNote: () => undefined,
  removeNote: () => undefined,
};

export class NoteService {
  private readonly repository: NoteRepository;

  constructor(
    driver: ISqliteDriver,
    private readonly projection: NoteKnowledgeProjection = NOOP_PROJECTION
  ) {
    this.repository = new NoteRepository(driver);
  }

  list(query: NoteListQuery): NoteListResult {
    return this.repository.list(query);
  }

  get(id: string): NoteDetail | null {
    return this.repository.getDetail(normalizeNoteId(id));
  }

  create(input: NoteCreateInput, now = Date.now()): NoteDetail {
    return this.createWithId(input, randomUUID(), now);
  }

  createWithId(input: NoteCreateInput, id: string, now = Date.now()): NoteDetail {
    const noteId = normalizeNoteId(id);
    const normalized = normalizeNoteContent({ title: input.title, body: input.body ?? '' });
    return this.repository.transaction(() => {
      const note = this.repository.insertNote({
        id: noteId,
        ...normalized,
        revisionNumber: 1,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      this.repository.insertRevision({
        id: randomUUID(),
        noteId,
        revisionNumber: 1,
        title: note.title,
        body: note.body,
        createdAt: now,
      });
      this.projection.upsertNote(note, now);
      this.repository.insertAudit('note_create', { noteId }, now);
      return this.repository.getDetail(noteId)!;
    });
  }

  update(input: NoteUpdateInput, now = Date.now()): NoteDetail {
    const id = normalizeNoteId(input.id);
    const normalized = normalizeNoteContent(input);
    return this.repository.transaction(() => {
      const current = this.requireActive(id);
      if (current.title === normalized.title && current.body === normalized.body) {
        return this.repository.getDetail(id)!;
      }
      const note = this.repository.updateNote({
        ...current,
        ...normalized,
        revisionNumber: current.revisionNumber + 1,
        updatedAt: now,
      });
      this.repository.insertRevision({
        id: randomUUID(),
        noteId: id,
        revisionNumber: note.revisionNumber,
        title: note.title,
        body: note.body,
        createdAt: now,
      });
      this.projection.upsertNote(note, now);
      this.repository.insertAudit('note_update', { noteId: id, revisionNumber: note.revisionNumber }, now);
      return this.repository.getDetail(id)!;
    });
  }

  listRevisions(query: NoteRevisionListQuery): NoteRevisionListResult {
    const note = this.repository.findById(normalizeNoteId(query.noteId));
    if (!note) throw new Error('NOTE_NOT_FOUND');
    return this.repository.listRevisions(query);
  }

  restoreRevision(input: NoteRevisionRestoreInput, now = Date.now()): NoteDetail {
    const noteId = normalizeNoteId(input.noteId);
    const revisionId = normalizeNoteId(input.revisionId);
    return this.repository.transaction(() => {
      const current = this.requireActive(noteId);
      const revision = this.repository.findRevision(noteId, revisionId);
      if (!revision) throw new Error('NOTE_REVISION_NOT_FOUND');
      const note = this.repository.updateNote({
        ...current,
        title: revision.title,
        body: revision.body,
        revisionNumber: current.revisionNumber + 1,
        updatedAt: now,
      });
      this.repository.insertRevision({
        id: randomUUID(),
        noteId,
        revisionNumber: note.revisionNumber,
        title: note.title,
        body: note.body,
        createdAt: now,
      });
      this.projection.upsertNote(note, now);
      this.repository.insertAudit(
        'note_revision_restore',
        { noteId, revisionId, revisionNumber: note.revisionNumber },
        now
      );
      return this.repository.getDetail(noteId)!;
    });
  }

  archive(ids: readonly string[], now = Date.now()): NoteMutationResult {
    return this.mutate('note_archive', ids, now, () => this.repository.archive(ids, now), false);
  }

  unarchive(ids: readonly string[], now = Date.now()): NoteMutationResult {
    return this.mutate('note_unarchive', ids, now, () => this.repository.unarchive(ids, now), true);
  }

  remove(ids: readonly string[], now = Date.now()): NoteMutationResult {
    return this.mutate('note_delete', ids, now, () => this.repository.remove(ids, now), false);
  }

  restore(ids: readonly string[], now = Date.now()): NoteMutationResult {
    return this.mutate('note_restore', ids, now, () => this.repository.restore(ids, now), true);
  }

  destroy(ids: readonly string[], now = Date.now()): NoteMutationResult {
    return this.repository.transaction(() => {
      for (const id of ids) {
        const note = this.repository.findById(normalizeNoteId(id));
        if (!note || note.deletedAt === null) throw new Error('NOTE_NOT_IN_TRASH');
      }
      for (const id of ids) this.projection.removeNote(id);
      const result = this.repository.destroy(ids);
      this.repository.insertAudit('note_destroy', { noteIds: result.affectedIds, count: result.affectedCount }, now);
      return result;
    });
  }

  emptyTrash(now = Date.now()): NoteMutationResult {
    const ids = this.repository.listTrashIds();
    if (ids.length === 0) return { affectedIds: [], affectedCount: 0 };
    return this.destroy(ids, now);
  }

  private mutate(
    action: string,
    ids: readonly string[],
    now: number,
    operation: () => NoteMutationResult,
    shouldIndex: boolean
  ): NoteMutationResult {
    return this.repository.transaction(() => {
      const result = operation();
      for (const id of result.affectedIds) {
        if (shouldIndex) {
          const note = this.repository.findById(id)!;
          if (note.archivedAt === null && note.deletedAt === null) this.projection.upsertNote(note, now);
        } else {
          this.projection.removeNote(id);
        }
      }
      this.repository.insertAudit(action, { noteIds: result.affectedIds, count: result.affectedCount }, now);
      return result;
    });
  }

  private requireActive(id: string): Note {
    const note = this.repository.findById(id);
    if (!note || note.deletedAt !== null) throw new Error('NOTE_NOT_FOUND');
    return note;
  }
}
