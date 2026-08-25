import { createHash } from 'node:crypto';
import type {
  KnowledgeIndexStatus,
  KnowledgeRebuildResult,
  KnowledgeSearchQuery,
  KnowledgeSearchResult,
  KnowledgeSource,
} from '@/common/types/searcht/knowledge';
import type { Note } from '@/common/types/searcht/notes';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import { KnowledgeRepository } from './KnowledgeRepository';
import type { NoteKnowledgeProjection } from './NoteService';

export type InboxKnowledgeDocument = {
  sourceId: string;
  title: string;
  contentText: string;
};

export type InboxKnowledgeContentReader = {
  read(sourceId: string): InboxKnowledgeDocument | null;
};

const EMPTY_READER: InboxKnowledgeContentReader = { read: () => null };

export class KnowledgeService implements NoteKnowledgeProjection {
  private readonly repository: KnowledgeRepository;

  constructor(
    driver: ISqliteDriver,
    private readonly inboxReader: InboxKnowledgeContentReader = EMPTY_READER
  ) {
    this.repository = new KnowledgeRepository(driver);
  }

  search(query: KnowledgeSearchQuery): KnowledgeSearchResult {
    return this.repository.search(query);
  }

  getStatus(): KnowledgeIndexStatus {
    return this.repository.getStatus();
  }

  upsertNote(note: Note, now = Date.now()): void {
    if (note.archivedAt !== null || note.deletedAt !== null) {
      this.removeNote(note.id);
      return;
    }
    const existing = this.repository.findBySource('note', note.id);
    this.repository.upsert({
      id: `knowledge-note-${note.id}`,
      sourceType: 'note',
      sourceId: note.id,
      title: note.title,
      contentText: note.body,
      contentHash: digest(note.title, note.body),
      indexedAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: note.updatedAt,
    });
  }

  removeNote(noteId: string): void {
    this.repository.removeBySource('note', noteId);
  }

  upsertInbox(document: InboxKnowledgeDocument, targetId: string, now = Date.now()): KnowledgeSource {
    const existing = this.repository.findBySource('inbox-item', document.sourceId);
    return this.repository.upsert({
      id: targetId,
      sourceType: 'inbox-item',
      sourceId: document.sourceId,
      title: document.title,
      contentText: document.contentText,
      contentHash: digest(document.title, document.contentText),
      indexedAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  rebuild(now = Date.now()): KnowledgeRebuildResult {
    return this.repository.transaction(() => {
      let indexedCount = 0;
      let failedCount = 0;
      this.repository.removeAllNoteSources();
      for (const note of this.repository.listActiveNotes()) {
        this.upsertNote(note, now);
        indexedCount += 1;
      }
      for (const link of this.repository.listInboxLinks()) {
        const document = this.inboxReader.read(link.sourceId);
        if (!document) {
          this.repository.removeById(link.targetId);
          failedCount += 1;
          continue;
        }
        const existing = this.repository.findById(link.targetId);
        this.repository.upsert({
          id: link.targetId,
          sourceType: 'inbox-item',
          sourceId: document.sourceId,
          title: document.title,
          contentText: document.contentText,
          contentHash: digest(document.title, document.contentText),
          indexedAt: now,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        });
        indexedCount += 1;
      }
      this.repository.rebuildFts();
      this.repository.insertAudit('knowledge_rebuild', { indexedCount, failedCount }, now);
      return { indexedCount, failedCount, completedAt: now };
    });
  }

  removeSource(id: string, now = Date.now()): void {
    this.repository.transaction(() => {
      const source = this.repository.findById(id);
      if (!source) throw new Error('KNOWLEDGE_SOURCE_NOT_FOUND');
      if (source.sourceType === 'note') throw new Error('KNOWLEDGE_NOTE_SOURCE_MANAGED');
      this.repository.removeById(id);
      this.repository.deleteInboxLinkByTarget(id);
      this.repository.insertAudit('knowledge_source_remove', { sourceId: id }, now);
    });
  }
}

function digest(title: string, contentText: string): string {
  return createHash('sha256').update(title).update('\0').update(contentText).digest('hex');
}
