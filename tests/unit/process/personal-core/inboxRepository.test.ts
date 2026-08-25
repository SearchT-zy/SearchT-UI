import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InboxAsset, InboxAssetOrigin, InboxItem, SourceLink } from '@/common/types/searcht/inbox';
import { InboxRepository } from '@process/services/personal-core/InboxRepository';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { TaskRepository } from '@process/services/personal-core/TaskRepository';

let directory: string;
let database: PersonalDatabase;
let repository: InboxRepository;

const item = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  id: 'item-1',
  kind: 'text',
  state: 'pending',
  title: 'Capture',
  textContent: 'Body',
  url: null,
  originId: null,
  capturedAt: 1,
  organizedAt: null,
  archivedAt: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  ...overrides,
});

const asset: InboxAsset = {
  id: 'asset-1',
  sha256: 'a'.repeat(64),
  managedName: 'a'.repeat(64),
  mimeType: 'text/plain',
  sizeBytes: 4,
  createdAt: 1,
};

const origin: InboxAssetOrigin = {
  id: 'origin-1',
  assetId: asset.id,
  originalName: 'source.txt',
  originalPath: 'C:\\source.txt',
  importedAt: 1,
};

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-inbox-repository-'));
  database = PersonalDatabase.open(directory);
  repository = new InboxRepository(database.driver);
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('InboxRepository', () => {
  it('stores a file item with the provenance for that import', () => {
    repository.insertAsset(asset);
    repository.insertOrigin(origin);
    repository.insertItem(
      item({ id: 'file-1', kind: 'file', title: 'source.txt', textContent: null, originId: origin.id })
    );

    expect(repository.getDetail('file-1')).toEqual({
      item: expect.objectContaining({ id: 'file-1', originId: 'origin-1' }),
      asset,
      origin,
      sourceLinks: [],
    });
    expect(repository.findAssetBySha256(asset.sha256)).toEqual(asset);
  });

  it('filters by state, trash, kind, and text or original filename search', () => {
    repository.insertItem(
      item({ id: 'newer-link', kind: 'link', title: 'Docs', textContent: null, url: 'https://x.test', capturedAt: 3 })
    );
    repository.insertItem(item({ id: 'organized', state: 'organized', organizedAt: 4, capturedAt: 2 }));
    repository.insertItem(item({ id: 'trash', deletedAt: 5, capturedAt: 1 }));
    repository.insertAsset(asset);
    repository.insertOrigin(origin);
    repository.insertItem(
      item({ id: 'file', kind: 'file', title: 'Attachment', textContent: null, originId: origin.id, capturedAt: 4 })
    );

    expect(
      repository.list({ view: 'pending', kinds: ['link'], search: 'x.test' }).items.map((value) => value.id)
    ).toEqual(['newer-link']);
    expect(repository.list({ view: 'organized' }).items.map((value) => value.id)).toEqual(['organized']);
    expect(repository.list({ view: 'trash' }).items.map((value) => value.id)).toEqual(['trash']);
    expect(repository.list({ view: 'pending', search: 'source.txt' }).items.map((value) => value.id)).toEqual(['file']);
  });

  it('uses a stable keyset cursor and reports the total before pagination', () => {
    repository.insertItem(item({ id: 'c', capturedAt: 3 }));
    repository.insertItem(item({ id: 'b', capturedAt: 2 }));
    repository.insertItem(item({ id: 'a', capturedAt: 1 }));

    const first = repository.list({ view: 'pending', limit: 2 });
    const second = repository.list({ view: 'pending', limit: 2, cursor: first.nextCursor });

    expect(first.items.map((value) => value.id)).toEqual(['c', 'b']);
    expect(first.total).toBe(3);
    expect(first.nextCursor).not.toBeNull();
    expect(second.items.map((value) => value.id)).toEqual(['a']);
    expect(second.nextCursor).toBeNull();
  });

  it('rejects an entire batch when any item is missing', () => {
    repository.insertItem(item({ id: 'one' }));

    expect(() => repository.archive(['one', 'missing'], 10)).toThrow('INBOX_ITEM_NOT_FOUND');
    expect(repository.getDetail('one')?.item).toMatchObject({ state: 'pending', archivedAt: null });
  });

  it('archives, deletes, restores, and permanently removes items without deleting targets', () => {
    repository.insertItem(item({ id: 'one' }));
    new TaskRepository(database.driver).insertTask({
      id: 'task-1',
      title: 'Created from Inbox',
      notes: '',
      priority: 'none',
      dueAt: null,
      dueLocalDate: null,
      estimatedMinutes: null,
      status: 'open',
      completedAt: null,
      seriesId: null,
      occurrenceKey: null,
      createdAt: 2,
      updatedAt: 2,
      deletedAt: null,
    });
    const link: SourceLink = {
      id: 'link-1',
      sourceType: 'inbox-item',
      sourceId: 'one',
      targetType: 'task',
      targetId: 'task-1',
      createdAt: 2,
    };
    repository.insertSourceLink(link);

    expect(repository.archive(['one'], 3).affectedIds).toEqual(['one']);
    expect(repository.remove(['one'], 4).affectedCount).toBe(1);
    expect(repository.restore(['one'], 5).affectedIds).toEqual(['one']);
    expect(repository.destroy(['one']).affectedCount).toBe(1);
    expect(repository.getDetail('one')).toBeNull();
    expect(database.driver.prepare("SELECT id FROM tasks WHERE id = 'task-1'").get()).toEqual({ id: 'task-1' });
  });

  it('returns unreferenced assets only after the final item and origin are destroyed', () => {
    repository.insertAsset(asset);
    repository.insertOrigin(origin);
    repository.insertItem(item({ id: 'file', kind: 'file', textContent: null, originId: origin.id }));

    expect(repository.listUnreferencedAssets()).toEqual([]);
    repository.destroy(['file']);
    expect(repository.listUnreferencedAssets()).toEqual([asset]);
  });

  it('stores source links and returns a bounded pending summary', () => {
    repository.insertItem(item({ id: 'old', capturedAt: 1 }));
    repository.insertItem(item({ id: 'new', capturedAt: 2 }));
    repository.insertItem(item({ id: 'organized', state: 'organized', organizedAt: 3, capturedAt: 3 }));

    expect(repository.getPendingSummary(1)).toEqual({ count: 2, items: [expect.objectContaining({ id: 'new' })] });
  });
});
