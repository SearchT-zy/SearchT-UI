import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureSkillStagingDirectory } from '@process/services/personal-core/content/skills/skillStaging';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('skill staging directory', () => {
  it('creates one non-executable staging location under the selected work directory', () => {
    const workDir = mkdtempSync(path.join(os.tmpdir(), 'searcht-skill-staging-'));
    directories.push(workDir);

    const skillPath = ensureSkillStagingDirectory(workDir);

    expect(skillPath).toBe(path.join(workDir, 'searcht-skill-staging', 'SKILL.md'));
    expect(existsSync(path.dirname(skillPath))).toBe(true);
    expect(ensureSkillStagingDirectory(workDir)).toBe(skillPath);
  });
});
