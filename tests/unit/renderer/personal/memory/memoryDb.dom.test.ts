// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPersonalWebDatabase } from '@renderer/pages/personal/personalDbSchema';
import { openMemoryDatabase } from '@renderer/pages/settings/memory/memoryDb';

const DATABASE_NAME = 'searcht-memory-test';

function options(now = 100) {
  let sequence = 0;
  return {
    name: DATABASE_NAME,
    now: () => now,
    randomUUID: () => `memory-id-${++sequence}`,
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

function createVersion2Database(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 2);
    request.addEventListener('upgradeneeded', () => {
      const database = request.result;
      for (const name of [
        'inboxAssets',
        'inboxAssetOrigins',
        'inboxItems',
        'sourceLinks',
        'conversionOperations',
        'notes',
        'noteRevisions',
        'knowledgeSources',
      ]) {
        database.createObjectStore(name, { keyPath: 'id' });
      }
      request.transaction!.objectStore('inboxItems').put({ id: 'inbox-1', title: 'Inbox row' });
      request.transaction!.objectStore('notes').put({ id: 'note-1', title: 'Note row' });
      request.transaction!.objectStore('knowledgeSources').put({ id: 'knowledge-1', title: 'Knowledge row' });
    });
    request.addEventListener('success', () => {
      request.result.close();
      resolve();
    });
    request.addEventListener('error', () => reject(request.error));
  });
}

async function inspectUpgrade() {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME);
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
  const transaction = database.transaction(['inboxItems', 'notes', 'knowledgeSources'], 'readonly');
  const get = <T>(store: string, id: string) =>
    new Promise<T>((resolve, reject) => {
      const request = transaction.objectStore(store).get(id);
      request.addEventListener('success', () => resolve(request.result as T), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
    });
  const rows = await Promise.all([
    get<{ title: string }>('inboxItems', 'inbox-1'),
    get<{ title: string }>('notes', 'note-1'),
    get<{ title: string }>('knowledgeSources', 'knowledge-1'),
  ]);
  const result = {
    version: database.version,
    stores: Array.from(database.objectStoreNames),
    titles: rows.map((row) => row.title),
  };
  database.close();
  return result;
}

const submission = {
  operationId: 'operation-1',
  content: ' Prefers concise weekly summaries ',
  memoryType: 'preference' as const,
  proposedScope: { kind: 'workspace' as const, id: ' workspace-1 ' },
  sensitivity: 'normal' as const,
  confidence: 0.9,
  reason: ' Repeated request ',
  sourceReferences: [{ kind: 'conversation-message' as const, id: 'message-1' }],
  suggestedExpiresAt: null,
};

beforeEach(async () => {
  vi.restoreAllMocks();
  await deleteDatabase();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await deleteDatabase();
});

describe('WebUI memory database', () => {
  it('releases an open connection when another tab requests a schema upgrade', async () => {
    const database = await openPersonalWebDatabase(indexedDB, DATABASE_NAME);
    let wasBlocked = false;
    const upgradedDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, database.version + 1);
      request.addEventListener(
        'blocked',
        () => {
          wasBlocked = true;
          database.close();
        },
        { once: true }
      );
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
    });

    upgradedDatabase.close();
    expect(wasBlocked).toBe(false);
  });

  it('closes a late database result after a blocked open has already failed', async () => {
    const request = new EventTarget() as IDBOpenDBRequest;
    const close = vi.fn();
    const database = Object.assign(new EventTarget(), { close });
    Object.defineProperties(request, {
      error: { value: null },
      result: { value: database },
      transaction: { value: null },
    });
    const factory = { open: vi.fn(() => request) } as unknown as IDBFactory;
    const opening = openPersonalWebDatabase(factory, DATABASE_NAME);

    request.dispatchEvent(new Event('blocked'));
    await expect(opening).rejects.toThrow('PERSONAL_DATABASE_OPEN_BLOCKED');
    request.dispatchEvent(new Event('success'));

    expect(close).toHaveBeenCalledOnce();
  });

  it('upgrades v2 to the current schema without losing Inbox, note, or Knowledge rows', async () => {
    await createVersion2Database();
    const database = await openMemoryDatabase(options());
    database.close();

    await expect(inspectUpgrade()).resolves.toEqual({
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
      titles: ['Inbox row', 'Note row', 'Knowledge row'],
    });
  });

  it('submits candidates idempotently and confirms edited content atomically', async () => {
    const database = await openMemoryDatabase(options());
    const first = await database.submitCandidate(submission);
    const retried = await database.submitCandidate({ ...submission, content: 'Duplicate retry' });
    expect(retried).toEqual(first);

    const confirmed = await database.confirmCandidate({
      candidateId: first.id,
      content: 'Prefers concise product summaries',
      memoryType: first.memoryType,
      scope: { kind: 'project', id: 'project-1' },
      sensitivity: first.sensitivity,
      confidence: 1,
      reason: 'Confirmed by user',
      expiresAt: null,
      reviewAt: 1_000,
    });

    expect(confirmed).toMatchObject({
      content: 'Prefers concise product summaries',
      scope: { kind: 'project', id: 'project-1' },
    });
    await expect(database.listCandidates()).resolves.toEqual({ candidates: [], total: 0 });
    await expect(database.getMemory(confirmed.id)).resolves.toEqual(confirmed);
    database.close();
  });

  it('retrieves only active authorized memories and records retrieval time', async () => {
    const database = await openMemoryDatabase(options(100));
    const active = await database.createMemory({
      content: 'Workspace weekly summary preference',
      memoryType: 'preference',
      scope: { kind: 'workspace', id: 'workspace-1' },
      sensitivity: 'normal',
      confidence: 0.9,
      reason: 'User added',
      expiresAt: null,
      reviewAt: null,
    });
    await database.createMemory({
      ...active,
      id: undefined,
      content: 'Sensitive weekly context',
      sensitivity: 'sensitive',
    } as never);
    await database.createMemory({
      ...active,
      id: undefined,
      content: 'Expired weekly context',
      expiresAt: 99,
    } as never);
    await database.createMemory({
      ...active,
      id: undefined,
      content: 'Other weekly context',
      scope: { kind: 'workspace', id: 'workspace-2' },
    } as never);

    const result = await database.retrieve({
      query: 'weekly',
      scopes: [{ kind: 'workspace', id: 'workspace-1' }],
      includeSensitive: false,
      limit: 10,
    });

    expect(result.hits.map((hit) => hit.memory.id)).toEqual([active.id]);
    await expect(database.getMemory(active.id)).resolves.toMatchObject({ lastRetrievedAt: 100 });
    database.close();
  });

  it('reactivates expired memory and irreversibly forgets its content', async () => {
    const database = await openMemoryDatabase(options(100));
    const created = await database.createMemory({
      content: 'Temporary project context',
      memoryType: 'temporary-context',
      scope: { kind: 'global', id: null },
      sensitivity: 'normal',
      confidence: 0.8,
      reason: 'User added',
      expiresAt: 50,
      reviewAt: null,
    });
    expect((await database.listMemories({ view: 'expired' })).total).toBe(1);

    await database.updateMemory({ ...created, expiresAt: null });
    expect((await database.listMemories({ view: 'active' })).total).toBe(1);
    await database.forgetMemory(created.id);
    await expect(database.getMemory(created.id)).resolves.toBeNull();
    database.close();
  });

  it('rolls back candidate confirmation when a transaction write fails', async () => {
    const database = await openMemoryDatabase(options());
    const candidate = await database.submitCandidate(submission);
    const originalDelete = IDBObjectStore.prototype.delete;
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (...args) {
      if (this.name === 'memoryCandidates') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return originalDelete.apply(this, args as Parameters<IDBObjectStore['delete']>);
    });

    await expect(
      database.confirmCandidate({
        candidateId: candidate.id,
        content: candidate.content,
        memoryType: candidate.memoryType,
        scope: candidate.proposedScope,
        sensitivity: candidate.sensitivity,
        confidence: candidate.confidence,
        reason: candidate.reason,
        expiresAt: null,
        reviewAt: null,
      })
    ).rejects.toMatchObject({ name: 'QuotaExceededError' });
    vi.restoreAllMocks();
    expect((await database.listCandidates()).total).toBe(1);
    expect((await database.listMemories({ view: 'active' })).total).toBe(0);
    database.close();
  });
});
