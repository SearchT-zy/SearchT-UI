import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const SKILL_STAGING_DIRECTORY_NAME = 'searcht-skill-staging';

export function ensureSkillStagingDirectory(workDir: string): string {
  const normalizedWorkDir = workDir.trim();
  if (!normalizedWorkDir) throw new Error('SKILL_WORK_DIR_REQUIRED');
  const stagingDirectory = path.join(normalizedWorkDir, SKILL_STAGING_DIRECTORY_NAME);
  mkdirSync(stagingDirectory, { recursive: true });
  return path.join(stagingDirectory, 'SKILL.md');
}
