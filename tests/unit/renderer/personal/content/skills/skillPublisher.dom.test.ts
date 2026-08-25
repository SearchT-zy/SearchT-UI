// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  publishSkillDraft,
  type SkillPublisherDependencies,
} from '@renderer/pages/settings/SkillsSettings/consolidation/skillPublisher';

type AvailableSkill = Awaited<ReturnType<SkillPublisherDependencies['listAvailableSkills']>>[number];

function skill(name: string): AvailableSkill {
  return {
    name,
    description: `${name} description`,
    location: `C:\\work\\skills\\${name}`,
    is_auto_inject: false,
    is_custom: true,
    source: 'custom',
  };
}

function dependencies(overrides: Partial<SkillPublisherDependencies> = {}): SkillPublisherDependencies {
  const installed = new Set<string>();
  return {
    getSystemInfo: vi.fn(async () => ({ workDir: 'C:\\work', platform: 'win32' })),
    getSkillPaths: vi.fn(async () => ({ user_skills_dir: 'C:\\work\\skills', builtin_skills_dir: 'C:\\builtin' })),
    writeFile: vi.fn(async () => true),
    importSkills: vi.fn(async () => {
      installed.add('weekly-report');
      return { skill_name: 'weekly-report', skill_names: ['weekly-report'] };
    }),
    listAvailableSkills: vi.fn(async () => [...installed].map(skill)),
    deleteSkill: vi.fn(async ({ skill_name }) => {
      installed.delete(skill_name);
    }),
    ...overrides,
  };
}

const draft = {
  name: 'weekly-report',
  content: '---\nname: weekly-report\ndescription: Weekly report\n---\n\n# Steps',
};

describe('skill publisher', () => {
  it('stages outside the executable skill directory and verifies the imported catalog entry', async () => {
    const deps = dependencies();
    const commit = vi.fn(async () => 'committed');

    const result = await publishSkillDraft(draft, commit, deps);

    expect(deps.writeFile).toHaveBeenCalledWith({
      path: 'C:\\work\\searcht-skill-staging\\SKILL.md',
      data: draft.content,
    });
    expect(deps.importSkills).toHaveBeenCalledWith({
      skill_path: 'C:\\work\\searcht-skill-staging\\SKILL.md',
    });
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({ skill: expect.objectContaining({ name: draft.name }) })
    );
    expect(result).toMatchObject({ commitResult: 'committed', installedNew: true });
  });

  it('serializes publications that share the staging file', async () => {
    let activeImports = 0;
    let maxActiveImports = 0;
    const deps = dependencies({
      importSkills: vi.fn(async () => {
        activeImports += 1;
        maxActiveImports = Math.max(maxActiveImports, activeImports);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeImports -= 1;
        return { skill_name: 'weekly-report', skill_names: ['weekly-report'] };
      }),
      listAvailableSkills: vi.fn(async () => [skill('weekly-report')]),
    });

    await Promise.all([
      publishSkillDraft(draft, async () => 'first', deps),
      publishSkillDraft(draft, async () => 'second', deps),
    ]);

    expect(maxActiveImports).toBe(1);
  });

  it('rejects mismatched import names and failed catalog verification', async () => {
    const mismatched = dependencies({
      importSkills: vi.fn(async () => ({ skill_name: 'other-skill', skill_names: ['other-skill'] })),
      listAvailableSkills: vi.fn(async () => [skill('weekly-report')]),
    });
    await expect(publishSkillDraft(draft, async () => undefined, mismatched)).rejects.toThrow(
      'SKILL_IMPORT_NAME_MISMATCH'
    );

    const missing = dependencies({ listAvailableSkills: vi.fn(async () => []) });
    await expect(publishSkillDraft(draft, async () => undefined, missing)).rejects.toThrow(
      'SKILL_IMPORT_VERIFICATION_FAILED'
    );
  });

  it('removes only a newly installed skill when lifecycle commit fails', async () => {
    const newlyInstalled = dependencies();
    await expect(
      publishSkillDraft(
        draft,
        async () => {
          throw new Error('LIFECYCLE_COMMIT_FAILED');
        },
        newlyInstalled
      )
    ).rejects.toThrow('LIFECYCLE_COMMIT_FAILED');
    expect(newlyInstalled.deleteSkill).toHaveBeenCalledWith({ skill_name: 'weekly-report' });

    const existing = dependencies({ listAvailableSkills: vi.fn(async () => [skill('weekly-report')]) });
    await expect(
      publishSkillDraft(
        draft,
        async () => {
          throw new Error('LIFECYCLE_COMMIT_FAILED');
        },
        existing
      )
    ).rejects.toThrow('LIFECYCLE_COMMIT_FAILED');
    expect(existing.deleteSkill).not.toHaveBeenCalled();
  });
});
