import { load as loadYaml } from 'js-yaml';
import type {
  NormalizedSkillCandidateSubmitInput,
  SkillCandidateSubmitInput,
  SkillDraftInput,
  SkillSourceReference,
  SkillValidationIssue,
  SkillValidationIssueCode,
  SkillValidationReport,
} from '../types/searcht/skillConsolidation';

export const SKILL_NAME_MAX_LENGTH = 64;
export const SKILL_DESCRIPTION_MAX_LENGTH = 500;
export const SKILL_CONTENT_MAX_BYTES = 256 * 1024;
export const SKILL_TOOLS_MAX_COUNT = 32;
export const SKILL_PERMISSIONS_MAX_COUNT = 32;
export const SKILL_SOURCES_MAX_COUNT = 64;

const ISSUE_ORDER: readonly SkillValidationIssueCode[] = [
  'SKILL_CONTENT_TOO_LARGE',
  'SKILL_NAME_REQUIRED',
  'SKILL_NAME_INVALID',
  'SKILL_NAME_TOO_LONG',
  'SKILL_DESCRIPTION_REQUIRED',
  'SKILL_DESCRIPTION_TOO_LONG',
  'SKILL_CONTENT_REQUIRED',
  'SKILL_FRONTMATTER_INVALID',
  'SKILL_FRONTMATTER_NAME_REQUIRED',
  'SKILL_FRONTMATTER_DESCRIPTION_REQUIRED',
  'SKILL_FRONTMATTER_NAME_MISMATCH',
  'SKILL_TEMPLATE_PLACEHOLDER',
  'SKILL_SECRET_DETECTED',
  'SKILL_ABSOLUTE_PATH_DETECTED',
];

const TEMPLATE_PLACEHOLDERS = [
  /(?:^|\n)\s*\(?full\s+skill\.md\s+body\b/iu,
  /(?:^|\n)\s*\(?clear\s+instructions\s+for\s+executing\s+this\s+task\b/iu,
  /<full\s+instructions(?:\s*:|>)/iu,
  /\b(?:your[- ]skill[- ]name|one-line description)\b/iu,
];

const LIKELY_SECRET_PATTERNS = [
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|password)\s*[=:]\s*['"]?(?!\$\{|\{\{)[A-Za-z0-9_/.+=-]{12,}/iu,
  /\bsk-[A-Za-z0-9_-]{20,}\b/u,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
];

const ABSOLUTE_PATH_PATTERNS = [
  /(?:^|[\s`'"])[A-Za-z]:\\(?:[^\s`'"]+\\)*[^\s`'"]*/u,
  /(?:^|[\s`'"])(?:\/Users|\/home)\/[^\s`'"]+/u,
];

type Frontmatter = {
  name: string | null;
  description: string | null;
  valid: boolean;
};

export class SkillValidationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'SkillValidationError';
    this.code = code;
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function readFrontmatter(content: string): Frontmatter {
  const match = content.match(/^---[\t ]*\r?\n([\s\S]*?)\r?\n---[\t ]*(?:\r?\n|$)/u);
  if (!match) return { name: null, description: null, valid: false };

  try {
    const parsed = loadYaml(match[1]);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { name: null, description: null, valid: false };
    }
    const record = parsed as Record<string, unknown>;
    return {
      name: typeof record.name === 'string' ? record.name.trim() || null : null,
      description: typeof record.description === 'string' ? record.description.trim() || null : null,
      valid: true,
    };
  } catch {
    return { name: null, description: null, valid: false };
  }
}

function addIssue(issues: SkillValidationIssue[], issue: SkillValidationIssue): void {
  if (!issues.some((existing) => existing.code === issue.code && existing.field === issue.field)) {
    issues.push(issue);
  }
}

function sortedIssues(issues: SkillValidationIssue[]): SkillValidationIssue[] {
  return issues.toSorted((left, right) => ISSUE_ORDER.indexOf(left.code) - ISSUE_ORDER.indexOf(right.code));
}

export function normalizeSkillName(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) throw new SkillValidationError('SKILL_NAME_REQUIRED');

  const normalized = trimmed
    .replace(/[_\s]+/gu, '-')
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/-{2,}/gu, '-')
    .replace(/^-|-$/gu, '');

  if (!normalized || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(normalized)) {
    throw new SkillValidationError('SKILL_NAME_INVALID');
  }
  if (normalized.length > SKILL_NAME_MAX_LENGTH) throw new SkillValidationError('SKILL_NAME_TOO_LONG');
  return normalized;
}

export function validateSkillDraft(input: SkillDraftInput): SkillValidationReport {
  const issues: SkillValidationIssue[] = [];
  let normalizedName: string | null = null;

  try {
    normalizedName = normalizeSkillName(input.name);
  } catch (error) {
    const code =
      error instanceof SkillValidationError ? (error.code as SkillValidationIssueCode) : 'SKILL_NAME_INVALID';
    addIssue(issues, { code, severity: 'error', field: 'name' });
  }

  const description = input.description.trim();
  if (!description) {
    addIssue(issues, { code: 'SKILL_DESCRIPTION_REQUIRED', severity: 'error', field: 'description' });
  } else if (description.length > SKILL_DESCRIPTION_MAX_LENGTH) {
    addIssue(issues, { code: 'SKILL_DESCRIPTION_TOO_LONG', severity: 'error', field: 'description' });
  }

  const content = input.content;
  if (!content.trim()) addIssue(issues, { code: 'SKILL_CONTENT_REQUIRED', severity: 'error', field: 'content' });
  if (byteLength(content) > SKILL_CONTENT_MAX_BYTES) {
    addIssue(issues, { code: 'SKILL_CONTENT_TOO_LARGE', severity: 'error', field: 'content' });
  }

  const frontmatter = readFrontmatter(content);
  if (!frontmatter.valid) {
    addIssue(issues, { code: 'SKILL_FRONTMATTER_INVALID', severity: 'error', field: 'content' });
  } else {
    if (!frontmatter.name) {
      addIssue(issues, { code: 'SKILL_FRONTMATTER_NAME_REQUIRED', severity: 'error', field: 'content' });
    }
    if (!frontmatter.description) {
      addIssue(issues, { code: 'SKILL_FRONTMATTER_DESCRIPTION_REQUIRED', severity: 'error', field: 'content' });
    }
    if (frontmatter.name && normalizedName) {
      try {
        if (normalizeSkillName(frontmatter.name) !== normalizedName) {
          addIssue(issues, { code: 'SKILL_FRONTMATTER_NAME_MISMATCH', severity: 'error', field: 'content' });
        }
      } catch {
        addIssue(issues, { code: 'SKILL_FRONTMATTER_NAME_MISMATCH', severity: 'error', field: 'content' });
      }
    }
  }

  if (TEMPLATE_PLACEHOLDERS.some((pattern) => pattern.test(content))) {
    addIssue(issues, { code: 'SKILL_TEMPLATE_PLACEHOLDER', severity: 'error', field: 'content' });
  }
  if (LIKELY_SECRET_PATTERNS.some((pattern) => pattern.test(content))) {
    addIssue(issues, { code: 'SKILL_SECRET_DETECTED', severity: 'error', field: 'content' });
  }
  if (ABSOLUTE_PATH_PATTERNS.some((pattern) => pattern.test(content))) {
    addIssue(issues, { code: 'SKILL_ABSOLUTE_PATH_DETECTED', severity: 'warning', field: 'content' });
  }

  const ordered = sortedIssues(issues);
  return {
    valid: !ordered.some((issue) => issue.severity === 'error'),
    normalizedName,
    parsedName: frontmatter.name,
    parsedDescription: frontmatter.description,
    issues: ordered,
  };
}

function normalizedUnique(values: readonly string[], limit: number, tooManyCode: string): string[] {
  const normalized = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (normalized.length > limit) throw new SkillValidationError(tooManyCode);
  return normalized;
}

function normalizedSources(sources: readonly SkillSourceReference[]): SkillSourceReference[] {
  const result: SkillSourceReference[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const id = source.id.trim();
    if (!id) throw new SkillValidationError('SKILL_SOURCE_ID_REQUIRED');
    const key = `${source.kind}\0${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = source.label?.trim();
    result.push({ kind: source.kind, id, ...(label ? { label } : {}) });
  }
  if (result.length > SKILL_SOURCES_MAX_COUNT) throw new SkillValidationError('SKILL_SOURCES_TOO_MANY');
  return result;
}

export function normalizeSkillCandidateInput(input: SkillCandidateSubmitInput): NormalizedSkillCandidateSubmitInput {
  const operationId = input.operationId.trim();
  if (!operationId) throw new SkillValidationError('SKILL_OPERATION_ID_REQUIRED');

  const proposedName = normalizeSkillName(input.proposedName);
  const description = input.description.trim();
  const content = input.content;
  const validation = validateSkillDraft({ name: proposedName, description, content });

  return {
    operationId,
    proposedName,
    description,
    content,
    requiredTools: normalizedUnique(input.requiredTools, SKILL_TOOLS_MAX_COUNT, 'SKILL_TOOLS_TOO_MANY'),
    permissions: normalizedUnique(input.permissions, SKILL_PERMISSIONS_MAX_COUNT, 'SKILL_PERMISSIONS_TOO_MANY'),
    reason: input.reason.trim(),
    sourceReferences: normalizedSources(input.sourceReferences),
    validation,
  };
}
