import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '@/common/types/searcht/notes';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { NoteService, type NoteKnowledgeProjection } from '@process/services/personal-core/content/NoteService';

let directory: string;
let database: PersonalDatabase;
let projection: NoteKnowledgeProjection;
let service: NoteService;

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-note-service-'));
  database = PersonalDatabase.open(directory);
  projection = {
    upsertNote: vi.fn(),
    removeNote: vi.fn(),
  };
  service = new NoteService(database.driver, projection);
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('NoteService', () => {
  it('creates a note and its first immutable revision', () => {
    const detail = service.createWithId({ title: '  Release plan  ', body: 'Body\r\ntext' }, 'note-1', 100);

    expect(detail.note).toMatchObject({
      id: 'note-1',
      title: 'Release plan',
      body: 'Body\ntext',
      revisionNumber: 1,
    });
    expect(service.listRevisions({ noteId: 'note-1' }).revisions).toEqual([
      expect.objectContaining({ noteId: 'note-1', revisionNumber: 1, title: 'Release plan' }),
    ]);
    expect(projection.upsertNote).toHaveBeenCalledWith(detail.note, 100);
  });

  it('creates a new revision only when normalized content changes', () => {
    service.createWithId({ title: 'Plan', body: 'Body' }, 'note-1', 100);

    const unchanged = service.update({ id: 'note-1', title: ' Plan ', body: 'Body' }, 200);
    const changed = service.update({ id: 'note-1', title: 'Plan', body: 'Changed' }, 300);

    expect(unchanged.note.revisionNumber).toBe(1);
    expect(changed.note.revisionNumber).toBe(2);
    expect(service.listRevisions({ noteId: 'note-1' }).revisions.map((value) => value.revisionNumber)).toEqual([2, 1]);
    expect(projection.upsertNote).toHaveBeenCalledTimes(2);
  });

  it('restores an old revision as a new head without rewriting history', () => {
    service.createWithId({ title: 'First', body: 'One' }, 'note-1', 100);
    service.update({ id: 'note-1', title: 'Second', body: 'Two' }, 200);
    const oldest = service.listRevisions({ noteId: 'note-1' }).revisions.at(-1)!;

    const restored = service.restoreRevision({ noteId: 'note-1', revisionId: oldest.id }, 300);

    expect(restored.note).toMatchObject({ title: 'First', body: 'One', revisionNumber: 3 });
    expect(service.listRevisions({ noteId: 'note-1' }).revisions.map((value) => value.revisionNumber)).toEqual([
      3, 2, 1,
    ]);
  });

  it('keeps Knowledge projection synchronized across lifecycle changes', () => {
    const created = service.createWithId({ title: 'Plan' }, 'note-1', 100).note;
    service.archive(['note-1'], 200);
    service.unarchive(['note-1'], 300);
    service.remove(['note-1'], 400);
    service.restore(['note-1'], 500);
    service.remove(['note-1'], 550);
    service.destroy(['note-1'], 600);

    expect(projection.removeNote).toHaveBeenNthCalledWith(1, created.id);
    expect(projection.removeNote).toHaveBeenNthCalledWith(2, created.id);
    expect(projection.removeNote).toHaveBeenNthCalledWith(3, created.id);
    expect(projection.removeNote).toHaveBeenNthCalledWith(4, created.id);
    expect(projection.upsertNote).toHaveBeenCalledTimes(3);
  });

  it('rolls back note creation when Knowledge projection fails', () => {
    vi.mocked(projection.upsertNote).mockImplementation(() => {
      throw new Error('INDEX_WRITE_FAILED');
    });

    expect(() => service.createWithId({ title: 'Plan' }, 'note-1', 100)).toThrow('INDEX_WRITE_FAILED');
    expect(service.get('note-1')).toBeNull();
    expect(database.driver.prepare("SELECT id FROM note_revisions WHERE note_id = 'note-1'").all()).toEqual([]);
  });

  it('rejects missing or deleted notes without creating revisions', () => {
    expect(() => service.update({ id: 'missing', title: 'Plan', body: '' }, 100)).toThrow('NOTE_NOT_FOUND');
    service.createWithId({ title: 'Plan' }, 'note-1', 200);
    service.remove(['note-1'], 300);
    expect(() => service.update({ id: 'note-1', title: 'Changed', body: '' }, 400)).toThrow('NOTE_NOT_FOUND');
    expect(service.listRevisions({ noteId: 'note-1' }).revisions).toHaveLength(1);
  });

  it('audits identifiers and lifecycle counts without storing note content', () => {
    const privateBody = 'private customer statement';
    service.createWithId({ title: 'Private title', body: privateBody }, 'note-1', 100);
    service.update({ id: 'note-1', title: 'Private title', body: `${privateBody} changed` }, 200);
    service.remove(['note-1'], 300);

    const rows = database.driver
      .prepare('SELECT action, detail_json FROM personal_audit_log ORDER BY created_at')
      .all() as Array<{
      action: string;
      detail_json: string;
    }>;
    expect(rows.map((row) => row.action)).toEqual(['note_create', 'note_update', 'note_delete']);
    expect(rows.every((row) => row.detail_json.includes('note-1'))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(privateBody);
    expect(JSON.stringify(rows)).not.toContain('Private title');
  });

  it('empties trash while keeping active notes', () => {
    service.createWithId({ title: 'Keep' }, 'keep', 100);
    service.createWithId({ title: 'Discard A' }, 'discard-a', 100);
    service.createWithId({ title: 'Discard B' }, 'discard-b', 100);
    service.remove(['discard-a', 'discard-b'], 200);

    expect(service.emptyTrash(300)).toEqual({ affectedIds: ['discard-a', 'discard-b'], affectedCount: 2 });
    expect(service.list({ view: 'active' }).notes.map((value: Note) => value.id)).toEqual(['keep']);
  });
});
