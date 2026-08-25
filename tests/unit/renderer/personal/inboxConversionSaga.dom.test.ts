// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';

import type { TaskCreateInput } from '@/common/types/searcht/tasks';
import { conversionTargetId } from '@/common/searcht/inboxValidation';
import { openInboxDatabase, type InboxDatabase } from '@renderer/pages/inbox/inboxDb';

const DAY = 24 * 60 * 60 * 1000;
let sequence = 0;
let openDatabase: InboxDatabase | undefined;
let databaseName = '';

type StoredTarget = { id: string; input: TaskCreateInput };

function targetAdapter() {
  const targets = new Map<string, StoredTarget>();
  let creates = 0;
  let failAfterCreate = false;
  let failRemove = false;
  return {
    targets,
    get creates() {
      return creates;
    },
    setFailAfterCreate(value: boolean) {
      failAfterCreate = value;
    },
    setFailRemove(value: boolean) {
      failRemove = value;
    },
    async get(id: string) {
      return targets.get(id) ?? null;
    },
    async create(input: TaskCreateInput, id: string) {
      creates += 1;
      const target = { id, input };
      targets.set(id, target);
      if (failAfterCreate) throw new Error('TARGET_WRITE_INTERRUPTED');
      return target;
    },
    async remove(id: string) {
      if (failRemove) throw new Error('TARGET_REMOVE_INTERRUPTED');
      targets.delete(id);
    },
  };
}

async function setup(now = 1_723_650_000_000) {
  databaseName = `searcht-saga-test-${++sequence}`;
  openDatabase = await openInboxDatabase({ name: databaseName, now: () => now });
  const item = await openDatabase.captureText({ text: 'Turn this into a task' });
  const adapter = targetAdapter();
  const { createInboxConversionSaga } = await import('@renderer/pages/inbox/inboxConversionSaga');
  const saga = createInboxConversionSaga({
    database: openDatabase,
    taskAdapter: adapter,
    eventAdapter: adapter,
    now: () => now,
  });
  return { database: openDatabase, item, adapter, saga };
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.addEventListener('success', () => resolve(), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}

afterEach(async () => {
  openDatabase?.close();
  openDatabase = undefined;
  if (databaseName) await deleteDatabase(databaseName);
});

describe('WebUI inbox conversion saga', () => {
  it('recovers an operation interrupted after prepare', async () => {
    const { database, item, adapter, saga } = await setup();
    await database.prepareConversion({
      sourceId: item.id,
      operationId: 'operation-1',
      targetType: 'task',
      target: { title: 'Follow up' },
    });

    await saga.reconcile();

    const targetId = conversionTargetId('operation-1', 'task');
    expect(adapter.targets.has(targetId)).toBe(true);
    await expect(database.get(item.id)).resolves.toEqual(
      expect.objectContaining({
        item: expect.objectContaining({ state: 'organized' }),
        sourceLinks: [expect.objectContaining({ targetId, targetType: 'task' })],
      })
    );
    await expect(database.getConversionOperation('operation-1')).resolves.toEqual(
      expect.objectContaining({ status: 'completed' })
    );
  });

  it('commits an existing deterministic target without creating it twice', async () => {
    const { database, item, adapter, saga } = await setup();
    const operation = await database.prepareConversion({
      sourceId: item.id,
      operationId: 'operation-2',
      targetType: 'task',
      target: { title: 'Existing target' },
    });
    await adapter.create(operation.target, operation.targetId);

    await saga.reconcile();

    expect(adapter.creates).toBe(1);
    await expect(database.getConversionOperation(operation.id)).resolves.toEqual(
      expect.objectContaining({ status: 'completed' })
    );
  });

  it('returns the completed result on duplicate conversion retry', async () => {
    const { item, adapter, saga } = await setup();
    const input = { sourceId: item.id, operationId: 'operation-3', target: { title: 'Only once' } };

    const first = await saga.convertToTask(input);
    const second = await saga.convertToTask(input);

    expect(first.alreadyCompleted).toBe(false);
    expect(second.alreadyCompleted).toBe(true);
    expect(second.targetId).toBe(first.targetId);
    expect(adapter.creates).toBe(1);
  });

  it('keeps compensation durable when target removal is interrupted', async () => {
    const { database, item, adapter, saga } = await setup();
    adapter.setFailAfterCreate(true);
    adapter.setFailRemove(true);

    await expect(
      saga.convertToTask({ sourceId: item.id, operationId: 'operation-4', target: { title: 'Compensate' } })
    ).rejects.toThrow('TARGET_REMOVE_INTERRUPTED');
    await expect(database.getConversionOperation('operation-4')).resolves.toEqual(
      expect.objectContaining({ status: 'compensating' })
    );

    adapter.setFailAfterCreate(false);
    adapter.setFailRemove(false);
    await saga.reconcile();

    expect(adapter.targets.size).toBe(0);
    await expect(database.getConversionOperation('operation-4')).resolves.toBeNull();
    await expect(database.get(item.id)).resolves.toEqual(
      expect.objectContaining({ item: expect.objectContaining({ state: 'pending', organizedAt: null }) })
    );
  });

  it('prunes completed operations after thirty days without deleting provenance', async () => {
    const oldNow = 1_700_000_000_000;
    const { database, item, adapter } = await setup(oldNow);
    const { createInboxConversionSaga } = await import('@renderer/pages/inbox/inboxConversionSaga');
    const oldSaga = createInboxConversionSaga({
      database,
      taskAdapter: adapter,
      eventAdapter: adapter,
      now: () => oldNow,
    });
    await oldSaga.convertToTask({ sourceId: item.id, operationId: 'operation-5', target: { title: 'Retained link' } });
    const futureSaga = createInboxConversionSaga({
      database,
      taskAdapter: adapter,
      eventAdapter: adapter,
      now: () => oldNow + 31 * DAY,
    });

    await futureSaga.reconcile();

    await expect(database.getConversionOperation('operation-5')).resolves.toBeNull();
    await expect(database.get(item.id)).resolves.toEqual(
      expect.objectContaining({ sourceLinks: [expect.objectContaining({ targetType: 'task' })] })
    );
  });
});
