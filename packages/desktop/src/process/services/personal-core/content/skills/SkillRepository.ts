import type {
  ManagedSkill,
  ManagedSkillState,
  SkillCandidate,
  SkillLifecycleStatus,
  SkillSourceReference,
  SkillValidationReport,
  SkillVersion,
} from '@/common/types/searcht/skillConsolidation';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';

type CandidateRow = {
  id: string;
  operation_id: string;
  proposed_name: string;
  description: string;
  content: string;
  required_tools_json: string;
  permissions_json: string;
  reason: string;
  source_refs_json: string;
  validation_json: string;
  status: SkillCandidate['status'];
  created_at: number;
  updated_at: number;
};

type ManagedSkillRow = {
  id: string;
  slug: string;
  description: string;
  state: ManagedSkillState;
  active_version_id: string | null;
  created_at: number;
  updated_at: number;
};

type SkillVersionRow = {
  id: string;
  skill_id: string;
  version_number: number;
  content: string;
  content_hash: string;
  required_tools_json: string;
  permissions_json: string;
  source_refs_json: string;
  validation_json: string;
  change_summary: string;
  candidate_id: string | null;
  created_at: number;
  published_at: number;
};

export class SkillRepository {
  constructor(private readonly driver: ISqliteDriver) {}

  transaction<T>(operation: () => T): T {
    return this.driver.transaction(operation)();
  }

  insertCandidate(candidate: SkillCandidate): SkillCandidate {
    this.driver
      .prepare(`INSERT INTO skill_candidates (
        id, operation_id, proposed_name, description, content, required_tools_json,
        permissions_json, reason, source_refs_json, validation_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) `)
      .run(...candidateValues(candidate));
    return this.findCandidateById(candidate.id)!;
  }

  updateCandidate(candidate: SkillCandidate): SkillCandidate {
    this.driver
      .prepare(`UPDATE skill_candidates SET operation_id = ?, proposed_name = ?, description = ?, content = ?,
        required_tools_json = ?, permissions_json = ?, reason = ?, source_refs_json = ?, validation_json = ?,
        status = ?, created_at = ?, updated_at = ? WHERE id = ?`)
      .run(
        candidate.operationId,
        candidate.proposedName,
        candidate.description,
        candidate.content,
        JSON.stringify(candidate.requiredTools),
        JSON.stringify(candidate.permissions),
        candidate.reason,
        JSON.stringify(candidate.sourceReferences),
        JSON.stringify(candidate.validation),
        candidate.status,
        candidate.createdAt,
        candidate.updatedAt,
        candidate.id
      );
    return this.findCandidateById(candidate.id)!;
  }

  findCandidateById(id: string): SkillCandidate | null {
    const row = this.driver.prepare('SELECT * FROM skill_candidates WHERE id = ?').get(id) as CandidateRow | undefined;
    return row ? mapCandidate(row) : null;
  }

  findCandidateByOperationId(operationId: string): SkillCandidate | null {
    const row = this.driver.prepare('SELECT * FROM skill_candidates WHERE operation_id = ?').get(operationId) as
      | CandidateRow
      | undefined;
    return row ? mapCandidate(row) : null;
  }

  listCandidates(limit: number): SkillCandidate[] {
    return (
      this.driver
        .prepare('SELECT * FROM skill_candidates ORDER BY updated_at DESC, id LIMIT ?')
        .all(limit) as CandidateRow[]
    ).map(mapCandidate);
  }

  countCandidates(): number {
    return (this.driver.prepare('SELECT COUNT(*) AS count FROM skill_candidates').get() as { count: number }).count;
  }

  deleteCandidate(id: string): void {
    this.driver.prepare('DELETE FROM skill_candidates WHERE id = ?').run(id);
  }

  insertManagedSkill(skill: ManagedSkill): ManagedSkill {
    this.driver
      .prepare(`INSERT INTO managed_skills (
        id, slug, description, state, active_version_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(
        skill.id,
        skill.slug,
        skill.description,
        skill.state,
        skill.activeVersionId,
        skill.createdAt,
        skill.updatedAt
      );
    return this.findManagedSkillById(skill.id)!;
  }

  updateManagedSkill(skill: ManagedSkill): ManagedSkill {
    this.driver
      .prepare(`UPDATE managed_skills SET slug = ?, description = ?, state = ?, active_version_id = ?,
        created_at = ?, updated_at = ? WHERE id = ?`)
      .run(
        skill.slug,
        skill.description,
        skill.state,
        skill.activeVersionId,
        skill.createdAt,
        skill.updatedAt,
        skill.id
      );
    return this.findManagedSkillById(skill.id)!;
  }

  findManagedSkillById(id: string): ManagedSkill | null {
    const row = this.driver.prepare('SELECT * FROM managed_skills WHERE id = ?').get(id) as ManagedSkillRow | undefined;
    return row ? mapManagedSkill(row) : null;
  }

  findManagedSkillBySlug(slug: string): ManagedSkill | null {
    const row = this.driver.prepare('SELECT * FROM managed_skills WHERE slug = ?').get(slug) as
      | ManagedSkillRow
      | undefined;
    return row ? mapManagedSkill(row) : null;
  }

  listManagedSkills(): ManagedSkill[] {
    return (
      this.driver.prepare('SELECT * FROM managed_skills ORDER BY updated_at DESC, id').all() as ManagedSkillRow[]
    ).map(mapManagedSkill);
  }

  insertVersion(version: SkillVersion): SkillVersion {
    this.driver
      .prepare(`INSERT INTO skill_versions (
        id, skill_id, version_number, content, content_hash, required_tools_json, permissions_json,
        source_refs_json, validation_json, change_summary, candidate_id, created_at, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        version.id,
        version.skillId,
        version.versionNumber,
        version.content,
        version.contentHash,
        JSON.stringify(version.requiredTools),
        JSON.stringify(version.permissions),
        JSON.stringify(version.sourceReferences),
        JSON.stringify(version.validation),
        version.changeSummary,
        version.candidateId,
        version.createdAt,
        version.publishedAt
      );
    return this.findVersionById(version.id)!;
  }

  findVersionById(id: string): SkillVersion | null {
    const row = this.driver.prepare('SELECT * FROM skill_versions WHERE id = ?').get(id) as SkillVersionRow | undefined;
    return row ? mapVersion(row) : null;
  }

  listVersions(skillId: string): SkillVersion[] {
    return (
      this.driver
        .prepare('SELECT * FROM skill_versions WHERE skill_id = ? ORDER BY version_number DESC, id')
        .all(skillId) as SkillVersionRow[]
    ).map(mapVersion);
  }

  nextVersionNumber(skillId: string): number {
    const row = this.driver
      .prepare('SELECT COALESCE(MAX(version_number), 0) + 1 AS version_number FROM skill_versions WHERE skill_id = ?')
      .get(skillId) as { version_number: number };
    return row.version_number;
  }

  getStatus(): SkillLifecycleStatus {
    const skillCounts = this.driver
      .prepare(`SELECT
        SUM(CASE WHEN state = 'active' THEN 1 ELSE 0 END) AS active_count,
        SUM(CASE WHEN state = 'disabled' THEN 1 ELSE 0 END) AS disabled_count
        FROM managed_skills`)
      .get() as { active_count: number | null; disabled_count: number | null };
    return {
      pendingCount: this.countCandidates(),
      activeCount: skillCounts.active_count ?? 0,
      disabledCount: skillCounts.disabled_count ?? 0,
    };
  }

  insertAudit(id: string, action: string, detail: Record<string, unknown>, now: number): void {
    this.driver
      .prepare('INSERT INTO personal_audit_log (id, action, outcome, detail_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, action, 'success', JSON.stringify(detail), now);
  }
}

function candidateValues(candidate: SkillCandidate): unknown[] {
  return [
    candidate.id,
    candidate.operationId,
    candidate.proposedName,
    candidate.description,
    candidate.content,
    JSON.stringify(candidate.requiredTools),
    JSON.stringify(candidate.permissions),
    candidate.reason,
    JSON.stringify(candidate.sourceReferences),
    JSON.stringify(candidate.validation),
    candidate.status,
    candidate.createdAt,
    candidate.updatedAt,
  ];
}

function mapCandidate(row: CandidateRow): SkillCandidate {
  return {
    id: row.id,
    operationId: row.operation_id,
    proposedName: row.proposed_name,
    description: row.description,
    content: row.content,
    requiredTools: parseStringArray(row.required_tools_json),
    permissions: parseStringArray(row.permissions_json),
    reason: row.reason,
    sourceReferences: parseJson<SkillSourceReference[]>(row.source_refs_json, 'SKILL_SOURCE_REFS_CORRUPT'),
    validation: parseJson<SkillValidationReport>(row.validation_json, 'SKILL_VALIDATION_CORRUPT'),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapManagedSkill(row: ManagedSkillRow): ManagedSkill {
  return {
    id: row.id,
    slug: row.slug,
    description: row.description,
    state: row.state,
    activeVersionId: row.active_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVersion(row: SkillVersionRow): SkillVersion {
  return {
    id: row.id,
    skillId: row.skill_id,
    versionNumber: row.version_number,
    content: row.content,
    contentHash: row.content_hash,
    requiredTools: parseStringArray(row.required_tools_json),
    permissions: parseStringArray(row.permissions_json),
    sourceReferences: parseJson<SkillSourceReference[]>(row.source_refs_json, 'SKILL_SOURCE_REFS_CORRUPT'),
    validation: parseJson<SkillValidationReport>(row.validation_json, 'SKILL_VALIDATION_CORRUPT'),
    changeSummary: row.change_summary,
    candidateId: row.candidate_id,
    createdAt: row.created_at,
    publishedAt: row.published_at,
  };
}

function parseStringArray(value: string): string[] {
  const parsed = parseJson<unknown>(value, 'SKILL_LIST_CORRUPT');
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) throw new Error('SKILL_LIST_CORRUPT');
  return parsed;
}

function parseJson<T>(value: string, errorCode: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(errorCode);
  }
}
