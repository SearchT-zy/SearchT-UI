import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Note, NoteRevision } from '@/common/types/searcht/notes';
import { InboxRepository } from '@process/services/personal-core/InboxRepository';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { NoteRepository } from '@process/services/personal-core/content/NoteRepository';

let directory: string;
let database: PersonalDatabase;
let repository: NoteRepository;

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    title: 'Release plan',
    body: 'Prepare the checklist',
    revisionNumber: 1,
    archivedAt: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    ...overrides,
  };
}

function revision(overrides: Partial<NoteRevision> = {}): NoteRevision {
  return {
    id: 'revision-1',
    noteId: 'note-1',
    revisionNumber: 1,
    title: 'Release plan',
    body: 'Prepare the checklist',
    createdAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-note-repository-'));
  database = PersonalDatabase.open(directory);
  repository = new NoteRepository(database.driver);
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('NoteRepository', () => {
  it('stores a note, immutable revisions, and Inbox provenance', () => {
    repository.insertNote(note());
    repository.insertRevision(revision());
    new InboxRepository(database.driver).insertItem({
      id: 'inbox-1',
      kind: 'text',
      state: 'organized',
      title: 'Captured plan',
      textContent: 'Prepare the checklist',
      url: null,
      originId: null,
      capturedAt: 1,
      organizedAt: 2,
      archivedAt: null,
      createdAt: 1,
      updatedAt: 2,
      deletedAt: null,
    });
    new InboxRepository(database.driver).insertSourceLink({
      id: 'link-1',
      sourceType: 'inbox-item',
      sourceId: 'inbox-1',
      targetType: 'note',
      targetId: 'note-1',
      createdAt: 2,
    });

    expect(repository.getDetail('note-1')).toEqual({
      note: note(),
      sourceReferences: [{ id: 'link-1', sourceType: 'inbox-item', sourceId: 'inbox-1', createdAt: 2 }],
    });
    expect(repository.listRevisions({ noteId: 'note-1', limit: 10 })).toEqual({
      revisions: [revision()],
      nextCursor: null,
    });
  });

  it('filters active, archived, and trash views and searches title or body', () => {
    repository.insertNote(note({ id: 'active', title: 'Roadmap', updatedAt: 4 }));
    repository.insertNote(note({ id: 'body', title: 'Checklist', body: 'Release roadmap', updatedAt: 3 }));
    repository.insertNote(note({ id: 'archived', archivedAt: 5, updatedAt: 2 }));
    repository.insertNote(note({ id: 'trash', deletedAt: 6, updatedAt: 1 }));

    expect(repository.list({ view: 'active', search: 'roadmap' }).notes.map((value) => value.id)).toEqual([
      'active',
      'body',
    ]);
    expect(repository.list({ view: 'archived' }).notes.map((value) => value.id)).toEqual(['archived']);
    expect(repository.list({ view: 'trash' }).notes.map((value) => value.id)).toEqual(['trash']);
  });

  it('uses a stable cursor and reports totals before pagination', () => {
    repository.insertNote(note({ id: 'c', updatedAt: 3 }));
    repository.insertNote(note({ id: 'b', updatedAt: 2 }));
    repository.insertNote(note({ id: 'a', updatedAt: 1 }));

    const first = repository.list({ view: 'active', limit: 2 });
    const second = repository.list({ view: 'active', limit: 2, cursor: first.nextCursor });

    expect(first.notes.map((value) => value.id)).toEqual(['c', 'b']);
    expect(first.total).toBe(3);
    expect(second.notes.map((value) => value.id)).toEqual(['a']);
    expect(second.nextCursor).toBeNull();
  });

  it('rejects an entire lifecycle batch when one note is missing', () => {
    repository.insertNote(note({ id: 'one' }));

    expect(() => repository.archive(['one', 'missing'], 10)).toThrow('NOTE_NOT_FOUND');
    expect(repository.findById('one')).toMatchObject({ archivedAt: null });
  });

  it('archives, trashes, restores, and permanently removes revisions and provenance', () => {
    repository.insertNote(note());
    repository.insertRevision(revision());
    new InboxRepository(database.driver).insertItem({
      id: 'inbox-1',
      kind: 'text',
      state: 'organized',
      title: 'Capture',
      textContent: 'Body',
      url: null,
      originId: null,
      capturedAt: 1,
      organizedAt: 2,
      archivedAt: null,
      createdAt: 1,
      updatedAt: 2,
      deletedAt: null,
    });
    new InboxRepository(database.driver).insertSourceLink({
      id: 'link-1',
      sourceType: 'inbox-item',
      sourceId: 'inbox-1',
      targetType: 'note',
      targetId: 'note-1',
      createdAt: 2,
    });

    expect(repository.archive(['note-1'], 3).affectedCount).toBe(1);
    expect(repository.unarchive(['note-1'], 4).affectedIds).toEqual(['note-1']);
    expect(repository.remove(['note-1'], 5).affectedCount).toBe(1);
    expect(repository.restore(['note-1'], 6).affectedIds).toEqual(['note-1']);
    expect(repository.destroy(['note-1']).affectedCount).toBe(1);
    expect(repository.findById('note-1')).toBeNull();
    expect(database.driver.prepare("SELECT id FROM note_revisions WHERE note_id = 'note-1'").all()).toEqual([]);
    expect(database.driver.prepare("SELECT id FROM source_links WHERE target_id = 'note-1'").all()).toEqual([]);
    expect(database.driver.prepare("SELECT id FROM inbox_items WHERE id = 'inbox-1'").get()).toEqual({ id: 'inbox-1' });
  });
});
