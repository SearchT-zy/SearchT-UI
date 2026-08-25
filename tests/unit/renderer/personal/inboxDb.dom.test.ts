// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InboxFileImportSource } from '@/common/types/searcht/inbox';
import { openNotesDatabase } from '@renderer/pages/notes/notesDb';

const DATABASE_NAME = 'searcht-inbox-test';

async function loadDatabase() {
  const { openInboxDatabase } = await import('@renderer/pages/inbox/inboxDb');
  return openInboxDatabase({
    name: DATABASE_NAME,
    now: () => 1_723_650_000_000,
    randomUUID: (() => {
      let sequence = 0;
      return () => `test-id-${++sequence}`;
    })(),
  });
}

function deleteDatabase(name = DATABASE_NAME): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.addEventListener('success', () => resolve(), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
    request.addEventListener('blocked', () => reject(new Error('TEST_DATABASE_DELETE_BLOCKED')), { once: true });
  });
}

async function storedCounts(): Promise<{ assets: number; origins: number; items: number }> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME);
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
  const transaction = database.transaction(['inboxAssets', 'inboxAssetOrigins', 'inboxItems'], 'readonly');
  const count = (store: string) =>
    new Promise<number>((resolve, reject) => {
      const request = transaction.objectStore(store).count();
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
    });
  const [assets, origins, items] = await Promise.all([
    count('inboxAssets'),
    count('inboxAssetOrigins'),
    count('inboxItems'),
  ]);
  database.close();
  return { assets, origins, items };
}

async function schemaInfo(): Promise<{ version: number; stores: string[] }> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME);
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
  const result = { version: database.version, stores: Array.from(database.objectStoreNames) };
  database.close();
  return result;
}

function fileSource(name: string, contents: string): InboxFileImportSource {
  const file = new File([contents], name, { type: 'text/plain' });
  return { kind: 'blob', name, sizeBytes: file.size, mimeType: file.type, file };
}

describe('WebUI inbox IndexedDB', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await deleteDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await deleteDatabase();
  });

  it('creates the versioned Personal Core inbox stores', async () => {
    const database = await loadDatabase();

    await expect(schemaInfo()).resolves.toEqual({
      version: 7,
      stores: [
        'collaborationDeliveries',
        'collaborationInviteCodes',
        'collaborationMembers',
        'collaborationMessages',
        'conversionOperations',
        'inboxAssetOrigins',
        'inboxAssets',
        'inboxItems',
        'knowledgeSources',
        'managedSkills',
        'memoryCandidates',
        'memoryItems',
        'noteRevisions',
        'notes',
        'skillAudit',
        'skillCandidates',
        'skillVersions',
        'sourceLinks',
        'workflowApprovals',
        'workflowAudit',
        'workflowGrants',
        'workflowInstances',
        'workflowRuns',
        'workflowVersions',
      ],
    });

    database.close();
  });

  it('captures text and links and lists newest items first', async () => {
    const database = await loadDatabase();
    const text = await database.captureText({ text: '  Project brief\nNext step  ' });
    const link = await database.captureLink({ url: 'https://example.com/path' });

    await expect(database.list({ view: 'pending' })).resolves.toEqual({
      items: [expect.objectContaining({ id: link.id }), expect.objectContaining({ id: text.id })],
      nextCursor: null,
      total: 2,
    });
    await expect(database.get(link.id)).resolves.toEqual(
      expect.objectContaining({
        item: expect.objectContaining({ title: 'example.com', url: 'https://example.com/path' }),
        asset: null,
        origin: null,
      })
    );

    database.close();
  });

  it('deduplicates file bytes while retaining an origin and item per import', async () => {
    const database = await loadDatabase();

    const first = await database.importFiles({ files: [fileSource('first.txt', 'same bytes')] });
    const second = await database.importFiles({ files: [fileSource('second.txt', 'same bytes')] });

    expect(first.failed).toEqual([]);
    expect(first.imported[0]?.outcome).toBe('created');
    expect(second.failed).toEqual([]);
    expect(second.imported[0]?.outcome).toBe('reused');
    expect(second.imported[0]?.detail.asset?.id).toBe(first.imported[0]?.detail.asset?.id);
    expect(second.imported[0]?.detail.origin?.id).not.toBe(first.imported[0]?.detail.origin?.id);
    expect(second.imported[0]?.detail.origin?.originalName).toBe('second.txt');
    await expect(storedCounts()).resolves.toEqual({ assets: 1, origins: 2, items: 2 });

    database.close();
  });

  it('returns browser-safe image and text preview descriptors', async () => {
    vi.stubGlobal('Blob', NodeBlob);
    const createObjectURL = vi.fn(() => 'blob:inbox-preview');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    const database = await loadDatabase();
    try {
      const image = new NodeBlob(['image'], { type: 'image/png' }) as unknown as Blob;
      const text = new NodeBlob(['# Notes'], { type: 'text/markdown' }) as unknown as Blob;
      const imported = await database.importFiles({
        files: [
          { kind: 'blob', name: 'photo.png', sizeBytes: image.size, mimeType: image.type, file: image },
          { kind: 'blob', name: 'notes.md', sizeBytes: text.size, mimeType: text.type, file: text },
        ],
      });

      await expect(database.getPreview(imported.imported[0]!.detail.item.id)).resolves.toMatchObject({
        kind: 'image',
        displayName: 'photo.png',
        url: 'blob:inbox-preview',
        canDownload: true,
        canReveal: false,
      });
      await expect(database.getPreview(imported.imported[1]!.detail.item.id)).resolves.toMatchObject({
        kind: 'text',
        displayName: 'notes.md',
        text: '# Notes',
        truncated: false,
        canDownload: true,
      });
      expect(createObjectURL).toHaveBeenCalledTimes(2);
    } finally {
      database.close();
    }
  });

  it('validates the WebUI file limit before starting a transaction', async () => {
    const database = await loadDatabase();
    const oversized = {
      kind: 'blob' as const,
      name: 'oversized.bin',
      sizeBytes: 100 * 1024 * 1024 + 1,
      mimeType: 'application/octet-stream',
      file: new Blob(['small']),
    };

    await expect(database.importFiles({ files: [oversized] })).resolves.toEqual({
      imported: [],
      failed: [{ name: 'oversized.bin', code: 'INBOX_FILE_TOO_LARGE' }],
    });
    await expect(storedCounts()).resolves.toEqual({ assets: 0, origins: 0, items: 0 });

    database.close();
  });

  it('filters, searches file names, and supports archive, trash, and restore', async () => {
    const database = await loadDatabase();
    const text = await database.captureText({ text: 'Weekly notes' });
    const imported = await database.importFiles({ files: [fileSource('Roadmap.pdf', 'document')] });
    const file = imported.imported[0]!.detail.item;

    await expect(database.list({ view: 'pending', kinds: ['file'], search: 'roadmap' })).resolves.toEqual(
      expect.objectContaining({ items: [expect.objectContaining({ id: file.id })], total: 1 })
    );
    await database.archive([text.id]);
    await expect(database.list({ view: 'archived' })).resolves.toEqual(
      expect.objectContaining({ items: [expect.objectContaining({ id: text.id })] })
    );
    await database.remove([file.id]);
    await expect(database.list({ view: 'trash' })).resolves.toEqual(
      expect.objectContaining({ items: [expect.objectContaining({ id: file.id })] })
    );
    await database.restore([file.id]);
    await expect(database.list({ view: 'pending', kinds: ['file'] })).resolves.toEqual(
      expect.objectContaining({ items: [expect.objectContaining({ id: file.id })] })
    );

    database.close();
  });

  it('converts Inbox text to a linked note and Knowledge projection in one local transaction', async () => {
    const database = await loadDatabase();
    try {
      const source = await database.captureText({ title: 'Research note', text: 'Evidence from WebUI' });

      const created = await database.convertToNote({ sourceId: source.id, operationId: 'operation-note' });
      const retried = await database.convertToNote({ sourceId: source.id, operationId: 'operation-note' });
      const notes = await openNotesDatabase({ name: DATABASE_NAME });
      try {
        expect(retried).toMatchObject({ targetId: created.targetId, alreadyCompleted: true });
        await expect(notes.get(created.targetId)).resolves.toEqual(
          expect.objectContaining({
            note: expect.objectContaining({ title: 'Research note', body: 'Evidence from WebUI', revisionNumber: 1 }),
            sourceReferences: [expect.objectContaining({ sourceId: source.id })],
          })
        );
        await expect(notes.searchKnowledge({ query: 'evidence' })).resolves.toEqual(
          expect.objectContaining({
            hits: [expect.objectContaining({ source: expect.objectContaining({ sourceType: 'note' }) })],
          })
        );
        await expect(database.get(source.id)).resolves.toEqual(
          expect.objectContaining({ item: expect.objectContaining({ state: 'organized' }) })
        );
      } finally {
        notes.close();
      }
    } finally {
      database.close();
    }
  });

  it('adds Inbox links directly to Knowledge and returns the same source on retry', async () => {
    const database = await loadDatabase();
    try {
      const source = await database.captureLink({ title: 'Guide', url: 'https://example.com/guide' });

      const created = await database.convertToKnowledge({
        sourceId: source.id,
        operationId: 'operation-knowledge',
      });
      const retried = await database.convertToKnowledge({
        sourceId: source.id,
        operationId: 'operation-knowledge',
      });
      const notes = await openNotesDatabase({ name: DATABASE_NAME });
      try {
        expect(retried).toMatchObject({ targetId: created.targetId, alreadyCompleted: true });
        await expect(notes.searchKnowledge({ query: 'example' })).resolves.toEqual(
          expect.objectContaining({
            hits: [
              expect.objectContaining({
                source: expect.objectContaining({
                  id: created.targetId,
                  sourceType: 'inbox-item',
                  sourceId: source.id,
                }),
              }),
            ],
          })
        );
      } finally {
        notes.close();
      }
    } finally {
      database.close();
    }
  });

  it('rolls back every store when note conversion fails mid-transaction', async () => {
    const database = await loadDatabase();
    try {
      const source = await database.captureText({ title: 'Atomic', text: 'Keep pending' });
      const originalPut = IDBObjectStore.prototype.put;
      let writes = 0;
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (...args) {
        writes += 1;
        if (writes === 2) throw new DOMException('Quota exceeded', 'QuotaExceededError');
        return originalPut.apply(this, args as Parameters<IDBObjectStore['put']>);
      });

      await expect(
        database.convertToNote({ sourceId: source.id, operationId: 'operation-atomic' })
      ).rejects.toMatchObject({ name: 'QuotaExceededError' });
      vi.restoreAllMocks();
      const notes = await openNotesDatabase({ name: DATABASE_NAME });
      try {
        expect((await notes.list({ view: 'active' })).total).toBe(0);
        expect((await notes.searchKnowledge({ query: '' })).total).toBe(0);
        await expect(database.get(source.id)).resolves.toEqual(
          expect.objectContaining({ item: expect.objectContaining({ state: 'pending' }), sourceLinks: [] })
        );
      } finally {
        notes.close();
      }
    } finally {
      vi.restoreAllMocks();
      database.close();
    }
  });

  it('aborts the whole file import when a write fails mid-transaction', async () => {
    const database = await loadDatabase();
    const originalPut = IDBObjectStore.prototype.put;
    let writes = 0;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (...args) {
      writes += 1;
      if (writes === 2) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return originalPut.apply(this, args as Parameters<IDBObjectStore['put']>);
    });

    await expect(database.importFiles({ files: [fileSource('atomic.txt', 'atomic')] })).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
    vi.restoreAllMocks();
    await expect(storedCounts()).resolves.toEqual({ assets: 0, origins: 0, items: 0 });

    database.close();
  });
});
