// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSkillLifecycleDatabase } from '@renderer/pages/settings/SkillsSettings/consolidation/skillLifecycleDb';

const DATABASE_NAME = 'searcht-skill-lifecycle-test';

function options() {
  let sequence = 0;
  let now = 100;
  return {
    name: DATABASE_NAME,
    now: () => ++now,
    randomUUID: () => `skill-id-${++sequence}`,
    hashContent: (content: string) => `hash-${content.length}`,
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

function createVersion3Database(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 3);
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
        'memoryCandidates',
        'memoryItems',
      ]) {
        database.createObjectStore(name, { keyPath: 'id' });
      }
      request.transaction!.objectStore('inboxItems').put({ id: 'inbox-1', title: 'Inbox row' });
      request.transaction!.objectStore('notes').put({ id: 'note-1', title: 'Note row' });
      request.transaction!.objectStore('knowledgeSources').put({ id: 'knowledge-1', title: 'Knowledge row' });
      request.transaction!.objectStore('memoryItems').put({ id: 'memory-1', content: 'Memory row' });
    });
    request.addEventListener('success', () => {
      request.result.close();
      resolve();
    });
    request.addEventListener('error', () => reject(request.error));
  });
}

const skillContent = (body: string) => `---
name: weekly-report
description: Create a weekly report
---

# Weekly report

${body}`;

const submission = (operationId: string, body = 'Summarize completed work.') => ({
  operationId,
  proposedName: 'Weekly Report',
  description: 'Create a weekly report',
  content: skillContent(body),
  requiredTools: ['search'],
  permissions: ['read workspace'],
  reason: 'Repeated work',
  sourceReferences: [{ kind: 'conversation' as const, id: `conversation-${operationId}` }],
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await deleteDatabase();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await deleteDatabase();
});

describe('WebUI skill lifecycle database', () => {
  it('upgrades v3 to the current schema without losing Inbox, note, Knowledge, or memory rows', async () => {
    await createVersion3Database();
    const lifecycle = await openSkillLifecycleDatabase(options());
    lifecycle.close();

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME);
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
    });
    const transaction = database.transaction(['inboxItems', 'notes', 'knowledgeSources', 'memoryItems'], 'readonly');
    const rows = await Promise.all(
      [
        ['inboxItems', 'inbox-1'],
        ['notes', 'note-1'],
        ['knowledgeSources', 'knowledge-1'],
        ['memoryItems', 'memory-1'],
      ].map(
        ([store, id]) =>
          new Promise<Record<string, string>>((resolve, reject) => {
            const request = transaction.objectStore(store).get(id);
            request.addEventListener('success', () => resolve(request.result), { once: true });
            request.addEventListener('error', () => reject(request.error), { once: true });
          })
      )
    );

    expect(database.version).toBe(7);
    expect(Array.from(database.objectStoreNames)).toEqual([
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
    ]);
    expect(rows.map((row) => row.title ?? row.content)).toEqual([
      'Inbox row',
      'Note row',
      'Knowledge row',
      'Memory row',
    ]);
    database.close();
  });

  it('keeps sources, publishes immutable versions, and rolls back by appending history', async () => {
    const lifecycle = await openSkillLifecycleDatabase(options());
    const first = await lifecycle.submitCandidate(submission('operation-1'));
    await expect(lifecycle.submitCandidate({ ...submission('operation-1'), reason: 'Retry' })).resolves.toEqual(first);

    const published = await lifecycle.publishCandidate({
      candidateId: first.id,
      installedSlug: 'weekly-report',
      content: first.content,
      changeSummary: 'Initial version',
    });
    expect(published.version.sourceReferences).toEqual(first.sourceReferences);

    const second = await lifecycle.submitCandidate(submission('operation-2', 'Include project risks.'));
    await lifecycle.publishCandidate({
      candidateId: second.id,
      installedSlug: 'weekly-report',
      content: second.content,
      changeSummary: 'Add project risks',
    });
    const rollback = await lifecycle.rollback({
      skillId: published.skill.id,
      versionId: published.version.id,
      installedSlug: 'weekly-report',
      changeSummary: 'Restore initial version',
    });

    expect(rollback.version.versionNumber).toBe(3);
    expect(rollback.version.content).toBe(first.content);
    expect((await lifecycle.listVersions(published.skill.id)).versions.map((version) => version.versionNumber)).toEqual(
      [3, 2, 1]
    );
    expect((await lifecycle.updateState({ skillId: published.skill.id, state: 'disabled' })).state).toBe('disabled');

    const rejected = await lifecycle.submitCandidate(submission('operation-3', 'Rejected content.'));
    await lifecycle.rejectCandidate(rejected.id);
    await expect(lifecycle.getCandidate(rejected.id)).resolves.toBeNull();
    lifecycle.close();
  });

  it('aborts publication atomically when a lifecycle write fails', async () => {
    const lifecycle = await openSkillLifecycleDatabase(options());
    const candidate = await lifecycle.submitCandidate(submission('operation-atomic'));
    const originalAdd = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (...args) {
      if (this.name === 'skillVersions') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return originalAdd.apply(this, args as Parameters<IDBObjectStore['add']>);
    });

    await expect(
      lifecycle.publishCandidate({
        candidateId: candidate.id,
        installedSlug: 'weekly-report',
        content: candidate.content,
        changeSummary: 'Initial version',
      })
    ).rejects.toMatchObject({ name: 'QuotaExceededError' });
    vi.restoreAllMocks();

    await expect(lifecycle.getCandidate(candidate.id)).resolves.toEqual(candidate);
    await expect(lifecycle.listManagedSkills()).resolves.toEqual({ skills: [], total: 0 });
    lifecycle.close();
  });
});
