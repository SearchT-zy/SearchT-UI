import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { CollaborationRepository } from '@process/services/personal-core/content/collaboration/CollaborationRepository';

let directory: string;
let database: PersonalDatabase;
let repository: CollaborationRepository;
let uuidCounter: number;

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-collaboration-repository-'));
  database = PersonalDatabase.open(directory);
  uuidCounter = 0;
  repository = new CollaborationRepository(
    database.driver,
    () => 100,
    () => `generated-${++uuidCounter}`
  );
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('CollaborationRepository', () => {
  it('atomically creates an instruction and one pending delivery per target', () => {
    const snapshot = repository.createInstruction({
      messageId: 'message-1',
      teamId: 'team-1',
      content: 'Prepare the report',
      targetMode: 'members',
      targetSlotIds: ['codex', 'claude'],
      fileRefs: [{ kind: 'local', path: 'C:\\reports\\input.docx' }],
    });

    expect(snapshot.messages).toEqual([
      expect.objectContaining({ id: 'message-1', teamId: 'team-1', kind: 'instruction', createdAt: 100 }),
    ]);
    expect(snapshot.deliveries).toEqual([
      expect.objectContaining({ targetSlotId: 'codex', status: 'pending' }),
      expect.objectContaining({ targetSlotId: 'claude', status: 'pending' }),
    ]);
  });

  it('returns the original projected event when a runtime event is replayed', () => {
    const input = {
      teamId: 'team-1',
      sourceEventId: 'conversation-turn:conversation-1:turn-1',
      senderKind: 'agent' as const,
      senderSlotId: 'codex',
      kind: 'result' as const,
      content: 'Report ready',
      conversationId: 'conversation-1',
      createdAt: 50,
    };

    const first = repository.appendEvent(input);
    const replay = repository.appendEvent({ ...input, content: 'Duplicate content' });

    expect(replay).toEqual(first);
    expect(repository.list('team-1').messages).toHaveLength(1);
  });

  it('updates only deliveries bound to the matching team run', () => {
    repository.createInstruction({
      messageId: 'message-1',
      teamId: 'team-1',
      content: 'Check the data',
      targetMode: 'members',
      targetSlotIds: ['codex', 'claude'],
      fileRefs: [],
    });
    repository.updateDelivery({
      messageId: 'message-1',
      targetSlotId: 'codex',
      status: 'accepted',
      teamRunId: 'run-1',
    });

    const updated = repository.updateDeliveryByRun({ teamId: 'team-1', teamRunId: 'run-1', status: 'running' });

    expect(updated).toEqual([expect.objectContaining({ targetSlotId: 'codex', status: 'running' })]);
    expect(repository.list('team-1').deliveries).toEqual([
      expect.objectContaining({ targetSlotId: 'codex', status: 'running' }),
      expect.objectContaining({ targetSlotId: 'claude', status: 'pending' }),
    ]);
  });

  it('removes collaboration records for only the selected team', () => {
    for (const teamId of ['team-1', 'team-2']) {
      repository.createInstruction({
        messageId: `message-${teamId}`,
        teamId,
        content: teamId,
        targetMode: 'coordinator',
        targetSlotIds: ['leader'],
        fileRefs: [],
      });
    }

    repository.removeTeam('team-1');

    expect(repository.list('team-1')).toEqual({ messages: [], deliveries: [] });
    expect(repository.list('team-2').messages).toHaveLength(1);
    expect(repository.list('team-2').deliveries).toHaveLength(1);
  });
});
