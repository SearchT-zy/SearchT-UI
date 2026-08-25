import type {
  MemoryCandidate,
  MemoryCandidateConfirmInput,
  MemoryCandidateListQuery,
  MemoryCandidateListResult,
  MemoryCandidateSubmitInput,
  MemoryClient,
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
import {
  openPersonalWebDatabase,
  PERSONAL_WEB_DATABASE_NAME,
  PERSONAL_WEB_STORE_NAMES,
  requestResult,
  transactionDone,
} from '@renderer/pages/personal/personalDbSchema';

export type OpenMemoryDatabaseOptions = {
  name?: string;
  factory?: IDBFactory;
  now?: () => number;
  randomUUID?: () => string;
};

export class MemoryDatabase implements MemoryClient {
  constructor(
    private readonly database: IDBDatabase,
    private readonly now: () => number,
    private readonly randomUUID: () => string
  ) {}

  close(): void {
    this.database.close();
  }

  async listCandidates(query: MemoryCandidateListQuery = {}): Promise<MemoryCandidateListResult> {
    const candidates = await this.getAll<MemoryCandidate>(PERSONAL_WEB_STORE_NAMES.memoryCandidates);
    return {
      candidates: candidates
        .toSorted((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
        .slice(0, normalizeMemoryListLimit(query.limit)),
      total: candidates.length,
    };
  }

  async submitCandidate(input: MemoryCandidateSubmitInput): Promise<MemoryCandidate> {
    const normalized = normalizeMemoryCandidateInput(input);
    const transaction = this.database.transaction(PERSONAL_WEB_STORE_NAMES.memoryCandidates, 'readwrite');
    const done = transactionDone(transaction);
    try {
      const store = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.memoryCandidates);
      const existing = await requestResult<MemoryCandidate | undefined>(
        store.index('operationId').get(normalized.operationId)
      );
      if (existing) {
        await done;
        return existing;
      }
      const now = this.now();
      const candidate: MemoryCandidate = {
        id: this.randomUUID(),
        ...normalized,
        createdAt: now,
        updatedAt: now,
      };
      store.add(candidate);
      await done;
      return candidate;
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  async confirmCandidate(input: MemoryCandidateConfirmInput): Promise<MemoryItem> {
    const candidateId = normalizeMemoryId(input.candidateId);
    const transaction = this.database.transaction(
      [PERSONAL_WEB_STORE_NAMES.memoryCandidates, PERSONAL_WEB_STORE_NAMES.memoryItems],
      'readwrite'
    );
    const done = transactionDone(transaction);
    try {
      const candidateStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.memoryCandidates);
      const candidate = await requestResult<MemoryCandidate | undefined>(candidateStore.get(candidateId));
      if (!candidate) throw new Error('MEMORY_CANDIDATE_NOT_FOUND');
      const now = this.now();
      const memory = buildMemory(
        this.randomUUID(),
        {
          content: input.content,
          memoryType: input.memoryType,
          scope: input.scope,
          sensitivity: input.sensitivity,
          confidence: input.confidence,
          reason: input.reason,
          expiresAt: input.expiresAt,
          reviewAt: input.reviewAt,
        },
        candidate.sourceReferences,
        now
      );
      transaction.objectStore(PERSONAL_WEB_STORE_NAMES.memoryItems).add(memory);
      candidateStore.delete(candidate.id);
      await done;
      return memory;
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  async rejectCandidate(id: string): Promise<void> {
    const candidateId = normalizeMemoryId(id);
    const transaction = this.database.transaction(PERSONAL_WEB_STORE_NAMES.memoryCandidates, 'readwrite');
    const done = transactionDone(transaction);
    try {
      const store = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.memoryCandidates);
      const candidate = await requestResult<MemoryCandidate | undefined>(store.get(candidateId));
      if (!candidate) throw new Error('MEMORY_CANDIDATE_NOT_FOUND');
      store.delete(candidateId);
      await done;
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  async listMemories(query: MemoryListQuery): Promise<MemoryListResult> {
    const now = query.now ?? this.now();
    const search = query.search?.trim().toLocaleLowerCase() ?? '';
    const memoryTypes = new Set(query.memoryTypes ?? []);
    const memories = (await this.getAll<MemoryItem>(PERSONAL_WEB_STORE_NAMES.memoryItems))
      .filter((memory) =>
        query.view === 'active'
          ? memory.expiresAt === null || memory.expiresAt > now
          : memory.expiresAt !== null && memory.expiresAt <= now
      )
      .filter((memory) => !search || memory.content.toLocaleLowerCase().includes(search))
      .filter((memory) => memoryTypes.size === 0 || memoryTypes.has(memory.memoryType))
      .toSorted((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
    return { memories: memories.slice(0, normalizeMemoryListLimit(query.limit)), total: memories.length };
  }

  async getMemory(id: string): Promise<MemoryItem | null> {
    const transaction = this.database.transaction(PERSONAL_WEB_STORE_NAMES.memoryItems, 'readonly');
    const done = transactionDone(transaction);
    const memory = await requestResult<MemoryItem | undefined>(
      transaction.objectStore(PERSONAL_WEB_STORE_NAMES.memoryItems).get(normalizeMemoryId(id))
    );
    await done;
    return memory ?? null;
  }

  async createMemory(input: MemoryCreateInput): Promise<MemoryItem> {
    const now = this.now();
    const id = this.randomUUID();
    const sources = input.sourceReferences?.length
      ? normalizeMemorySources(input.sourceReferences)
      : [{ kind: 'manual' as const, id }];
    const memory = buildMemory(id, input, sources, now);
    await this.putMemory(memory, 'add');
    return memory;
  }

  async updateMemory(input: MemoryUpdateInput): Promise<MemoryItem> {
    const current = await this.getMemory(input.id);
    if (!current) throw new Error('MEMORY_NOT_FOUND');
    const updated = {
      ...buildMemory(current.id, input, normalizeMemorySources(input.sourceReferences), this.now()),
      confirmedAt: current.confirmedAt,
      lastRetrievedAt: current.lastRetrievedAt,
      createdAt: current.createdAt,
    };
    await this.putMemory(updated, 'put');
    return updated;
  }

  async forgetMemory(id: string): Promise<void> {
    const memoryId = normalizeMemoryId(id);
    const transaction = this.database.transaction(PERSONAL_WEB_STORE_NAMES.memoryItems, 'readwrite');
    const done = transactionDone(transaction);
    try {
      const store = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.memoryItems);
      const current = await requestResult<MemoryItem | undefined>(store.get(memoryId));
      if (!current) throw new Error('MEMORY_NOT_FOUND');
      store.delete(memoryId);
      await done;
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  async retrieve(input: MemoryRetrieveInput): Promise<MemoryRetrieveResult> {
    const now = this.now();
    const scopes = input.scopes.map(normalizeMemoryScope);
    const memories = await this.getAll<MemoryItem>(PERSONAL_WEB_STORE_NAMES.memoryItems);
    const hits = rankMemoriesForRetrieval(memories, {
      ...input,
      scopes,
      limit: normalizeMemoryListLimit(input.limit),
      now,
    });
    if (!hits.length) return { hits: [] };
    const updatedHits: MemoryRetrieveResult['hits'] = [];
    for (const hit of hits) {
      updatedHits.push({
        score: hit.score,
        memory: { ...hit.memory, lastRetrievedAt: now },
      });
    }
    const transaction = this.database.transaction(PERSONAL_WEB_STORE_NAMES.memoryItems, 'readwrite');
    const done = transactionDone(transaction);
    try {
      const store = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.memoryItems);
      for (const hit of updatedHits) store.put(hit.memory);
      await done;
      return { hits: updatedHits };
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  async getStatus(): Promise<MemoryStatus> {
    const now = this.now();
    const [candidates, memories] = await Promise.all([
      this.getAll<MemoryCandidate>(PERSONAL_WEB_STORE_NAMES.memoryCandidates),
      this.getAll<MemoryItem>(PERSONAL_WEB_STORE_NAMES.memoryItems),
    ]);
    return {
      pendingCount: candidates.length,
      activeCount: memories.filter((memory) => memory.expiresAt === null || memory.expiresAt > now).length,
      expiredCount: memories.filter((memory) => memory.expiresAt !== null && memory.expiresAt <= now).length,
      sensitiveCount: memories.filter((memory) => memory.sensitivity === 'sensitive').length,
    };
  }

  async exportMemories(): Promise<MemoryExport> {
    const memories = await this.getAll<MemoryItem>(PERSONAL_WEB_STORE_NAMES.memoryItems);
    return {
      exportedAt: this.now(),
      memories: memories.toSorted((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)),
    };
  }

  private async putMemory(memory: MemoryItem, mode: 'add' | 'put'): Promise<void> {
    const transaction = this.database.transaction(PERSONAL_WEB_STORE_NAMES.memoryItems, 'readwrite');
    const done = transactionDone(transaction);
    try {
      transaction.objectStore(PERSONAL_WEB_STORE_NAMES.memoryItems)[mode](memory);
      await done;
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  private async getAll<T>(storeName: string): Promise<T[]> {
    const transaction = this.database.transaction(storeName, 'readonly');
    const done = transactionDone(transaction);
    const values = await requestResult<T[]>(transaction.objectStore(storeName).getAll());
    await done;
    return values;
  }
}

export async function openMemoryDatabase(options: OpenMemoryDatabaseOptions = {}): Promise<MemoryDatabase> {
  const factory = options.factory ?? globalThis.indexedDB;
  if (!factory) throw new Error('MEMORY_INDEXEDDB_UNAVAILABLE');
  const randomUUID = options.randomUUID ?? (() => globalThis.crypto.randomUUID());
  const database = await openPersonalWebDatabase(factory, options.name ?? PERSONAL_WEB_DATABASE_NAME);
  return new MemoryDatabase(database, options.now ?? Date.now, randomUUID);
}

function buildMemory(
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

async function abortTransaction(transaction: IDBTransaction, done: Promise<void>): Promise<void> {
  try {
    transaction.abort();
  } catch {
    // A failed request may already have aborted or completed the transaction.
  }
  await done.catch((): undefined => undefined);
}
