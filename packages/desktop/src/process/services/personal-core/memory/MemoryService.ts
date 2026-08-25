import type {
  MemoryCandidate,
  MemoryCandidateConfirmInput,
  MemoryCandidateListQuery,
  MemoryCandidateListResult,
  MemoryCandidateSubmitInput,
  MemoryCreateInput,
  MemoryExport,
  MemoryItem,
  MemoryListQuery,
  MemoryListResult,
  MemoryRetrieveInput,
  MemoryRetrieveResult,
  MemoryStatus,
  MemoryUpdateInput,
} from '@/common/types/searcht/memory';
import { rankMemoriesForRetrieval } from '@/common/searcht/memorySearch';
import {
  normalizeMemoryCandidateInput,
  normalizeMemoryConfidence,
  normalizeMemoryContent,
  normalizeMemoryId,
  normalizeMemoryListLimit,
  normalizeMemoryReason,
  normalizeMemoryScope,
  normalizeMemorySensitivity,
  normalizeMemorySources,
  normalizeMemoryTimestamp,
  normalizeMemoryType,
} from '@/common/searcht/memoryValidation';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import { MemoryRepository } from './MemoryRepository';

export type MemoryServiceOptions = {
  now?: () => number;
  randomUUID?: () => string;
};

export class MemoryService {
  private readonly repository: MemoryRepository;
  private readonly now: () => number;
  private readonly randomUUID: () => string;

  constructor(driver: ISqliteDriver, options: MemoryServiceOptions = {}) {
    this.repository = new MemoryRepository(driver);
    this.now = options.now ?? Date.now;
    this.randomUUID = options.randomUUID ?? crypto.randomUUID;
  }

  listCandidates(query: MemoryCandidateListQuery = {}): MemoryCandidateListResult {
    const limit = normalizeMemoryListLimit(query.limit);
    return { candidates: this.repository.listCandidates(limit), total: this.repository.countCandidates() };
  }

  submitCandidate(input: MemoryCandidateSubmitInput): MemoryCandidate {
    const normalized = normalizeMemoryCandidateInput(input);
    return this.repository.transaction(() => {
      const existing = this.repository.findCandidateByOperationId(normalized.operationId);
      if (existing) return existing;
      const now = this.now();
      const candidate = this.repository.insertCandidate({
        id: this.randomUUID(),
        ...normalized,
        createdAt: now,
        updatedAt: now,
      });
      this.repository.insertAudit(
        this.randomUUID(),
        'memory_candidate_submit',
        { candidateId: candidate.id, operationId: candidate.operationId },
        now
      );
      return candidate;
    });
  }

  confirmCandidate(input: MemoryCandidateConfirmInput): MemoryItem {
    const candidateId = normalizeMemoryId(input.candidateId);
    return this.repository.transaction(() => {
      const candidate = this.repository.findCandidateById(candidateId);
      if (!candidate) throw new Error('MEMORY_CANDIDATE_NOT_FOUND');
      const now = this.now();
      const memory = this.repository.insertMemory({
        id: this.randomUUID(),
        content: normalizeMemoryContent(input.content),
        memoryType: normalizeMemoryType(input.memoryType),
        scope: normalizeMemoryScope(input.scope),
        sensitivity: normalizeMemorySensitivity(input.sensitivity),
        confidence: normalizeMemoryConfidence(input.confidence),
        reason: normalizeMemoryReason(input.reason),
        sourceReferences: candidate.sourceReferences,
        confirmedAt: now,
        expiresAt: normalizeMemoryTimestamp(input.expiresAt, 'MEMORY_EXPIRY_INVALID'),
        reviewAt: normalizeMemoryTimestamp(input.reviewAt, 'MEMORY_REVIEW_AT_INVALID'),
        lastRetrievedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      this.repository.deleteCandidate(candidate.id);
      this.repository.insertAudit(
        this.randomUUID(),
        'memory_candidate_confirm',
        { candidateId: candidate.id, memoryId: memory.id },
        now
      );
      return memory;
    });
  }

  rejectCandidate(id: string): void {
    const candidateId = normalizeMemoryId(id);
    this.repository.transaction(() => {
      if (!this.repository.findCandidateById(candidateId)) throw new Error('MEMORY_CANDIDATE_NOT_FOUND');
      this.repository.deleteCandidate(candidateId);
      this.repository.insertAudit(this.randomUUID(), 'memory_candidate_reject', { candidateId }, this.now());
    });
  }

  listMemories(query: MemoryListQuery): MemoryListResult {
    return this.repository.listMemories({ ...query, now: query.now ?? this.now() });
  }

  getMemory(id: string): MemoryItem | null {
    return this.repository.findMemoryById(normalizeMemoryId(id));
  }

  createMemory(input: MemoryCreateInput): MemoryItem {
    const now = this.now();
    const id = this.randomUUID();
    const sourceReferences = input.sourceReferences?.length
      ? normalizeMemorySources(input.sourceReferences)
      : [{ kind: 'manual' as const, id }];
    return this.repository.transaction(() => {
      const memory = this.repository.insertMemory(this.buildMemory(id, input, sourceReferences, now));
      this.repository.insertAudit(this.randomUUID(), 'memory_create', { memoryId: memory.id }, now);
      return memory;
    });
  }

  updateMemory(input: MemoryUpdateInput): MemoryItem {
    const id = normalizeMemoryId(input.id);
    return this.repository.transaction(() => {
      const current = this.repository.findMemoryById(id);
      if (!current) throw new Error('MEMORY_NOT_FOUND');
      const now = this.now();
      const updated = this.repository.updateMemory({
        ...this.buildMemory(id, input, normalizeMemorySources(input.sourceReferences), now),
        confirmedAt: current.confirmedAt,
        lastRetrievedAt: current.lastRetrievedAt,
        createdAt: current.createdAt,
      });
      this.repository.insertAudit(this.randomUUID(), 'memory_update', { memoryId: id }, now);
      return updated;
    });
  }

  forgetMemory(id: string): void {
    const memoryId = normalizeMemoryId(id);
    this.repository.transaction(() => {
      if (!this.repository.findMemoryById(memoryId)) throw new Error('MEMORY_NOT_FOUND');
      this.repository.deleteMemory(memoryId);
      this.repository.insertAudit(this.randomUUID(), 'memory_forget', { memoryId }, this.now());
    });
  }

  retrieve(input: MemoryRetrieveInput): MemoryRetrieveResult {
    const now = this.now();
    const scopes = input.scopes.map(normalizeMemoryScope);
    const candidates = this.repository.findRetrievalCandidates(input.query, scopes, input.includeSensitive, now);
    const hits = rankMemoriesForRetrieval(candidates, {
      ...input,
      scopes,
      limit: normalizeMemoryListLimit(input.limit),
      now,
    });
    this.repository.touchRetrieved(
      hits.map((hit) => hit.memory.id),
      now
    );
    const updatedHits: MemoryRetrieveResult['hits'] = [];
    for (const hit of hits) {
      updatedHits.push({
        score: hit.score,
        memory: { ...hit.memory, lastRetrievedAt: now },
      });
    }
    return { hits: updatedHits };
  }

  getStatus(): MemoryStatus {
    return this.repository.getStatus(this.now());
  }

  exportMemories(): MemoryExport {
    return { exportedAt: this.now(), memories: this.repository.listAllMemories() };
  }

  private buildMemory(
    id: string,
    input: MemoryCreateInput,
    sourceReferences: MemoryItem['sourceReferences'],
    now: number
  ): MemoryItem {
    return {
      id,
      content: normalizeMemoryContent(input.content),
      memoryType: normalizeMemoryType(input.memoryType),
      scope: normalizeMemoryScope(input.scope),
      sensitivity: normalizeMemorySensitivity(input.sensitivity),
      confidence: normalizeMemoryConfidence(input.confidence),
      reason: normalizeMemoryReason(input.reason),
      sourceReferences,
      confirmedAt: now,
      expiresAt: normalizeMemoryTimestamp(input.expiresAt, 'MEMORY_EXPIRY_INVALID'),
      reviewAt: normalizeMemoryTimestamp(input.reviewAt, 'MEMORY_REVIEW_AT_INVALID'),
      lastRetrievedAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }
}
