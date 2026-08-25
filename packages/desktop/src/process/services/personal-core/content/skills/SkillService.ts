import { createHash } from 'node:crypto';
import type {
  ManagedSkill,
  ManagedSkillListResult,
  SkillCandidate,
  SkillCandidateListQuery,
  SkillCandidateListResult,
  SkillCandidateSubmitInput,
  SkillCandidateUpdateInput,
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
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import { SkillRepository } from './SkillRepository';

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;

export type SkillServiceOptions = {
  now?: () => number;
  randomUUID?: () => string;
  hashContent?: (content: string) => string;
};

export class SkillService {
  private readonly repository: SkillRepository;
  private readonly now: () => number;
  private readonly randomUUID: () => string;
  private readonly hashContent: (content: string) => string;

  constructor(driver: ISqliteDriver, options: SkillServiceOptions = {}) {
    this.repository = new SkillRepository(driver);
    this.now = options.now ?? Date.now;
    this.randomUUID = options.randomUUID ?? crypto.randomUUID;
    this.hashContent = options.hashContent ?? ((content) => createHash('sha256').update(content).digest('hex'));
  }

  listCandidates(query: SkillCandidateListQuery = {}): SkillCandidateListResult {
    const limit = normalizeLimit(query.limit);
    return { candidates: this.repository.listCandidates(limit), total: this.repository.countCandidates() };
  }

  getCandidate(id: string): SkillCandidate | null {
    return this.repository.findCandidateById(normalizeId(id, 'SKILL_CANDIDATE_ID_REQUIRED'));
  }

  submitCandidate(input: SkillCandidateSubmitInput): SkillCandidate {
    const normalized = normalizeSkillCandidateInput(input);
    return this.repository.transaction(() => {
      const existing = this.repository.findCandidateByOperationId(normalized.operationId);
      if (existing) return existing;
      const now = this.now();
      const candidate = this.repository.insertCandidate({
        id: this.randomUUID(),
        ...normalized,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      });
      this.repository.insertAudit(
        this.randomUUID(),
        'skill_candidate_submit',
        { candidateId: candidate.id, operationId: candidate.operationId },
        now
      );
      return candidate;
    });
  }

  updateCandidate(input: SkillCandidateUpdateInput): SkillCandidate {
    const id = normalizeId(input.id, 'SKILL_CANDIDATE_ID_REQUIRED');
    return this.repository.transaction(() => {
      const current = this.repository.findCandidateById(id);
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
      const updated = this.repository.updateCandidate({
        ...current,
        ...normalized,
        id,
        status: 'pending',
        createdAt: current.createdAt,
        updatedAt: now,
      });
      this.repository.insertAudit(this.randomUUID(), 'skill_candidate_update', { candidateId: id }, now);
      return updated;
    });
  }

  rejectCandidate(id: string): void {
    const candidateId = normalizeId(id, 'SKILL_CANDIDATE_ID_REQUIRED');
    this.repository.transaction(() => {
      if (!this.repository.findCandidateById(candidateId)) throw new Error('SKILL_CANDIDATE_NOT_FOUND');
      this.repository.deleteCandidate(candidateId);
      this.repository.insertAudit(this.randomUUID(), 'skill_candidate_reject', { candidateId }, this.now());
    });
  }

  listManagedSkills(): ManagedSkillListResult {
    const skills = this.repository.listManagedSkills();
    return { skills, total: skills.length };
  }

  getManagedSkill(idOrSlug: string): ManagedSkill | null {
    const normalized = normalizeId(idOrSlug, 'SKILL_ID_REQUIRED');
    return this.repository.findManagedSkillById(normalized) ?? this.repository.findManagedSkillBySlug(normalized);
  }

  listVersions(skillId: string): SkillVersionListResult {
    const normalizedSkillId = normalizeId(skillId, 'SKILL_ID_REQUIRED');
    const versions = this.repository.listVersions(normalizedSkillId);
    return { versions, total: versions.length };
  }

  getVersion(id: string): SkillVersion | null {
    return this.repository.findVersionById(normalizeId(id, 'SKILL_VERSION_ID_REQUIRED'));
  }

  publishCandidate(input: SkillPublishInput): SkillPublishResult {
    const candidateId = normalizeId(input.candidateId, 'SKILL_CANDIDATE_ID_REQUIRED');
    const installedSlug = normalizeSkillName(input.installedSlug);
    const changeSummary = input.changeSummary.trim();
    return this.repository.transaction(() => {
      const candidate = this.repository.findCandidateById(candidateId);
      if (!candidate) throw new Error('SKILL_CANDIDATE_NOT_FOUND');
      if (!candidate.validation.valid) throw new Error('SKILL_DRAFT_INVALID');
      if (input.content !== candidate.content) throw new Error('SKILL_PUBLISHED_CONTENT_MISMATCH');
      if (installedSlug !== candidate.proposedName) throw new Error('SKILL_PUBLISHED_NAME_MISMATCH');

      const now = this.now();
      let skill = this.repository.findManagedSkillBySlug(candidate.proposedName);
      if (!skill) {
        skill = this.repository.insertManagedSkill({
          id: this.randomUUID(),
          slug: candidate.proposedName,
          description: candidate.description,
          state: 'active',
          activeVersionId: null,
          createdAt: now,
          updatedAt: now,
        });
      }
      const version = this.repository.insertVersion({
        id: this.randomUUID(),
        skillId: skill.id,
        versionNumber: this.repository.nextVersionNumber(skill.id),
        content: candidate.content,
        contentHash: this.hashContent(candidate.content),
        requiredTools: candidate.requiredTools,
        permissions: candidate.permissions,
        sourceReferences: candidate.sourceReferences,
        validation: candidate.validation,
        changeSummary,
        candidateId: candidate.id,
        createdAt: now,
        publishedAt: now,
      });
      skill = this.repository.updateManagedSkill({
        ...skill,
        description: candidate.description,
        state: 'active',
        activeVersionId: version.id,
        updatedAt: now,
      });
      this.repository.deleteCandidate(candidate.id);
      this.repository.insertAudit(
        this.randomUUID(),
        'skill_candidate_publish',
        { candidateId: candidate.id, skillId: skill.id, versionId: version.id, versionNumber: version.versionNumber },
        now
      );
      return { skill, version };
    });
  }

  rollback(input: SkillRollbackInput): SkillPublishResult {
    const skillId = normalizeId(input.skillId, 'SKILL_ID_REQUIRED');
    const versionId = normalizeId(input.versionId, 'SKILL_VERSION_ID_REQUIRED');
    const installedSlug = normalizeSkillName(input.installedSlug);
    return this.repository.transaction(() => {
      let skill = this.repository.findManagedSkillById(skillId);
      if (!skill) throw new Error('SKILL_NOT_FOUND');
      if (installedSlug !== skill.slug) throw new Error('SKILL_PUBLISHED_NAME_MISMATCH');
      const source = this.repository.findVersionById(versionId);
      if (!source || source.skillId !== skill.id) throw new Error('SKILL_VERSION_NOT_FOUND');
      const now = this.now();
      const version = this.repository.insertVersion({
        ...source,
        id: this.randomUUID(),
        versionNumber: this.repository.nextVersionNumber(skill.id),
        contentHash: this.hashContent(source.content),
        changeSummary: input.changeSummary.trim(),
        candidateId: null,
        createdAt: now,
        publishedAt: now,
      });
      skill = this.repository.updateManagedSkill({
        ...skill,
        state: 'active',
        activeVersionId: version.id,
        updatedAt: now,
      });
      this.repository.insertAudit(
        this.randomUUID(),
        'skill_rollback',
        { skillId: skill.id, sourceVersionId: source.id, versionId: version.id, versionNumber: version.versionNumber },
        now
      );
      return { skill, version };
    });
  }

  updateState(input: SkillStateUpdateInput): ManagedSkill {
    const skillId = normalizeId(input.skillId, 'SKILL_ID_REQUIRED');
    if (input.state !== 'active' && input.state !== 'disabled') throw new Error('SKILL_STATE_INVALID');
    return this.repository.transaction(() => {
      const skill = this.repository.findManagedSkillById(skillId);
      if (!skill) throw new Error('SKILL_NOT_FOUND');
      if (input.state === 'active' && !skill.activeVersionId) throw new Error('SKILL_ACTIVE_VERSION_REQUIRED');
      const now = this.now();
      const updated = this.repository.updateManagedSkill({ ...skill, state: input.state, updatedAt: now });
      this.repository.insertAudit(
        this.randomUUID(),
        input.state === 'active' ? 'skill_enable' : 'skill_disable',
        { skillId },
        now
      );
      return updated;
    });
  }

  getStatus(): SkillLifecycleStatus {
    return this.repository.getStatus();
  }
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
