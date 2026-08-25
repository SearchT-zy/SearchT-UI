import type {
  ManagedSkill,
  ManagedSkillListResult,
  SkillCandidate,
  SkillCandidateListQuery,
  SkillCandidateListResult,
  SkillCandidateSubmitInput,
  SkillCandidateUpdateInput,
  SkillLifecycleClient,
  SkillLifecycleStatus,
  SkillPublishInput,
  SkillPublishResult,
  SkillRollbackInput,
  SkillStateUpdateInput,
  SkillVersion,
  SkillVersionListResult,
} from '@/common/types/searcht/skillConsolidation';
import {
  normalizeSkillCandidateInput,
  normalizeSkillName,
  SkillValidationError,
} from '@/common/searcht/skillValidation';
import {
  openPersonalWebDatabase,
  PERSONAL_WEB_DATABASE_NAME,
  PERSONAL_WEB_STORE_NAMES,
  requestResult,
  transactionDone,
} from '@renderer/pages/personal/personalDbSchema';

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;

type SkillAuditRecord = {
  id: string;
  action: string;
  detail: Record<string, unknown>;
  createdAt: number;
};

export type OpenSkillLifecycleDatabaseOptions = {
  name?: string;
  factory?: IDBFactory;
  now?: () => number;
  randomUUID?: () => string;
  hashContent?: (content: string) => string | Promise<string>;
};

export class SkillLifecycleDatabase implements SkillLifecycleClient {
  constructor(
    private readonly database: IDBDatabase,
    private readonly now: () => number,
    private readonly randomUUID: () => string,
    private readonly hashContent: (content: string) => string | Promise<string>
  ) {}

  close(): void {
    this.database.close();
  }

  async listCandidates(query: SkillCandidateListQuery = {}): Promise<SkillCandidateListResult> {
    const candidates = await this.getAll<SkillCandidate>(PERSONAL_WEB_STORE_NAMES.skillCandidates);
    return {
      candidates: candidates
        .toSorted((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
        .slice(0, normalizeLimit(query.limit)),
      total: candidates.length,
    };
  }

  async getCandidate(id: string): Promise<SkillCandidate | null> {
    return this.getById<SkillCandidate>(
      PERSONAL_WEB_STORE_NAMES.skillCandidates,
      normalizeId(id, 'SKILL_CANDIDATE_ID_REQUIRED')
    );
  }

  async submitCandidate(input: SkillCandidateSubmitInput): Promise<SkillCandidate> {
    const normalized = normalizeSkillCandidateInput(input);
    const transaction = this.database.transaction(
      [PERSONAL_WEB_STORE_NAMES.skillCandidates, PERSONAL_WEB_STORE_NAMES.skillAudit],
      'readwrite'
    );
    const done = transactionDone(transaction);
    try {
      const store = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.skillCandidates);
      const existing = await requestResult<SkillCandidate | undefined>(
        store.index('operationId').get(normalized.operationId)
      );
      if (existing) {
        await done;
        return existing;
      }
      const now = this.now();
      const candidate: SkillCandidate = {
        id: this.randomUUID(),
        ...normalized,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      };
      store.add(candidate);
      this.addAudit(
        transaction,
        'skill_candidate_submit',
        {
          candidateId: candidate.id,
          operationId: candidate.operationId,
        },
        now
      );
      await done;
      return candidate;
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  async updateCandidate(input: SkillCandidateUpdateInput): Promise<SkillCandidate> {
    const id = normalizeId(input.id, 'SKILL_CANDIDATE_ID_REQUIRED');
    const transaction = this.database.transaction(
      [PERSONAL_WEB_STORE_NAMES.skillCandidates, PERSONAL_WEB_STORE_NAMES.skillAudit],
      'readwrite'
    );
    const done = transactionDone(transaction);
    try {
      const store = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.skillCandidates);
      const current = await requestResult<SkillCandidate | undefined>(store.get(id));
      if (!current) throw new Error('SKILL_CANDIDATE_NOT_FOUND');
      const normalized = normalizeSkillCandidateInput({
        operationId: current.operationId,
        proposedName: input.proposedName,
        description: input.description,
        content: input.content,
        requiredTools: input.requiredTools,
        permissions: input.permissions,
        reason: input.reason,
        sourceReferences: input.sourceReferences,
      });
      const now = this.now();
      const updated: SkillCandidate = {
        ...current,
        ...normalized,
        id,
        status: 'pending',
        createdAt: current.createdAt,
        updatedAt: now,
      };
      store.put(updated);
      this.addAudit(transaction, 'skill_candidate_update', { candidateId: id }, now);
      await done;
      return updated;
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  async rejectCandidate(id: string): Promise<void> {
    const candidateId = normalizeId(id, 'SKILL_CANDIDATE_ID_REQUIRED');
    const transaction = this.database.transaction(
      [PERSONAL_WEB_STORE_NAMES.skillCandidates, PERSONAL_WEB_STORE_NAMES.skillAudit],
      'readwrite'
    );
    const done = transactionDone(transaction);
    try {
      const store = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.skillCandidates);
      const candidate = await requestResult<SkillCandidate | undefined>(store.get(candidateId));
      if (!candidate) throw new Error('SKILL_CANDIDATE_NOT_FOUND');
      const now = this.now();
      store.delete(candidateId);
      this.addAudit(transaction, 'skill_candidate_reject', { candidateId }, now);
      await done;
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  async listManagedSkills(): Promise<ManagedSkillListResult> {
    const skills = (await this.getAll<ManagedSkill>(PERSONAL_WEB_STORE_NAMES.managedSkills)).toSorted(
      (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)
    );
    return { skills, total: skills.length };
  }

  async getManagedSkill(idOrSlug: string): Promise<ManagedSkill | null> {
    const normalized = normalizeId(idOrSlug, 'SKILL_ID_REQUIRED');
    const transaction = this.database.transaction(PERSONAL_WEB_STORE_NAMES.managedSkills, 'readonly');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.managedSkills);
    const byId = requestResult<ManagedSkill | undefined>(store.get(normalized));
    const bySlug = requestResult<ManagedSkill | undefined>(store.index('slug').get(normalized));
    const [idMatch, slugMatch] = await Promise.all([byId, bySlug]);
    await done;
    return idMatch ?? slugMatch ?? null;
  }

  async listVersions(skillId: string): Promise<SkillVersionListResult> {
    const normalizedSkillId = normalizeId(skillId, 'SKILL_ID_REQUIRED');
    const transaction = this.database.transaction(PERSONAL_WEB_STORE_NAMES.skillVersions, 'readonly');
    const done = transactionDone(transaction);
    const versions = await requestResult<SkillVersion[]>(
      transaction.objectStore(PERSONAL_WEB_STORE_NAMES.skillVersions).index('skillId').getAll(normalizedSkillId)
    );
    await done;
    const sorted = versions.toSorted(
      (left, right) => right.versionNumber - left.versionNumber || left.id.localeCompare(right.id)
    );
    return { versions: sorted, total: sorted.length };
  }

  async getVersion(id: string): Promise<SkillVersion | null> {
    return this.getById<SkillVersion>(
      PERSONAL_WEB_STORE_NAMES.skillVersions,
      normalizeId(id, 'SKILL_VERSION_ID_REQUIRED')
    );
  }

  async publishCandidate(input: SkillPublishInput): Promise<SkillPublishResult> {
    const candidateId = normalizeId(input.candidateId, 'SKILL_CANDIDATE_ID_REQUIRED');
    const installedSlug = normalizeSkillName(input.installedSlug);
    const contentHash = await this.hashContent(input.content);
    const transaction = this.database.transaction(
      [
        PERSONAL_WEB_STORE_NAMES.skillCandidates,
        PERSONAL_WEB_STORE_NAMES.managedSkills,
        PERSONAL_WEB_STORE_NAMES.skillVersions,
        PERSONAL_WEB_STORE_NAMES.skillAudit,
      ],
      'readwrite'
    );
    const done = transactionDone(transaction);
    try {
      const candidateStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.skillCandidates);
      const skillStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.managedSkills);
      const versionStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.skillVersions);
      const candidate = await requestResult<SkillCandidate | undefined>(candidateStore.get(candidateId));
      if (!candidate) throw new Error('SKILL_CANDIDATE_NOT_FOUND');
      if (!candidate.validation.valid) throw new Error('SKILL_DRAFT_INVALID');
      if (input.content !== candidate.content) throw new Error('SKILL_PUBLISHED_CONTENT_MISMATCH');
      if (installedSlug !== candidate.proposedName) throw new Error('SKILL_PUBLISHED_NAME_MISMATCH');

      const now = this.now();
      let skill = await requestResult<ManagedSkill | undefined>(skillStore.index('slug').get(candidate.proposedName));
      if (!skill) {
        skill = {
          id: this.randomUUID(),
          slug: candidate.proposedName,
          description: candidate.description,
          state: 'active',
          activeVersionId: null,
          createdAt: now,
          updatedAt: now,
        };
        skillStore.add(skill);
      }
      const existingVersions = await requestResult<SkillVersion[]>(versionStore.index('skillId').getAll(skill.id));
      const version: SkillVersion = {
        id: this.randomUUID(),
        skillId: skill.id,
        versionNumber: nextVersionNumber(existingVersions),
        content: candidate.content,
        contentHash,
        requiredTools: candidate.requiredTools,
        permissions: candidate.permissions,
        sourceReferences: candidate.sourceReferences,
        validation: candidate.validation,
        changeSummary: input.changeSummary.trim(),
        candidateId: candidate.id,
        createdAt: now,
        publishedAt: now,
      };
      versionStore.add(version);
      skill = {
        ...skill,
        description: candidate.description,
        state: 'active',
        activeVersionId: version.id,
        updatedAt: now,
      };
      skillStore.put(skill);
      candidateStore.delete(candidate.id);
      this.addAudit(
        transaction,
        'skill_candidate_publish',
        {
          candidateId: candidate.id,
          skillId: skill.id,
          versionId: version.id,
          versionNumber: version.versionNumber,
        },
        now
      );
      await done;
      return { skill, version };
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  async rollback(input: SkillRollbackInput): Promise<SkillPublishResult> {
    const skillId = normalizeId(input.skillId, 'SKILL_ID_REQUIRED');
    const versionId = normalizeId(input.versionId, 'SKILL_VERSION_ID_REQUIRED');
    const installedSlug = normalizeSkillName(input.installedSlug);
    const transaction = this.database.transaction(
      [
        PERSONAL_WEB_STORE_NAMES.managedSkills,
        PERSONAL_WEB_STORE_NAMES.skillVersions,
        PERSONAL_WEB_STORE_NAMES.skillAudit,
      ],
      'readwrite'
    );
    const done = transactionDone(transaction);
    try {
      const skillStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.managedSkills);
      const versionStore = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.skillVersions);
      let skill = await requestResult<ManagedSkill | undefined>(skillStore.get(skillId));
      if (!skill) throw new Error('SKILL_NOT_FOUND');
      if (installedSlug !== skill.slug) throw new Error('SKILL_PUBLISHED_NAME_MISMATCH');
      const source = await requestResult<SkillVersion | undefined>(versionStore.get(versionId));
      if (!source || source.skillId !== skill.id) throw new Error('SKILL_VERSION_NOT_FOUND');
      const existingVersions = await requestResult<SkillVersion[]>(versionStore.index('skillId').getAll(skill.id));
      const now = this.now();
      const version: SkillVersion = {
        ...source,
        id: this.randomUUID(),
        versionNumber: nextVersionNumber(existingVersions),
        changeSummary: input.changeSummary.trim(),
        candidateId: null,
        createdAt: now,
        publishedAt: now,
      };
      versionStore.add(version);
      skill = { ...skill, state: 'active', activeVersionId: version.id, updatedAt: now };
      skillStore.put(skill);
      this.addAudit(
        transaction,
        'skill_rollback',
        {
          skillId: skill.id,
          sourceVersionId: source.id,
          versionId: version.id,
          versionNumber: version.versionNumber,
        },
        now
      );
      await done;
      return { skill, version };
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  async updateState(input: SkillStateUpdateInput): Promise<ManagedSkill> {
    const skillId = normalizeId(input.skillId, 'SKILL_ID_REQUIRED');
    if (input.state !== 'active' && input.state !== 'disabled') throw new Error('SKILL_STATE_INVALID');
    const transaction = this.database.transaction(
      [PERSONAL_WEB_STORE_NAMES.managedSkills, PERSONAL_WEB_STORE_NAMES.skillAudit],
      'readwrite'
    );
    const done = transactionDone(transaction);
    try {
      const store = transaction.objectStore(PERSONAL_WEB_STORE_NAMES.managedSkills);
      const skill = await requestResult<ManagedSkill | undefined>(store.get(skillId));
      if (!skill) throw new Error('SKILL_NOT_FOUND');
      if (input.state === 'active' && !skill.activeVersionId) throw new Error('SKILL_ACTIVE_VERSION_REQUIRED');
      const now = this.now();
      const updated = { ...skill, state: input.state, updatedAt: now };
      store.put(updated);
      this.addAudit(transaction, input.state === 'active' ? 'skill_enable' : 'skill_disable', { skillId }, now);
      await done;
      return updated;
    } catch (error) {
      await abortTransaction(transaction, done);
      throw error;
    }
  }

  async getStatus(): Promise<SkillLifecycleStatus> {
    const [candidates, skills] = await Promise.all([
      this.getAll<SkillCandidate>(PERSONAL_WEB_STORE_NAMES.skillCandidates),
      this.getAll<ManagedSkill>(PERSONAL_WEB_STORE_NAMES.managedSkills),
    ]);
    return {
      pendingCount: candidates.length,
      activeCount: skills.filter((skill) => skill.state === 'active').length,
      disabledCount: skills.filter((skill) => skill.state === 'disabled').length,
    };
  }

  private addAudit(
    transaction: IDBTransaction,
    action: string,
    detail: Record<string, unknown>,
    createdAt: number
  ): void {
    const record: SkillAuditRecord = { id: this.randomUUID(), action, detail, createdAt };
    transaction.objectStore(PERSONAL_WEB_STORE_NAMES.skillAudit).add(record);
  }

  private async getById<T>(storeName: string, id: string): Promise<T | null> {
    const transaction = this.database.transaction(storeName, 'readonly');
    const done = transactionDone(transaction);
    const value = await requestResult<T | undefined>(transaction.objectStore(storeName).get(id));
    await done;
    return value ?? null;
  }

  private async getAll<T>(storeName: string): Promise<T[]> {
    const transaction = this.database.transaction(storeName, 'readonly');
    const done = transactionDone(transaction);
    const values = await requestResult<T[]>(transaction.objectStore(storeName).getAll());
    await done;
    return values;
  }
}

export async function openSkillLifecycleDatabase(
  options: OpenSkillLifecycleDatabaseOptions = {}
): Promise<SkillLifecycleDatabase> {
  const factory = options.factory ?? globalThis.indexedDB;
  if (!factory) throw new Error('SKILL_INDEXEDDB_UNAVAILABLE');
  const database = await openPersonalWebDatabase(factory, options.name ?? PERSONAL_WEB_DATABASE_NAME);
  return new SkillLifecycleDatabase(
    database,
    options.now ?? Date.now,
    options.randomUUID ?? (() => globalThis.crypto.randomUUID()),
    options.hashContent ?? sha256Hex
  );
}

function nextVersionNumber(versions: readonly SkillVersion[]): number {
  return versions.reduce((highest, version) => Math.max(highest, version.versionNumber), 0) + 1;
}

function normalizeId(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

function normalizeLimit(value?: number): number {
  if (value === undefined) return DEFAULT_LIST_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIST_LIMIT) {
    throw new SkillValidationError('SKILL_LIST_LIMIT_INVALID');
  }
  return value;
}

async function sha256Hex(content: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function abortTransaction(transaction: IDBTransaction, done: Promise<void>): Promise<void> {
  try {
    transaction.abort();
  } catch {
    // A failed request may already have aborted or completed the transaction.
  }
  await done.catch((): undefined => undefined);
}
