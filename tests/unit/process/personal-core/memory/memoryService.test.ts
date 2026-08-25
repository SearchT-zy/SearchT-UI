import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MemoryCandidateSubmitInput } from '@/common/types/searcht/memory';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { MemoryService } from '@process/services/personal-core/memory/MemoryService';

const directories: string[] = [];

function openService(now = 100): { database: PersonalDatabase; service: MemoryService } {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-memory-service-'));
  directories.push(directory);
  const database = PersonalDatabase.open(directory);
  let nextId = 0;
  return {
    database,
    service: new MemoryService(database.driver, {
      now: () => now,
      randomUUID: () => `generated-${++nextId}`,
    }),
  };
}

const submission: MemoryCandidateSubmitInput = {
  operationId: 'operation-1',
  content: ' Prefers concise weekly summaries ',
  memoryType: 'preference',
  proposedScope: { kind: 'workspace', id: ' workspace-1 ' },
  sensitivity: 'normal',
  confidence: 0.9,
  reason: ' Repeated request ',
  sourceReferences: [{ kind: 'conversation-message', id: 'message-1' }],
  suggestedExpiresAt: null,
};

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('MemoryService', () => {
  it('submits candidates idempotently and confirms an edited candidate atomically', () => {
    const { database, service } = openService();
    try {
      const first = service.submitCandidate(submission);
      const retried = service.submitCandidate({ ...submission, content: 'A duplicate retry' });
      expect(retried).toEqual(first);

      const confirmed = service.confirmCandidate({
        candidateId: first.id,
        content: 'Prefers concise product summaries',
        memoryType: 'preference',
        scope: { kind: 'project', id: 'project-1' },
        sensitivity: 'normal',
        confidence: 1,
        reason: 'Confirmed by the user',
        expiresAt: null,
        reviewAt: 1_000,
      });

      expect(confirmed.scope).toEqual({ kind: 'project', id: 'project-1' });
      expect(service.listCandidates().total).toBe(0);
      expect(service.getMemory(confirmed.id)).toEqual(confirmed);
      const audit = database.driver
        .prepare('SELECT detail_json FROM personal_audit_log ORDER BY created_at, id')
        .all() as Array<{
        detail_json: string;
      }>;
      expect(audit.map((row) => row.detail_json).join(' ')).not.toContain('Prefers concise');
    } finally {
      database.close();
    }
  });

  it('retrieves only active authorized memories and records retrieval time', () => {
    const { database, service } = openService(100);
    try {
      service.createMemory({
        content: 'Workspace weekly summary preference',
        memoryType: 'preference',
        scope: { kind: 'workspace', id: 'workspace-1' },
        sensitivity: 'normal',
        confidence: 0.9,
        reason: 'User added',
        expiresAt: null,
        reviewAt: null,
      });
      service.createMemory({
        content: 'Sensitive weekly financial context',
        memoryType: 'project-context',
        scope: { kind: 'workspace', id: 'workspace-1' },
        sensitivity: 'sensitive',
        confidence: 1,
        reason: 'User added',
        expiresAt: null,
        reviewAt: null,
      });
      service.createMemory({
        content: 'Expired weekly launch context',
        memoryType: 'temporary-context',
        scope: { kind: 'workspace', id: 'workspace-1' },
        sensitivity: 'normal',
        confidence: 1,
        reason: 'User added',
        expiresAt: 99,
        reviewAt: null,
      });
      service.createMemory({
        content: 'Other workspace weekly context',
        memoryType: 'project-context',
        scope: { kind: 'workspace', id: 'workspace-2' },
        sensitivity: 'normal',
        confidence: 1,
        reason: 'User added',
        expiresAt: null,
        reviewAt: null,
      });

      const result = service.retrieve({
        query: 'weekly',
        scopes: [{ kind: 'workspace', id: 'workspace-1' }],
        includeSensitive: false,
        limit: 10,
      });

      expect(result.hits).toHaveLength(1);
      expect(result.hits[0]?.memory.content).toBe('Workspace weekly summary preference');
      expect(service.getMemory(result.hits[0]!.memory.id)?.lastRetrievedAt).toBe(100);
    } finally {
      database.close();
    }
  });

  it('can reactivate an expired memory and irreversibly forget its content', () => {
    const { database, service } = openService(100);
    try {
      const created = service.createMemory({
        content: 'Temporary context to reactivate',
        memoryType: 'temporary-context',
        scope: { kind: 'global', id: null },
        sensitivity: 'normal',
        confidence: 0.8,
        reason: 'User added',
        expiresAt: 50,
        reviewAt: null,
      });
      expect(service.listMemories({ view: 'expired' }).total).toBe(1);

      service.updateMemory({
        id: created.id,
        content: created.content,
        memoryType: created.memoryType,
        scope: created.scope,
        sensitivity: created.sensitivity,
        confidence: created.confidence,
        reason: created.reason,
        sourceReferences: created.sourceReferences,
        expiresAt: null,
        reviewAt: null,
      });
      expect(service.listMemories({ view: 'active' }).total).toBe(1);

      service.forgetMemory(created.id);
      expect(service.getMemory(created.id)).toBeNull();
      const auditText = JSON.stringify(database.driver.prepare('SELECT * FROM personal_audit_log').all());
      expect(auditText).not.toContain('Temporary context to reactivate');
    } finally {
      database.close();
    }
  });

  it('rejects and deletes a pending candidate without retaining its content', () => {
    const { database, service } = openService();
    try {
      const created = service.submitCandidate(submission);
      service.rejectCandidate(created.id);

      expect(service.listCandidates().total).toBe(0);
      expect(JSON.stringify(database.driver.prepare('SELECT * FROM personal_audit_log').all())).not.toContain(
        'Prefers concise weekly summaries'
      );
      expect(() =>
        service.confirmCandidate({
          candidateId: created.id,
          content: created.content,
          memoryType: created.memoryType,
          scope: created.proposedScope,
          sensitivity: created.sensitivity,
          confidence: created.confidence,
          reason: created.reason,
          expiresAt: null,
          reviewAt: null,
        })
      ).toThrow('MEMORY_CANDIDATE_NOT_FOUND');
    } finally {
      database.close();
    }
  });
});
