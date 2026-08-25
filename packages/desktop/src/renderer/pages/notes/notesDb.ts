import type {
  KnowledgeIndexStatus,
  KnowledgeRebuildResult,
  KnowledgeSearchQuery,
  KnowledgeSearchResult,
  KnowledgeSource,
} from '@/common/types/searcht/knowledge';
import type {
  Note,
  NoteClient,
  NoteCreateInput,
  NoteDetail,
  NoteListQuery,
  NoteListResult,
  NoteMutationResult,
  NoteRevision,
  NoteRevisionListQuery,
  NoteRevisionListResult,
  NoteRevisionRestoreInput,
  NoteUpdateInput,
} from '@/common/types/searcht/notes';
import type { SourceLink } from '@/common/types/searcht/inbox';
import { rankKnowledgeSources } from '@/common/searcht/knowledgeSearch';
import {
  normalizeNoteContent,
  normalizeNoteId,
  normalizeNoteListLimit,
  normalizeNoteSearch,
} from '@/common/searcht/noteValidation';
import {
  openPersonalWebDatabase,
  PERSONAL_WEB_DATABASE_NAME,
  PERSONAL_WEB_STORE_NAMES,
  requestResult,
  transactionDone,
} from '../personal/personalDbSchema';

export type OpenNotesDatabaseOptions = {
  name?: string;
  factory?: IDBFactory;
  now?: () => number;
  randomUUID?: () => string;
  crypto?: Pick<Crypto, 'subtle'>;
};

type NoteLifecycleAction = 'archive' | 'unarchive' | 'remove' | 'restore';

function applyNoteLifecycle(note: Note, action: NoteLifecycleAction, now: number): Note {
  if (action === 'archive') return { ...note, archivedAt: now, updatedAt: now };
  if (action === 'unarchive') return { ...note, archivedAt: null, updatedAt: now };
  if (action === 'remove') return { ...note, deletedAt: now, updatedAt: now };
  return { ...note, deletedAt: null, updatedAt: now };
}

export class NotesDatabase implements NoteClient {
  constructor(
    private readonly database: IDBDatabase,
    private readonly now: () => number,
    private readonly randomUUID: () => string,
    private readonly cryptoProvider: Pick<Crypto, 'subtle'>
  ) {}

  close(): void {
    this.database.close();
  }

  async list(query: NoteListQuery): Promise<NoteListResult> {
    const search = normalizeNoteSearch(query.search).toLocaleLowerCase();
    const limit = normalizeNoteListLimit(query.limit);
    const transaction = this.database.transaction(PERSONAL_WEB_STORE_NAMES.notes, 'readonly');
    const done = transactionDone(transaction);
    const notes = await requestResult<Note[]>(transaction.objectStore(PERSONAL_WEB_STORE_NAMES.notes).getAll());
    await done;
    const filtered = notes
      .filter((note) => matchesView(note, query.view))
      .filter(
        (note) =>
          !search || note.title.toLocaleLowerCase().includes(search) || note.body.toLocaleLowerCase().includes(search)
      )
      .toSorted((left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id));
    const offset = decodeCursor(query.cursor);
    const page = filtered.slice(offset, offset + limit);
    return {
      notes: page,
      total: filtered.length,
      nextCursor: offset + limit < filtered.length ? String(offset + limit) : null,
    };
  }

  async get(id: string): Promise<NoteDetail | null> {
    const noteId = normalizeNoteId(id);
    const transaction = this.database.transaction(
      [PERSONAL_WEB_STORE_NAMES.notes, PERSONAL_WEB_STORE_NAMES.links],
      'readonly'
    );
    const done = transactionDone(transaction);
    const notePromise = requestResult<Note | undefined>(
      transaction.objectStore(PERSONAL_WEB_STORE_NAMES.notes).get(noteId)
    );
    const linksPromise = requestResult<
      Array<{
        id: string;
        sourceType: 'inbox-item';
        sourceId: string;
        targetType: string;
        targetId: string;
        createdAt: number;
      }>
    >(transaction.objectStore(PERSONAL_WEB_STORE_NAMES.links).getAll());
    const [note, links] = await Promise.all([notePromise, linksPromise]);
    await done;
    if (!note) return null;
    return {
      note,
      sourceReferences: links
        .filter((link) => link.targetType === 'note' && link.targetId === noteId)
        .map((link) => ({
          id: link.id,
          sourceType: link.sourceType,
          sourceId: link.sourceId,
          createdAt: link.createdAt,
        }))
        .toSorted((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id)),
    };
  }

  async create(input: NoteCreateInput): Promise<NoteDetail> {
    const normalized = normalizeNoteContent({ title: input.title, body: input.body ?? '' });
    const now = this.now();
    const note: Note = {
      id: this.randomUUID(),
      ...normalized,
      revisionNumber: 1,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const revision = this.newRevision(note, now);
    const projection = await this.noteProjection(note, now);
    await this.writeNoteBundle(note, revision, projection);
    return { note, sourceReferences: [] };
  }

  async update(input: NoteUpdateInput): Promise<NoteDetail> {
    const current = await this.requireActive(input.id);
    const normalized = normalizeNoteContent(input);
    if (current.title === normalized.title && current.body === normalized.body) return (await this.get(current.id))!;
    const now = this.now();
    const note: Note = {
      ...current,
      ...normalized,
      revisionNumber: current.revisionNumber + 1,
      updatedAt: now,
    };
    const projection = await this.noteProjection(note, now);
    await this.writeNoteBundle(note, this.newRevision(note, now), projection);
    return (await this.get(note.id))!;
  }

  archive(ids: string[]): Promise<NoteMutationResult> {
    return this.changeLifecycle(ids, 'archive');
  }

  unarchive(ids: string[]): Promise<NoteMutationResult> {
    return this.changeLifecycle(ids, 'unarchive');
  }

  remove(ids: string[]): Promise<NoteMutationResult> {
    return this.changeLifecycle(ids, 'remove');
  }

  restore(ids: string[]): Promise<NoteMutationResult> {
    return this.changeLifecycle(ids, 'restore');
  }

  async destroy(ids: string[]): Promise<NoteMutationResult> {
    const normalized = normalizeIds(ids);
    const [notes, revisions, links, sources] = await Promise.all([
      this.getAll<Note>(PERSONAL_WEB_STORE_NAMES.notes),
      this.getAll<NoteRevision>(PERSONAL_WEB_STORE_NAMES.revisions),
      this.getAll<{ id: string; targetType: string; targetId: string }>(PERSONAL_WEB_STORE_NAMES.links),
      this.getAll<KnowledgeSource>(PERSONAL_WEB_STORE_NAMES.knowledge),
    ]);
    const selected = normalized.map((id) => notes.find((note) => note.id === id));
    if (selected.some((note) => !note)) throw new Error('NOTE_NOT_FOUND');
    if (selected.some((note) => note!.deletedAt === null)) throw new Error('NOTE_NOT_IN_TRASH');
    const transaction = this.database.transaction(
      [
        PERSONAL_WEB_STORE_NAMES.notes,
        PERSONAL_WEB_STORE_NAMES.revisions,
        PERSONAL_WEB_STORE_NAMES.links,
        PERSONAL_WEB_STORE_NAMES.knowledge,
      ],
      'readwrite'
    );
    const done = transactionDone(transaction);
    const noteStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.notes);
    const revisionStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.revisions);
    const linkStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.links);
    const knowledgeStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.knowledge);
    for (const id of normalized) noteStore.delete(id);
    for (const revision of revisions.filter((value) => normalized.includes(value.noteId)))
      revisionStore.delete(revision.id);
    for (const link of links.filter((value) => value.targetType === 'note' && normalized.includes(value.targetId))) {
      linkStore.delete(link.id);
    }
    for (const source of sources.filter(
      (value) => value.sourceType === 'note' && normalized.includes(value.sourceId)
    )) {
      knowledgeStore.delete(source.id);
    }
    await done;
    return { affectedIds: normalized, affectedCount: normalized.length };
  }

  async emptyTrash(): Promise<NoteMutationResult> {
    const trash = await this.list({ view: 'trash', limit: 100 });
    if (trash.notes.length === 0) return { affectedIds: [], affectedCount: 0 };
    return this.destroy(trash.notes.map((note) => note.id));
  }

  async listRevisions(query: NoteRevisionListQuery): Promise<NoteRevisionListResult> {
    const noteId = normalizeNoteId(query.noteId);
    const limit = normalizeNoteListLimit(query.limit);
    if (!(await this.get(noteId))) throw new Error('NOTE_NOT_FOUND');
    const revisions = (await this.getAll<NoteRevision>(PERSONAL_WEB_STORE_NAMES.revisions))
      .filter((revision) => revision.noteId === noteId)
      .filter((revision) => query.cursor == null || revision.revisionNumber < query.cursor)
      .toSorted((left, right) => right.revisionNumber - left.revisionNumber);
    const page = revisions.slice(0, limit);
    return { revisions: page, nextCursor: revisions.length > limit ? (page.at(-1)?.revisionNumber ?? null) : null };
  }

  async restoreRevision(input: NoteRevisionRestoreInput): Promise<NoteDetail> {
    const current = await this.requireActive(input.noteId);
    const revisions = await this.getAll<NoteRevision>(PERSONAL_WEB_STORE_NAMES.revisions);
    const revision = revisions.find((value) => value.noteId === current.id && value.id === input.revisionId);
    if (!revision) throw new Error('NOTE_REVISION_NOT_FOUND');
    return this.update({ id: current.id, title: revision.title, body: revision.body });
  }

  async searchKnowledge(query: KnowledgeSearchQuery): Promise<KnowledgeSearchResult> {
    const sources = await this.getAll<KnowledgeSource>(PERSONAL_WEB_STORE_NAMES.knowledge);
    const hits = rankKnowledgeSources(sources, query.query, query.limit, query.sourceTypes);
    const allowed = query.sourceTypes?.length ? new Set(query.sourceTypes) : null;
    const total = rankKnowledgeSources(sources, query.query, sources.length || 1, query.sourceTypes).filter(
      (hit) => !allowed || allowed.has(hit.source.sourceType)
    ).length;
    return { hits, total };
  }

  async getKnowledgeStatus(): Promise<KnowledgeIndexStatus> {
    const sources = await this.getAll<KnowledgeSource>(PERSONAL_WEB_STORE_NAMES.knowledge);
    return {
      sourceCount: sources.length,
      noteCount: sources.filter((source) => source.sourceType === 'note').length,
      inboxCount: sources.filter((source) => source.sourceType === 'inbox-item').length,
      lastIndexedAt: sources.length ? Math.max(...sources.map((source) => source.indexedAt)) : null,
    };
  }

  async rebuildKnowledge(): Promise<KnowledgeRebuildResult> {
    const notes = (await this.getAll<Note>(PERSONAL_WEB_STORE_NAMES.notes)).filter(
      (note) => note.deletedAt === null && note.archivedAt === null
    );
    const existing = await this.getAll<KnowledgeSource>(PERSONAL_WEB_STORE_NAMES.knowledge);
    const now = this.now();
    const projections = await Promise.all(notes.map((note) => this.noteProjection(note, now)));
    const transaction = this.database.transaction(PERSONAL_WEB_STORE_NAMES.knowledge, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.knowledge);
    for (const source of existing.filter((value) => value.sourceType === 'note')) store.delete(source.id);
    for (const projection of projections) store.put(projection);
    await done;
    return { indexedCount: projections.length, failedCount: 0, completedAt: now };
  }

  async removeKnowledgeSource(id: string): Promise<void> {
    const source = (await this.getAll<KnowledgeSource>(PERSONAL_WEB_STORE_NAMES.knowledge)).find(
      (value) => value.id === id
    );
    if (!source) throw new Error('KNOWLEDGE_SOURCE_NOT_FOUND');
    if (source.sourceType === 'note') throw new Error('KNOWLEDGE_NOTE_SOURCE_MANAGED');
    const transaction = this.database.transaction(
      [PERSONAL_WEB_STORE_NAMES.knowledge, PERSONAL_WEB_STORE_NAMES.links],
      'readwrite'
    );
    const done = transactionDone(transaction);
    const links = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.links);
    const sourceLink = await requestResult<SourceLink | undefined>(links.index('target').get(['knowledge-source', id]));
    transaction.objectStore(PERSONAL_WEB_STORE_NAMES.knowledge).delete(id);
    if (sourceLink) links.delete(sourceLink.id);
    await done;
  }

  private async changeLifecycle(ids: string[], action: NoteLifecycleAction): Promise<NoteMutationResult> {
    const normalized = normalizeIds(ids);
    const notes = await this.getAll<Note>(PERSONAL_WEB_STORE_NAMES.notes);
    const selected = normalized.map((id) => notes.find((note) => note.id === id));
    if (selected.some((note) => !note)) throw new Error('NOTE_NOT_FOUND');
    const now = this.now();
    const changed = selected.map((note) => applyNoteLifecycle(note!, action, now));
    const projections = await Promise.all(
      changed.map((note) =>
        note.archivedAt === null && note.deletedAt === null ? this.noteProjection(note, now) : Promise.resolve(null)
      )
    );
    const transaction = this.database.transaction(
      [PERSONAL_WEB_STORE_NAMES.notes, PERSONAL_WEB_STORE_NAMES.knowledge],
      'readwrite'
    );
    const done = transactionDone(transaction);
    const noteStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.notes);
    const knowledgeStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.knowledge);
    changed.forEach((note, index) => {
      noteStore.put(note);
      const projection = projections[index];
      if (projection) knowledgeStore.put(projection);
      else knowledgeStore.delete(`knowledge-note-${note.id}`);
    });
    await done;
    return { affectedIds: normalized, affectedCount: normalized.length };
  }

  private async requireActive(id: string): Promise<Note> {
    const detail = await this.get(normalizeNoteId(id));
    if (!detail || detail.note.deletedAt !== null) throw new Error('NOTE_NOT_FOUND');
    return detail.note;
  }

  private newRevision(note: Note, now: number): NoteRevision {
    return {
      id: this.randomUUID(),
      noteId: note.id,
      revisionNumber: note.revisionNumber,
      title: note.title,
      body: note.body,
      createdAt: now,
    };
  }

  private async noteProjection(note: Note, now: number): Promise<KnowledgeSource> {
    const contentHash = await digest(this.cryptoProvider, note.title, note.body);
    const existing = (await this.getAll<KnowledgeSource>(PERSONAL_WEB_STORE_NAMES.knowledge)).find(
      (source) => source.sourceType === 'note' && source.sourceId === note.id
    );
    return {
      id: `knowledge-note-${note.id}`,
      sourceType: 'note',
      sourceId: note.id,
      title: note.title,
      contentText: note.body,
      contentHash,
      indexedAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: note.updatedAt,
    };
  }

  private async writeNoteBundle(note: Note, revision: NoteRevision, projection: KnowledgeSource): Promise<void> {
    const transaction = this.database.transaction(
      [PERSONAL_WEB_STORE_NAMES.notes, PERSONAL_WEB_STORE_NAMES.revisions, PERSONAL_WEB_STORE_NAMES.knowledge],
      'readwrite'
    );
    const done = transactionDone(transaction);
    try {
      transaction.objectStore(PERSONAL_WEB_STORE_NAMES.notes).put(note);
      transaction.objectStore(PERSONAL_WEB_STORE_NAMES.revisions).put(revision);
      transaction.objectStore(PERSONAL_WEB_STORE_NAMES.knowledge).put(projection);
      await done;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The failed request may already have aborted the transaction.
      }
      await done.catch((): undefined => undefined);
      throw error;
    }
  }

  private async getAll<T>(storeName: string): Promise<T[]> {
    const transaction = this.database.transaction(storeName, 'readonly');
    const done = transactionDone(transaction);
    const values = await requestResult<T[]>(transaction.objectStore(storeName).getAll());
    await done;
    return values;
  }
}

export async function openNotesDatabase(options: OpenNotesDatabaseOptions = {}): Promise<NotesDatabase> {
  const factory = options.factory ?? globalThis.indexedDB;
  if (!factory) throw new Error('NOTES_INDEXEDDB_UNAVAILABLE');
  const cryptoProvider = options.crypto ?? globalThis.crypto;
  if (!cryptoProvider?.subtle) throw new Error('NOTES_CRYPTO_UNAVAILABLE');
  const randomUUID = options.randomUUID ?? (() => globalThis.crypto.randomUUID());
  const database = await openPersonalWebDatabase(factory, options.name ?? PERSONAL_WEB_DATABASE_NAME);
  return new NotesDatabase(database, options.now ?? Date.now, randomUUID, cryptoProvider);
}

function matchesView(note: Note, view: NoteListQuery['view']): boolean {
  if (view === 'trash') return note.deletedAt !== null;
  if (note.deletedAt !== null) return false;
  return view === 'archived' ? note.archivedAt !== null : note.archivedAt === null;
}

function normalizeIds(ids: readonly string[]): string[] {
  if (ids.length === 0) throw new Error('NOTE_BATCH_REQUIRED');
  const normalized = ids.map(normalizeNoteId);
  if (new Set(normalized).size !== normalized.length) throw new Error('NOTE_BATCH_DUPLICATE');
  return normalized;
}

function decodeCursor(cursor?: string | null): number {
  if (!cursor) return 0;
  const parsed = Number(cursor);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('NOTE_CURSOR_INVALID');
  return parsed;
}

async function digest(provider: Pick<Crypto, 'subtle'>, title: string, body: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${title}\0${body}`);
  const value = await provider.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
