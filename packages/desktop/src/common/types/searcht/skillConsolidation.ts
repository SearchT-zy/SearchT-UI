export const SKILL_CANDIDATE_STATUSES = ['pending'] as const;
export type SkillCandidateStatus = (typeof SKILL_CANDIDATE_STATUSES)[number];

export const MANAGED_SKILL_STATES = ['active', 'disabled'] as const;
export type ManagedSkillState = (typeof MANAGED_SKILL_STATES)[number];

export const SKILL_SOURCE_KINDS = ['conversation', 'cron', 'workflow-run', 'manual', 'imported-skill'] as const;
export type SkillSourceKind = (typeof SKILL_SOURCE_KINDS)[number];

export type SkillSourceReference = {
  kind: SkillSourceKind;
  id: string;
  label?: string;
};

export type SkillValidationIssueSeverity = 'error' | 'warning';
export type SkillValidationIssueField = 'name' | 'description' | 'content';

export type SkillValidationIssueCode =
  | 'SKILL_NAME_REQUIRED'
  | 'SKILL_NAME_INVALID'
  | 'SKILL_NAME_TOO_LONG'
  | 'SKILL_DESCRIPTION_REQUIRED'
  | 'SKILL_DESCRIPTION_TOO_LONG'
  | 'SKILL_CONTENT_REQUIRED'
  | 'SKILL_CONTENT_TOO_LARGE'
  | 'SKILL_FRONTMATTER_INVALID'
  | 'SKILL_FRONTMATTER_NAME_REQUIRED'
  | 'SKILL_FRONTMATTER_DESCRIPTION_REQUIRED'
  | 'SKILL_FRONTMATTER_NAME_MISMATCH'
  | 'SKILL_TEMPLATE_PLACEHOLDER'
  | 'SKILL_SECRET_DETECTED'
  | 'SKILL_ABSOLUTE_PATH_DETECTED';

export type SkillValidationIssue = {
  code: SkillValidationIssueCode;
  severity: SkillValidationIssueSeverity;
  field: SkillValidationIssueField;
};

export type SkillValidationReport = {
  valid: boolean;
  normalizedName: string | null;
  parsedName: string | null;
  parsedDescription: string | null;
  issues: SkillValidationIssue[];
};

export type SkillDraftInput = {
  name: string;
  description: string;
  content: string;
};

export type SkillCandidateSubmitInput = {
  operationId: string;
  proposedName: string;
  description: string;
  content: string;
  requiredTools: string[];
  permissions: string[];
  reason: string;
  sourceReferences: SkillSourceReference[];
};

export type NormalizedSkillCandidateSubmitInput = Omit<SkillCandidateSubmitInput, 'proposedName'> & {
  proposedName: string;
  validation: SkillValidationReport;
};

export type SkillCandidate = NormalizedSkillCandidateSubmitInput & {
  id: string;
  status: SkillCandidateStatus;
  createdAt: number;
  updatedAt: number;
};

export type SkillCandidateUpdateInput = {
  id: string;
  proposedName: string;
  description: string;
  content: string;
  requiredTools: string[];
  permissions: string[];
  reason: string;
  sourceReferences: SkillSourceReference[];
};

export type SkillCandidateListQuery = {
  limit?: number;
};

export type SkillCandidateListResult = {
  candidates: SkillCandidate[];
  total: number;
};

export type ManagedSkill = {
  id: string;
  slug: string;
  description: string;
  state: ManagedSkillState;
  activeVersionId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type SkillVersion = {
  id: string;
  skillId: string;
  versionNumber: number;
  content: string;
  contentHash: string;
  requiredTools: string[];
  permissions: string[];
  sourceReferences: SkillSourceReference[];
  validation: SkillValidationReport;
  changeSummary: string;
  candidateId: string | null;
  createdAt: number;
  publishedAt: number;
};

export type ManagedSkillListResult = {
  skills: ManagedSkill[];
  total: number;
};

export type SkillVersionListResult = {
  versions: SkillVersion[];
  total: number;
};

export type SkillPublishInput = {
  candidateId: string;
  installedSlug: string;
  content: string;
  changeSummary: string;
};

export type SkillPublishResult = {
  skill: ManagedSkill;
  version: SkillVersion;
};

export type SkillRollbackInput = {
  skillId: string;
  versionId: string;
  installedSlug: string;
  changeSummary: string;
};

export type SkillStateUpdateInput = {
  skillId: string;
  state: ManagedSkillState;
};

export type SkillLifecycleStatus = {
  pendingCount: number;
  activeCount: number;
  disabledCount: number;
};

export type SkillLifecycleClient = {
  listCandidates(query?: SkillCandidateListQuery): Promise<SkillCandidateListResult>;
  getCandidate(id: string): Promise<SkillCandidate | null>;
  submitCandidate(input: SkillCandidateSubmitInput): Promise<SkillCandidate>;
  updateCandidate(input: SkillCandidateUpdateInput): Promise<SkillCandidate>;
  rejectCandidate(id: string): Promise<void>;
  listManagedSkills(): Promise<ManagedSkillListResult>;
  getManagedSkill(idOrSlug: string): Promise<ManagedSkill | null>;
  listVersions(skillId: string): Promise<SkillVersionListResult>;
  getVersion(id: string): Promise<SkillVersion | null>;
  publishCandidate(input: SkillPublishInput): Promise<SkillPublishResult>;
  rollback(input: SkillRollbackInput): Promise<SkillPublishResult>;
  updateState(input: SkillStateUpdateInput): Promise<ManagedSkill>;
  getStatus(): Promise<SkillLifecycleStatus>;
};
