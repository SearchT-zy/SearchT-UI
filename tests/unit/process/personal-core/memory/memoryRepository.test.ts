import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MemoryCandidate, MemoryItem } from '@/common/types/searcht/memory';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { MemoryRepository } from '@process/services/personal-core/memory/MemoryRepository';

const directories: string[] = [];

function openRepository(): { database: PersonalDatabase; repository: MemoryRepository } {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-memory-repository-'));
  directories.push(directory);
  const database = PersonalDatabase.open(directory);
  return { database, repository: new MemoryRepository(database.driver) };
}

const candidate: MemoryCandidate = {
  id: 'candidate-1',
  operationId: 'operation-1',
  content: 'Prefers concise weekly summaries',
  memoryType: 'preference',
  proposedScope: { kind: 'workspace', id: 'workspace-1' },
  sensitivity: 'normal',
  confidence: 0.9,
  reason: 'Repeated request',
  sourceReferences: [{ kind: 'conversation-message', id: 'message-1' }],
  suggestedExpiresAt: null,
  createdAt: 10,
  updatedAt: 10,
};

const memory: MemoryItem = {
  id: 'memory-1',
  content: candidate.content,
  memoryType: candidate.memoryType,
  scope: candidate.proposedScope,
  sensitivity: candidate.sensitivity,
  confidence: candidate.confidence,
  reason: candidate.reason,
  sourceReferences: candidate.sourceReferences,
  confirmedAt: 20,
  expiresAt: null,
  reviewAt: null,
  lastRetrievedAt: null,
  createdAt: 20,
  updatedAt: 20,
};

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('MemoryRepository', () => {
  it('stores and lists candidates by recent update order', () => {
    const { database, repository } = openRepository();
    try {
      repository.insertCandidate(candidate);
      repository.insertCandidate({ ...candidate, id: 'candidate-2', operationId: 'operation-2', updatedAt: 30 });

      expect(repository.findCandidateByOperationId('operation-1')).toEqual(candidate);
      expect(repository.listCandidates(10).map((item) => item.id)).toEqual(['candidate-2', 'candidate-1']);
    } finally {
      database.close();
    }
  });

  it('keeps the full-text projection synchronized across insert, update, and delete', () => {
    const { database, repository } = openRepository();
    try {
      repository.insertMemory(memory);
      expect(repository.searchMemoryIds('weekly')).toEqual(['memory-1']);

      repository.updateMemory({ ...memory, content: 'Prefers monthly reviews', updatedAt: 30 });
      expect(repository.searchMemoryIds('weekly')).toEqual([]);
      expect(repository.searchMemoryIds('monthly')).toEqual(['memory-1']);

      repository.deleteMemory('memory-1');
      expect(repository.searchMemoryIds('monthly')).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('separates active and expired memory lists and filters by type and text', () => {
    const { database, repository } = openRepository();
    try {
      repository.insertMemory(memory);
      repository.insertMemory({
        ...memory,
        id: 'memory-expired',
        content: 'Temporary launch context',
        memoryType: 'temporary-context',
        expiresAt: 50,
        updatedAt: 40,
      });

      expect(repository.listMemories({ view: 'active', search: 'weekly', limit: 20, now: 100 }).memories).toEqual([
        memory,
      ]);
      expect(
        repository.listMemories({ view: 'expired', memoryTypes: ['temporary-context'], limit: 20, now: 100 }).memories
      ).toHaveLength(1);
    } finally {
      database.close();
    }
  });
});
