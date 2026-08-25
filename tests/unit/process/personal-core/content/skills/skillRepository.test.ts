import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ManagedSkill, SkillCandidate, SkillVersion } from '@/common/types/searcht/skillConsolidation';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { SkillRepository } from '@process/services/personal-core/content/skills/SkillRepository';

const directories: string[] = [];

function openRepository(): { database: PersonalDatabase; repository: SkillRepository } {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-skill-repository-'));
  directories.push(directory);
  const database = PersonalDatabase.open(directory);
  return { database, repository: new SkillRepository(database.driver) };
}

const validation = {
  valid: true,
  normalizedName: 'weekly-report',
  parsedName: 'weekly-report',
  parsedDescription: 'Create a weekly report',
  issues: [],
} as const;

const candidate: SkillCandidate = {
  id: 'candidate-1',
  operationId: 'operation-1',
  proposedName: 'weekly-report',
  description: 'Create a weekly report',
  content: '---\nname: weekly-report\ndescription: Create a weekly report\n---\n\n# Steps',
  requiredTools: ['search'],
  permissions: ['read workspace'],
  reason: 'Repeated work',
  sourceReferences: [{ kind: 'conversation', id: 'conversation-1' }],
  validation,
  status: 'pending',
  createdAt: 10,
  updatedAt: 10,
};

const skill: ManagedSkill = {
  id: 'skill-1',
  slug: 'weekly-report',
  description: candidate.description,
  state: 'active',
  activeVersionId: null,
  createdAt: 20,
  updatedAt: 20,
};

const version: SkillVersion = {
  id: 'version-1',
  skillId: skill.id,
  versionNumber: 1,
  content: candidate.content,
  contentHash: 'hash-1',
  requiredTools: candidate.requiredTools,
  permissions: candidate.permissions,
  sourceReferences: candidate.sourceReferences,
  validation,
  changeSummary: 'Initial version',
  candidateId: candidate.id,
  createdAt: 20,
  publishedAt: 20,
};

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('SkillRepository', () => {
  it('round-trips candidates and lists them by recent update order', () => {
    const { database, repository } = openRepository();
    try {
      repository.insertCandidate(candidate);
      repository.insertCandidate({ ...candidate, id: 'candidate-2', operationId: 'operation-2', updatedAt: 30 });

      expect(repository.findCandidateByOperationId('operation-1')).toEqual(candidate);
      expect(repository.listCandidates(20).map((item) => item.id)).toEqual(['candidate-2', 'candidate-1']);
      expect(repository.updateCandidate({ ...candidate, description: 'Edited', updatedAt: 40 }).description).toBe(
        'Edited'
      );
    } finally {
      database.close();
    }
  });

  it('stores managed skills and immutable versions in descending order', () => {
    const { database, repository } = openRepository();
    try {
      repository.insertManagedSkill(skill);
      repository.insertVersion(version);
      repository.insertVersion({ ...version, id: 'version-2', versionNumber: 2, contentHash: 'hash-2' });
      repository.updateManagedSkill({ ...skill, activeVersionId: 'version-2', updatedAt: 30 });

      expect(repository.findManagedSkillBySlug('weekly-report')?.activeVersionId).toBe('version-2');
      expect(repository.listVersions(skill.id).map((item) => item.versionNumber)).toEqual([2, 1]);
      expect(repository.nextVersionNumber(skill.id)).toBe(3);
      expect(() => repository.insertVersion({ ...version, id: 'version-copy' })).toThrow();
      expect(repository.findVersionById('version-1')).toEqual(version);
    } finally {
      database.close();
    }
  });
});
