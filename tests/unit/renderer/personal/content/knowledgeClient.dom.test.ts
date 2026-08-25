// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBrowserKnowledgeClient } from '@renderer/pages/knowledge/knowledgeClient';
import { openInboxDatabase } from '@renderer/pages/inbox/inboxDb';
import { openNotesDatabase } from '@renderer/pages/notes/notesDb';

const DATABASE_NAME = 'searcht-knowledge-client-test';

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.addEventListener('success', () => resolve(), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
    request.addEventListener('blocked', () => reject(new Error('TEST_DATABASE_DELETE_BLOCKED')), { once: true });
  });
}

async function removeKnowledgeProjection(noteId: string): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME);
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
  const transaction = database.transaction('knowledgeSources', 'readwrite');
  const store = transaction.objectStore('knowledgeSources');
  const sources = await new Promise<Array<{ id: string; sourceId: string }>>((resolve, reject) => {
    const request = store.getAll();
    request.addEventListener('success', () => resolve(request.result as Array<{ id: string; sourceId: string }>), {
      once: true,
    });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
  const projection = sources.find((source) => source.sourceId === noteId);
  if (projection) store.delete(projection.id);
  await new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
  });
  database.close();
}

beforeEach(deleteDatabase);
afterEach(deleteDatabase);

describe('WebUI knowledge client', () => {
  it('searches active note projections with deterministic ranking and snippets', async () => {
    let sequence = 0;
    const database = await openNotesDatabase({
      name: DATABASE_NAME,
      now: () => 100 + sequence,
      randomUUID: () => `id-${++sequence}`,
    });
    await database.create({ title: 'Release plan', body: 'Exact title result' });
    await database.create({ title: 'Release planning', body: 'Title token result' });
    await database.create({ title: 'Checklist', body: 'Body mentions release plan details' });
    const client = createBrowserKnowledgeClient(database);

    const result = await client.search({ query: 'release plan' });

    expect(result.hits.map((hit) => hit.source.title)).toEqual(['Release plan', 'Release planning', 'Checklist']);
    expect(result.hits[2]?.snippet).toContain('release plan');
    await expect(client.getStatus()).resolves.toMatchObject({ sourceCount: 3, noteCount: 3, inboxCount: 0 });
    database.close();
  });

  it('rebuilds missing note projections without changing primary notes', async () => {
    let sequence = 0;
    const database = await openNotesDatabase({
      name: DATABASE_NAME,
      now: () => 200 + sequence,
      randomUUID: () => `id-${++sequence}`,
    });
    const note = await database.create({ title: 'Local source', body: 'Rebuild this text' });
    await removeKnowledgeProjection(note.note.id);
    expect((await database.searchKnowledge({ query: 'rebuild' })).hits).toEqual([]);

    const result = await createBrowserKnowledgeClient(database).rebuild();

    expect(result).toMatchObject({ indexedCount: 1, failedCount: 0 });
    expect((await database.searchKnowledge({ query: 'rebuild' })).hits).toHaveLength(1);
    expect((await database.get(note.note.id))?.note.body).toBe('Rebuild this text');
    database.close();
  });

  it('removes an Inbox source and its provenance link atomically', async () => {
    let sequence = 0;
    const randomUUID = () => `id-${++sequence}`;
    const inbox = await openInboxDatabase({
      name: DATABASE_NAME,
      now: () => 300 + sequence,
      randomUUID,
    });
    const item = await inbox.captureText({ title: 'Captured source', text: 'Remove this source' });
    const conversion = await inbox.convertToKnowledge({ sourceId: item.id, operationId: 'operation-1' });
    const notes = await openNotesDatabase({
      name: DATABASE_NAME,
      now: () => 400 + sequence,
      randomUUID,
    });

    await createBrowserKnowledgeClient(notes).removeSource(conversion.targetId);

    expect((await notes.searchKnowledge({ query: 'remove' })).hits).toEqual([]);
    expect((await inbox.get(item.id))?.sourceLinks).toEqual([]);
    notes.close();
    inbox.close();
  });
});
