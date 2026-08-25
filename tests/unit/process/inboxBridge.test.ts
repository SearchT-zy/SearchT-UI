import { describe, expect, it, vi } from 'vitest';
import { initInboxBridge } from '@process/bridge/inboxBridge';

describe('inbox bridge', () => {
  it('forwards typed operations to the service', async () => {
    const service = {
      list: vi.fn().mockReturnValue({ items: [], nextCursor: null, total: 0 }),
      get: vi.fn().mockReturnValue(null),
      captureText: vi.fn().mockReturnValue({ id: 'text-1' }),
      captureLink: vi.fn().mockReturnValue({ id: 'link-1' }),
      importFiles: vi.fn().mockResolvedValue({ imported: [], failed: [] }),
      update: vi.fn().mockReturnValue({ id: 'text-1' }),
      archive: vi.fn().mockReturnValue({ affectedIds: ['text-1'], affectedCount: 1 }),
      remove: vi.fn().mockReturnValue({ affectedIds: ['text-1'], affectedCount: 1 }),
      restore: vi.fn().mockReturnValue({ affectedIds: ['text-1'], affectedCount: 1 }),
      destroy: vi.fn().mockReturnValue({ affectedIds: ['text-1'], affectedCount: 1 }),
      emptyTrash: vi.fn().mockReturnValue({ affectedIds: [], affectedCount: 0 }),
      convertToTask: vi.fn().mockReturnValue({ targetId: 'task-1' }),
      convertToEvent: vi.fn().mockReturnValue({ targetId: 'event-1' }),
      convertToNote: vi.fn().mockReturnValue({ targetId: 'note-1' }),
      convertToKnowledge: vi.fn().mockReturnValue({ targetId: 'knowledge-1' }),
      getPendingSummary: vi.fn().mockReturnValue({ count: 0, items: [] }),
      getPreview: vi.fn().mockReturnValue({ kind: 'missing', displayName: 'file.txt' }),
      getManagedFilePath: vi.fn().mockReturnValue('C:\\private\\managed-file'),
    };
    const revealFile = vi.fn();
    const handlers = initInboxBridge({ service: service as never, revealFile });

    await handlers.list({ view: 'pending' });
    await handlers.captureText({ text: 'Capture' });
    await handlers.archive(['text-1']);
    await handlers.getPendingSummary(3);
    await handlers.convertToNote({ sourceId: 'text-1', operationId: 'operation-note' });
    await handlers.convertToKnowledge({ sourceId: 'text-1', operationId: 'operation-knowledge' });
    await handlers.getPreview('text-1');
    await handlers.revealManagedFile('text-1');

    expect(service.list).toHaveBeenCalledWith({ view: 'pending' });
    expect(service.captureText).toHaveBeenCalledWith({ text: 'Capture' });
    expect(service.archive).toHaveBeenCalledWith(['text-1']);
    expect(service.getPendingSummary).toHaveBeenCalledWith(3);
    expect(service.convertToNote).toHaveBeenCalledWith({ sourceId: 'text-1', operationId: 'operation-note' });
    expect(service.convertToKnowledge).toHaveBeenCalledWith({
      sourceId: 'text-1',
      operationId: 'operation-knowledge',
    });
    expect(service.getPreview).toHaveBeenCalledWith('text-1');
    expect(revealFile).toHaveBeenCalledWith('C:\\private\\managed-file');
  });

  it('rejects browser Blob sources at the Electron boundary', async () => {
    const service = { importFiles: vi.fn() };
    const handlers = initInboxBridge({ service: service as never });

    await expect(
      handlers.importFiles({ files: [{ kind: 'blob', name: 'a.txt', sizeBytes: 1, file: new Blob(['a']) }] })
    ).rejects.toThrow('INBOX_DESKTOP_PATH_REQUIRED');
    expect(service.importFiles).not.toHaveBeenCalled();
  });
});
