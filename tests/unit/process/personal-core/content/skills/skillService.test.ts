import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SkillCandidateSubmitInput } from '@/common/types/searcht/skillConsolidation';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { SkillService } from '@process/services/personal-core/content/skills/SkillService';

const directories: string[] = [];

function openService(): { database: PersonalDatabase; service: SkillService } {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-skill-service-'));
  directories.push(directory);
  const database = PersonalDatabase.open(directory);
  let nextId = 0;
  let now = 100;
  return {
    database,
    service: new SkillService(database.driver, {
      now: () => ++now,
      randomUUID: () => `generated-${++nextId}`,
      hashContent: (content) => `hash-${content.length}`,
    }),
  };
}

const skillContent = (description: string, body: string) => `---
name: weekly-report
description: ${description}
---

# Weekly report

${body}`;

const submission = (operationId: string, body = 'Summarize completed work.'): SkillCandidateSubmitInput => ({
  operationId,
  proposedName: 'Weekly Report',
  description: 'Create a weekly report',
  content: skillContent('Create a weekly report', body),
  requiredTools: ['search'],
  permissions: ['read workspace'],
  reason: 'Repeated work',
  sourceReferences: [{ kind: 'conversation', id: `conversation-${operationId}` }],
});

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('SkillService', () => {
  it('submits idempotently, revalidates edits, and blocks invalid publication', () => {
    const { database, service } = openService();
    try {
      const first = service.submitCandidate(submission('operation-1'));
      expect(service.submitCandidate({ ...submission('operation-1'), reason: 'Retry' })).toEqual(first);

      const invalid = service.updateCandidate({
        ...first,
        content: skillContent('Create a weekly report', '(Full SKILL.md body here)'),
      });
      expect(invalid.validation.valid).toBe(false);
      expect(() =>
        service.publishCandidate({
          candidateId: first.id,
          installedSlug: 'weekly-report',
          content: invalid.content,
          changeSummary: 'Initial version',
        })
      ).toThrow('SKILL_DRAFT_INVALID');
      expect(service.getCandidate(first.id)?.content).toBe(invalid.content);
    } finally {
      database.close();
    }
  });

  it('publishes new immutable versions and rolls back by appending history', () => {
    const { database, service } = openService();
    try {
      const firstCandidate = service.submitCandidate(submission('operation-1'));
      const firstPublish = service.publishCandidate({
        candidateId: firstCandidate.id,
        installedSlug: 'weekly-report',
        content: firstCandidate.content,
        changeSummary: 'Initial version',
      });
      expect(firstPublish.version.versionNumber).toBe(1);
      expect(service.listCandidates().total).toBe(0);

      const secondCandidate = service.submitCandidate(submission('operation-2', 'Include project risks.'));
      const secondPublish = service.publishCandidate({
        candidateId: secondCandidate.id,
        installedSlug: 'weekly-report',
        content: secondCandidate.content,
        changeSummary: 'Add project risks',
      });
      expect(secondPublish.version.versionNumber).toBe(2);
      expect(service.getVersion(firstPublish.version.id)?.content).toBe(firstCandidate.content);

      const rollback = service.rollback({
        skillId: firstPublish.skill.id,
        versionId: firstPublish.version.id,
        installedSlug: 'weekly-report',
        changeSummary: 'Restore initial version',
      });
      expect(rollback.version.versionNumber).toBe(3);
      expect(rollback.version.content).toBe(firstCandidate.content);
      expect(service.listVersions(firstPublish.skill.id).versions.map((item) => item.versionNumber)).toEqual([3, 2, 1]);

      expect(service.updateState({ skillId: firstPublish.skill.id, state: 'disabled' }).state).toBe('disabled');
      expect(service.updateState({ skillId: firstPublish.skill.id, state: 'active' }).state).toBe('active');
    } finally {
      database.close();
    }
  });

  it('rejects a candidate without retaining draft content in audit records', () => {
    const { database, service } = openService();
    try {
      const created = service.submitCandidate(submission('operation-secret', 'Unique rejected draft phrase.'));
      service.rejectCandidate(created.id);

      expect(service.getCandidate(created.id)).toBeNull();
      expect(JSON.stringify(database.driver.prepare('SELECT * FROM personal_audit_log').all())).not.toContain(
        'Unique rejected draft phrase'
      );
      expect(() => service.rejectCandidate(created.id)).toThrow('SKILL_CANDIDATE_NOT_FOUND');
    } finally {
      database.close();
    }
  });
});
