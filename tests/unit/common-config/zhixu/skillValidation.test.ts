import { describe, expect, it } from 'vitest';
import type { SkillCandidateSubmitInput } from '@/common/types/searcht/skillConsolidation';
import {
  SKILL_CONTENT_MAX_BYTES,
  normalizeSkillCandidateInput,
  normalizeSkillName,
  validateSkillDraft,
} from '@/common/searcht/skillValidation';

const validContent = `---
name: weekly-report
description: Create a concise weekly report
---

# Weekly report

Summarize the supplied work items and cite their sources.`;

const candidateInput = (overrides: Partial<SkillCandidateSubmitInput> = {}): SkillCandidateSubmitInput => ({
  operationId: ' suggestion-1 ',
  proposedName: ' Weekly Report ',
  description: ' Create a concise weekly report ',
  content: validContent,
  requiredTools: [' search ', 'files', 'search'],
  permissions: [' read workspace ', 'read workspace'],
  reason: ' Repeatedly produced the same weekly summary. ',
  sourceReferences: [
    { kind: 'conversation', id: ' conversation-1 ', label: ' Weekly review ' },
    { kind: 'conversation', id: 'conversation-1', label: 'Duplicate' },
  ],
  ...overrides,
});

describe('skill consolidation validation', () => {
  it('normalizes a valid candidate and deduplicates tools, permissions, and sources', () => {
    const normalized = normalizeSkillCandidateInput(candidateInput());

    expect(normalized).toEqual({
      operationId: 'suggestion-1',
      proposedName: 'weekly-report',
      description: 'Create a concise weekly report',
      content: validContent,
      requiredTools: ['search', 'files'],
      permissions: ['read workspace'],
      reason: 'Repeatedly produced the same weekly summary.',
      sourceReferences: [{ kind: 'conversation', id: 'conversation-1', label: 'Weekly review' }],
      validation: {
        valid: true,
        normalizedName: 'weekly-report',
        parsedName: 'weekly-report',
        parsedDescription: 'Create a concise weekly report',
        issues: [],
      },
    });
  });

  it('normalizes human-readable names and rejects unusable slugs', () => {
    expect(normalizeSkillName('  Weekly Report 2026 ')).toBe('weekly-report-2026');
    expect(() => normalizeSkillName('中文技能')).toThrow('SKILL_NAME_INVALID');
    expect(() => normalizeSkillName('---')).toThrow('SKILL_NAME_INVALID');
  });

  it('reports malformed frontmatter, mismatched names, and template placeholders in stable order', () => {
    const report = validateSkillDraft({
      name: 'weekly-report',
      description: '',
      content: `---
name: another-name
description: One-line description
---

(Full SKILL.md body here)`,
    });

    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual([
      'SKILL_DESCRIPTION_REQUIRED',
      'SKILL_FRONTMATTER_NAME_MISMATCH',
      'SKILL_TEMPLATE_PLACEHOLDER',
    ]);
  });

  it('blocks likely credentials while treating absolute local paths as review warnings', () => {
    const report = validateSkillDraft({
      name: 'private-report',
      description: 'Build a private report',
      content: `---
name: private-report
description: Build a private report
---

Read C:\\Users\\Alice\\Documents and use OPENAI_API_KEY=sk-probe-abcdefghijklmnopqrst.`,
    });

    expect(report.valid).toBe(false);
    expect(report.issues).toEqual([
      { code: 'SKILL_SECRET_DETECTED', severity: 'error', field: 'content' },
      { code: 'SKILL_ABSOLUTE_PATH_DETECTED', severity: 'warning', field: 'content' },
    ]);
  });

  it('enforces byte and list limits before candidate content is persisted', () => {
    const oversized = 'x'.repeat(SKILL_CONTENT_MAX_BYTES + 1);
    expect(validateSkillDraft({ name: 'large-skill', description: 'Large', content: oversized }).issues[0]?.code).toBe(
      'SKILL_CONTENT_TOO_LARGE'
    );
    expect(() =>
      normalizeSkillCandidateInput(
        candidateInput({ requiredTools: Array.from({ length: 33 }, (_, index) => `tool-${index}`) })
      )
    ).toThrow('SKILL_TOOLS_TOO_MANY');
  });
});
