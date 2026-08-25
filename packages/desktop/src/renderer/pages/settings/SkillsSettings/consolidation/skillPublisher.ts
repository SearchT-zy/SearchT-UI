import { ipcBridge } from '@/common';
import { normalizeSkillName } from '@/common/searcht/skillValidation';

type SystemInfo = {
  workDir: string;
  platform: string;
};

type SkillPaths = {
  user_skills_dir: string;
  builtin_skills_dir: string;
};

type SkillImportResult = {
  skill_name: string;
  skill_names?: string[];
  failed?: Array<{ source_name: string; code: string }>;
};

export type AvailableSkill = {
  name: string;
  description: string;
  location: string;
  relative_location?: string;
  is_auto_inject: boolean;
  is_custom: boolean;
  source: 'builtin' | 'custom' | 'cron' | 'extension';
};

export type SkillPublisherDependencies = {
  getSystemInfo(): Promise<SystemInfo>;
  getSkillPaths(): Promise<SkillPaths>;
  writeFile(input: { path: string; data: string }): Promise<boolean>;
  importSkills(input: { skill_path: string }): Promise<SkillImportResult>;
  listAvailableSkills(): Promise<AvailableSkill[]>;
  deleteSkill(input: { skill_name: string }): Promise<void>;
};

export type SkillDraftPublication = {
  name: string;
  content: string;
};

export type VerifiedSkillPublication = {
  skill: AvailableSkill;
  stagingPath: string;
  installedNew: boolean;
};

export type SkillPublicationResult<T> = VerifiedSkillPublication & {
  commitResult: T;
};

const defaultDependencies: SkillPublisherDependencies = {
  getSystemInfo: () => ipcBridge.application.systemInfo.invoke(),
  getSkillPaths: () => ipcBridge.fs.getSkillPaths.invoke(),
  writeFile: (input) => ipcBridge.fs.writeFile.invoke(input),
  importSkills: (input) => ipcBridge.fs.importSkills.invoke(input),
  listAvailableSkills: () => ipcBridge.fs.listAvailableSkills.invoke(),
  deleteSkill: (input) => ipcBridge.fs.deleteSkill.invoke(input),
};

let fallbackQueue: Promise<void> = Promise.resolve();

export async function publishSkillDraft<T>(
  draft: SkillDraftPublication,
  commit: (publication: VerifiedSkillPublication) => Promise<T>,
  dependencies: SkillPublisherDependencies = defaultDependencies
): Promise<SkillPublicationResult<T>> {
  return withPublicationLock(async () => {
    const name = normalizeSkillName(draft.name);
    const [systemInfo, skillPaths, before] = await Promise.all([
      dependencies.getSystemInfo(),
      dependencies.getSkillPaths(),
      dependencies.listAvailableSkills(),
    ]);
    const stagingPath = buildStagingPath(systemInfo.workDir, systemInfo.platform);
    assertStagingOutsideSkills(stagingPath, skillPaths.user_skills_dir, systemInfo.platform);
    const installedNew = !before.some((skill) => skill.name === name && skill.is_custom);

    const written = await dependencies.writeFile({ path: stagingPath, data: draft.content });
    if (!written) throw new Error('SKILL_STAGING_WRITE_FAILED');

    const imported = await dependencies.importSkills({ skill_path: stagingPath });
    const importedNames = imported.skill_names?.length ? imported.skill_names : [imported.skill_name];
    if (!importedNames.some((importedName) => safelyNormalizeName(importedName) === name)) {
      throw new Error('SKILL_IMPORT_NAME_MISMATCH');
    }

    const catalog = await dependencies.listAvailableSkills();
    const skill = catalog.find((entry) => entry.name === name && entry.is_custom && entry.source === 'custom');
    if (!skill) throw new Error('SKILL_IMPORT_VERIFICATION_FAILED');

    const publication: VerifiedSkillPublication = { skill, stagingPath, installedNew };
    try {
      const commitResult = await commit(publication);
      return { ...publication, commitResult };
    } catch (error) {
      if (installedNew) {
        await dependencies.deleteSkill({ skill_name: name }).catch((): undefined => undefined);
      }
      throw error;
    }
  });
}

function withPublicationLock<T>(operation: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (locks) {
    return new Promise<T>((resolve, reject) => {
      void locks
        .request('searcht-skill-publish', async () => {
          try {
            resolve(await operation());
          } catch (error) {
            reject(error);
          }
        })
        .catch(reject);
    });
  }

  const result = fallbackQueue.then(operation, operation);
  fallbackQueue = result.then(
    (): void => undefined,
    (): void => undefined
  );
  return result;
}

function buildStagingPath(workDir: string, platform: string): string {
  const separator = platform === 'win32' ? '\\' : '/';
  const normalizedWorkDir = workDir.replace(/[\\/]+$/u, '');
  if (!normalizedWorkDir) throw new Error('SKILL_WORK_DIR_REQUIRED');
  return `${normalizedWorkDir}${separator}searcht-skill-staging${separator}SKILL.md`;
}

function assertStagingOutsideSkills(stagingPath: string, userSkillsDir: string, platform: string): void {
  const normalizePath = (value: string) => {
    const normalized = value.replaceAll('\\', '/').replace(/\/+$/u, '');
    return platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
  };
  const staging = normalizePath(stagingPath);
  const skills = normalizePath(userSkillsDir);
  if (!skills) throw new Error('SKILL_USER_DIR_REQUIRED');
  if (staging === skills || staging.startsWith(`${skills}/`)) throw new Error('SKILL_STAGING_INSIDE_USER_SKILLS');
}

function safelyNormalizeName(value: string): string | null {
  try {
    return normalizeSkillName(value);
  } catch {
    return null;
  }
}
