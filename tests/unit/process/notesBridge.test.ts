import { describe, expect, it, vi } from 'vitest';
import { initNotesBridge } from '@process/bridge/notesBridge';

function makeService() {
  return {
    list: vi.fn(() => ({ notes: [], total: 0, nextCursor: null })),
    get: vi.fn(() => null),
    create: vi.fn(() => ({ note: { id: 'note-1' }, sourceReferences: [] })),
    update: vi.fn(() => ({ note: { id: 'note-1' }, sourceReferences: [] })),
    archive: vi.fn(() => ({ affectedIds: ['note-1'], affectedCount: 1 })),
    unarchive: vi.fn(() => ({ affectedIds: ['note-1'], affectedCount: 1 })),
    remove: vi.fn(() => ({ affectedIds: ['note-1'], affectedCount: 1 })),
    restore: vi.fn(() => ({ affectedIds: ['note-1'], affectedCount: 1 })),
    destroy: vi.fn(() => ({ affectedIds: ['note-1'], affectedCount: 1 })),
    emptyTrash: vi.fn(() => ({ affectedIds: [], affectedCount: 0 })),
    listRevisions: vi.fn(() => ({ revisions: [], nextCursor: null })),
    restoreRevision: vi.fn(() => ({ note: { id: 'note-1' }, sourceReferences: [] })),
  };
}

describe('notes bridge', () => {
  it('forwards typed note queries, lifecycle actions, and revision commands', async () => {
    const service = makeService();
    const handlers = initNotesBridge({ service: service as never });

    await handlers.list({ view: 'active', search: 'plan' });
    await handlers.create({ title: 'Plan', body: 'Body' });
    await handlers.update({ id: 'note-1', title: 'Changed', body: 'Body' });
    await handlers.archive(['note-1']);
    await handlers.listRevisions({ noteId: 'note-1', limit: 10 });
    await handlers.restoreRevision({ noteId: 'note-1', revisionId: 'revision-1' });

    expect(service.list).toHaveBeenCalledWith({ view: 'active', search: 'plan' });
    expect(service.create).toHaveBeenCalledWith({ title: 'Plan', body: 'Body' });
    expect(service.update).toHaveBeenCalledWith({ id: 'note-1', title: 'Changed', body: 'Body' });
    expect(service.archive).toHaveBeenCalledWith(['note-1']);
    expect(service.listRevisions).toHaveBeenCalledWith({ noteId: 'note-1', limit: 10 });
    expect(service.restoreRevision).toHaveBeenCalledWith({ noteId: 'note-1', revisionId: 'revision-1' });
  });

  it('propagates stable service errors', async () => {
    const service = makeService();
    service.create.mockImplementation(() => {
      throw new Error('NOTE_TITLE_REQUIRED');
    });
    const handlers = initNotesBridge({ service: service as never });

    await expect(handlers.create({ title: ' ' })).rejects.toThrow('NOTE_TITLE_REQUIRED');
  });
});
