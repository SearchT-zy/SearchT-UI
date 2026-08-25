// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CollaborationAppendEventInput,
  CollaborationCreateInput,
  CollaborationSnapshot,
} from '@/common/types/searcht/collaboration';
import { createBrowserGroupClient, createElectronGroupClient } from '@renderer/pages/team/group/groupClient';
import { openGroupDatabase } from '@renderer/pages/team/group/groupDb';

const DATABASE_NAME = 'searcht-group-client-test';

const instruction: CollaborationCreateInput = {
  messageId: 'message-1',
  teamId: 'team-1',
  content: 'Prepare the report',
  targetMode: 'coordinator',
  targetSlotIds: ['leader'],
  fileRefs: [],
};

const event: CollaborationAppendEventInput = {
  teamId: 'team-1',
  sourceEventId: 'conversation-turn:conversation-1:turn-1',
  senderKind: 'agent',
  senderSlotId: 'leader',
  kind: 'result',
  content: 'Report ready',
  conversationId: 'conversation-1',
  createdAt: 2_000,
};

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.addEventListener('success', () => resolve(), { once: true });
    request.addEventListener('blocked', () => resolve(), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}

beforeEach(deleteDatabase);
afterEach(deleteDatabase);

describe('browser collaboration client', () => {
  it('persists an instruction and all target receipts atomically', async () => {
    let nextId = 0;
    const database = openGroupDatabase({
      factory: indexedDB,
      name: DATABASE_NAME,
      now: () => 1_000,
      randomUUID: () => `delivery-${++nextId}`,
    });
    const client = createBrowserGroupClient(database);

    const created = await client.createInstruction({
      ...instruction,
      targetMode: 'members',
      targetSlotIds: ['codex', 'hermes'],
    });

    expect(created.messages).toEqual([
      expect.objectContaining({ id: 'message-1', teamId: 'team-1', content: 'Prepare the report' }),
    ]);
    expect(created.deliveries).toEqual([
      expect.objectContaining({ targetSlotId: 'codex', status: 'pending' }),
      expect.objectContaining({ targetSlotId: 'hermes', status: 'pending' }),
    ]);
    (await database).close();
  });

  it('keeps instruction and runtime-event retries idempotent', async () => {
    let nextId = 0;
    const database = openGroupDatabase({
      factory: indexedDB,
      name: DATABASE_NAME,
      now: () => 1_000,
      randomUUID: () => `generated-${++nextId}`,
    });
    const client = createBrowserGroupClient(database);

    await client.createInstruction(instruction);
    await client.createInstruction(instruction);
    const first = await client.appendEvent(event);
    const second = await client.appendEvent(event);

    expect(second).toEqual(first);
    await expect(client.list('team-1')).resolves.toMatchObject({
      messages: [{ id: 'message-1' }, { id: first.id, sourceEventId: event.sourceEventId }],
      deliveries: [{ messageId: 'message-1', targetSlotId: 'leader' }],
    });
    (await database).close();
  });

  it('updates receipts by target and Team run, then removes the local group', async () => {
    const database = openGroupDatabase({ factory: indexedDB, name: DATABASE_NAME });
    const client = createBrowserGroupClient(database);
    await client.createInstruction(instruction);

    await expect(
      client.updateDelivery({
        messageId: 'message-1',
        targetSlotId: 'leader',
        teamRunId: 'run-1',
        status: 'accepted',
      })
    ).resolves.toMatchObject({ teamRunId: 'run-1', status: 'accepted', attemptCount: 1 });
    await expect(
      client.updateDeliveryByRun({ teamId: 'team-1', teamRunId: 'run-1', status: 'completed' })
    ).resolves.toEqual([expect.objectContaining({ status: 'completed' })]);
    await client.removeTeam('team-1');
    await expect(client.list('team-1')).resolves.toEqual({ messages: [], deliveries: [] });
    (await database).close();
  });

  it('rejects updates for an unknown receipt', async () => {
    const database = openGroupDatabase({ factory: indexedDB, name: DATABASE_NAME });
    const client = createBrowserGroupClient(database);

    await expect(
      client.updateDelivery({ messageId: 'missing', targetSlotId: 'leader', status: 'failed' })
    ).rejects.toThrow('COLLABORATION_DELIVERY_NOT_FOUND');
    (await database).close();
  });
});

describe('Electron collaboration client', () => {
  it('maps the renderer contract to narrow provider payloads', async () => {
    const empty: CollaborationSnapshot = { messages: [], deliveries: [] };
    const providers = {
      list: { invoke: vi.fn(async () => empty) },
      createInstruction: { invoke: vi.fn(async () => empty) },
      appendEvent: { invoke: vi.fn(async () => ({ id: 'event-message-1' })) },
      updateDelivery: { invoke: vi.fn(async () => ({ id: 'delivery-1' })) },
      updateDeliveryByRun: { invoke: vi.fn(async () => []) },
      removeTeam: { invoke: vi.fn(async () => undefined) },
    };
    const client = createElectronGroupClient(providers as never);

    await client.list('team-1', 25);
    await client.createInstruction(instruction);
    await client.appendEvent(event);
    await client.removeTeam('team-1');

    expect(providers.list.invoke).toHaveBeenCalledWith({ teamId: 'team-1', limit: 25 });
    expect(providers.createInstruction.invoke).toHaveBeenCalledWith(instruction);
    expect(providers.appendEvent.invoke).toHaveBeenCalledWith(event);
    expect(providers.removeTeam.invoke).toHaveBeenCalledWith({ teamId: 'team-1' });
  });
});
