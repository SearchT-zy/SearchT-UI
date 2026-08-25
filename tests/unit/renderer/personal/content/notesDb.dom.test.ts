// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openNotesDatabase } from '@renderer/pages/notes/notesDb';

const DATABASE_NAME = 'searcht-notes-test';

function options() {
  let sequence = 0;
  return {
    name: DATABASE_NAME,
    now: () => 1_723_650_000_000 + sequence,
    randomUUID: () => `content-id-${++sequence}`,
  };
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.addEventListener('success', () => resolve(), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
    request.addEventListener('blocked', () => reject(new Error('TEST_DATABASE_DELETE_BLOCKED')), { once: true });
  });
}

function createVersion1Database(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.addEventListener(
      'upgradeneeded',
      () => {
        const database = request.result;
        database.createObjectStore('inboxAssets', { keyPath: 'id' });
        database.createObjectStore('inboxAssetOrigins', { keyPath: 'id' });
        const items = database.createObjectStore('inboxItems', { keyPath: 'id' });
        items.put({ id: 'legacy-inbox', title: 'Keep me' });
        database.createObjectStore('sourceLinks', { keyPath: 'id' });
        database.createObjectStore('conversionOperations', { keyPath: 'id' });
      },
      { once: true }
    );
    request.addEventListener(
      'success',
      () => {
        request.result.close();
        resolve();
      },
      { once: true }
    );
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}

async function inspectSchema(): Promise<{ version: number; stores: string[]; legacyTitle: string }> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME);
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
  const transaction = database.transaction('inboxItems', 'readonly');
  const legacy = await new Promise<{ title: string }>((resolve, reject) => {
    const request = transaction.objectStore('inboxItems').get('legacy-inbox');
    request.addEventListener('success', () => resolve(request.result as { title: string }), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
  const result = {
    version: database.version,
    stores: Array.from(database.objectStoreNames),
    legacyTitle: legacy.title,
  };
  database.close();
  return result;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await deleteDatabase();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await deleteDatabase();
});

describe('WebUI notes database', () => {
  it('upgrades an Inbox v1 database to the current schema without losing existing rows', async () => {
    await createVersion1Database();
    const database = await openNotesDatabase(options());
    database.close();

    await expect(inspectSchema()).resolves.toEqual({
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
      legacyTitle: 'Keep me',
    });
  });

  it('creates, updates, and restores immutable note revisions', async () => {
    const database = await openNotesDatabase(options());
    const created = await database.create({ title: ' Plan ', body: 'First' });
    const changed = await database.update({ id: created.note.id, title: 'Plan', body: 'Second' });
    const unchanged = await database.update({ id: created.note.id, title: ' Plan ', body: 'Second' });
    const revisions = await database.listRevisions({ noteId: created.note.id });
    const oldest = revisions.revisions.at(-1)!;
    const restored = await database.restoreRevision({ noteId: created.note.id, revisionId: oldest.id });

    expect(changed.note.revisionNumber).toBe(2);
    expect(unchanged.note.revisionNumber).toBe(2);
    expect(revisions.revisions.map((revision) => revision.revisionNumber)).toEqual([2, 1]);
    expect(restored.note).toMatchObject({ title: 'Plan', body: 'First', revisionNumber: 3 });
    database.close();
  });

  it('keeps archive and recoverable trash separate and destroys only trashed notes', async () => {
    const database = await openNotesDatabase(options());
    const active = await database.create({ title: 'Active' });
    const archived = await database.create({ title: 'Archived' });
    const trash = await database.create({ title: 'Trash' });

    await database.archive([archived.note.id]);
    await database.remove([trash.note.id]);
    expect((await database.list({ view: 'active' })).notes.map((note) => note.id)).toEqual([active.note.id]);
    expect((await database.list({ view: 'archived' })).notes.map((note) => note.id)).toEqual([archived.note.id]);
    expect((await database.list({ view: 'trash' })).notes.map((note) => note.id)).toEqual([trash.note.id]);
    await expect(database.destroy([active.note.id])).rejects.toThrow('NOTE_NOT_IN_TRASH');
    await database.restore([trash.note.id]);
    expect((await database.list({ view: 'active' })).notes.map((note) => note.title)).toEqual(['Trash', 'Active']);
    database.close();
  });

  it('keeps note, revision, and Knowledge projection atomic when a write fails', async () => {
    const database = await openNotesDatabase(options());
    const originalPut = IDBObjectStore.prototype.put;
    let writes = 0;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (...args) {
      writes += 1;
      if (writes === 2) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return originalPut.apply(this, args as Parameters<IDBObjectStore['put']>);
    });

    await expect(database.create({ title: 'Atomic', body: 'Body' })).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
    vi.restoreAllMocks();
    expect((await database.list({ view: 'active' })).total).toBe(0);
    expect((await database.searchKnowledge({ query: '' })).total).toBe(0);
    database.close();
  });
});
