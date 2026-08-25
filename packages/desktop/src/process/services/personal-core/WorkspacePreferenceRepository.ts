import { randomUUID } from 'node:crypto';
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  PERSONAL_MODULE_IDS,
  SEARCHT_CONNECTOR_INTERESTS,
  type PersonalModuleId,
  type PersonalScenePack,
  type PersonalStartPage,
  type WorkspacePreferences,
  type SearchtConnectorInterest,
  type SearchtModelBoundary,
} from '@/common/types/searcht/workspace';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';

const PREFERENCE_KEY = 'workspace.preferences.v1';
const START_PAGES = [...PERSONAL_MODULE_IDS, 'guid'] as const;
const SCENE_PACKS = ['general', 'creator', 'manager', 'researcher'] as const;
const MODEL_BOUNDARIES = ['included-cloud', 'own-key', 'local-only', 'undecided'] as const;

type PreferenceRow = { value_json: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isModuleId(value: unknown): value is PersonalModuleId {
  return typeof value === 'string' && PERSONAL_MODULE_IDS.includes(value as PersonalModuleId);
}

function isStartPage(value: unknown): value is PersonalStartPage {
  return typeof value === 'string' && START_PAGES.includes(value as PersonalStartPage);
}

function isScenePack(value: unknown): value is PersonalScenePack {
  return typeof value === 'string' && SCENE_PACKS.includes(value as PersonalScenePack);
}

function isModelBoundary(value: unknown): value is SearchtModelBoundary {
  return typeof value === 'string' && MODEL_BOUNDARIES.includes(value as SearchtModelBoundary);
}

function isConnectorInterest(value: unknown): value is SearchtConnectorInterest {
  return typeof value === 'string' && SEARCHT_CONNECTOR_INTERESTS.includes(value as SearchtConnectorInterest);
}

function cloneDefaults(): WorkspacePreferences {
  return {
    visibleModules: { ...DEFAULT_WORKSPACE_PREFERENCES.visibleModules },
    navigationOrder: [...DEFAULT_WORKSPACE_PREFERENCES.navigationOrder],
    startPage: DEFAULT_WORKSPACE_PREFERENCES.startPage,
    scenePack: DEFAULT_WORKSPACE_PREFERENCES.scenePack,
    onboardingCompleted: DEFAULT_WORKSPACE_PREFERENCES.onboardingCompleted,
    onboardingVersion: DEFAULT_WORKSPACE_PREFERENCES.onboardingVersion,
    modelBoundary: DEFAULT_WORKSPACE_PREFERENCES.modelBoundary,
    cloudConsentGranted: DEFAULT_WORKSPACE_PREFERENCES.cloudConsentGranted,
    connectorInterests: [...DEFAULT_WORKSPACE_PREFERENCES.connectorInterests],
    permissionsReviewed: DEFAULT_WORKSPACE_PREFERENCES.permissionsReviewed,
  };
}

function normalizeNavigationOrder(value: unknown): PersonalModuleId[] {
  const normalized: PersonalModuleId[] = [];
  if (Array.isArray(value)) {
    for (const moduleId of value) {
      if (isModuleId(moduleId) && !normalized.includes(moduleId)) normalized.push(moduleId);
    }
  }
  for (const moduleId of PERSONAL_MODULE_IDS) {
    if (!normalized.includes(moduleId)) normalized.push(moduleId);
  }
  return normalized;
}

function normalizeStoredPreferences(value: unknown): WorkspacePreferences {
  const normalized = cloneDefaults();
  if (!isRecord(value)) return normalized;

  if (isRecord(value.visibleModules)) {
    for (const moduleId of PERSONAL_MODULE_IDS) {
      if (typeof value.visibleModules[moduleId] === 'boolean') {
        normalized.visibleModules[moduleId] = value.visibleModules[moduleId];
      }
    }
  }
  normalized.navigationOrder = normalizeNavigationOrder(value.navigationOrder);
  if (isStartPage(value.startPage)) normalized.startPage = value.startPage;
  if (isScenePack(value.scenePack)) normalized.scenePack = value.scenePack;
  if (typeof value.onboardingCompleted === 'boolean') normalized.onboardingCompleted = value.onboardingCompleted;
  if (typeof value.onboardingVersion === 'number' && Number.isInteger(value.onboardingVersion)) {
    normalized.onboardingVersion = value.onboardingVersion;
  }
  if (isModelBoundary(value.modelBoundary)) normalized.modelBoundary = value.modelBoundary;
  if (typeof value.cloudConsentGranted === 'boolean') normalized.cloudConsentGranted = value.cloudConsentGranted;
  if (Array.isArray(value.connectorInterests)) {
    normalized.connectorInterests = value.connectorInterests.filter(isConnectorInterest);
  }
  if (typeof value.permissionsReviewed === 'boolean') normalized.permissionsReviewed = value.permissionsReviewed;
  return normalized;
}

export class WorkspacePreferenceRepository {
  constructor(private readonly driver: ISqliteDriver) {}

  get(): WorkspacePreferences {
    const row = this.driver.prepare('SELECT value_json FROM workspace_preferences WHERE key = ?').get(PREFERENCE_KEY) as
      | PreferenceRow
      | undefined;
    if (!row) return cloneDefaults();

    try {
      return normalizeStoredPreferences(JSON.parse(row.value_json) as unknown);
    } catch (error) {
      const recovered = cloneDefaults();
      const now = Date.now();
      this.driver.transaction(() => {
        this.write(recovered, now);
        this.driver
          .prepare(
            'INSERT INTO personal_audit_log (id, action, outcome, detail_json, created_at) VALUES (?, ?, ?, ?, ?)'
          )
          .run(
            randomUUID(),
            'preference_recovery',
            'recovered',
            JSON.stringify({ reason: error instanceof Error ? error.message : 'Malformed preference JSON' }),
            now
          );
      })();
      return recovered;
    }
  }

  set(preferences: WorkspacePreferences): WorkspacePreferences {
    if (!isStartPage(preferences.startPage)) throw new Error('Invalid SearchT-UI start page');
    if (!isScenePack(preferences.scenePack)) throw new Error('Invalid SearchT-UI scene pack');

    const saved = normalizeStoredPreferences(preferences);
    this.write(saved, Date.now());
    return saved;
  }

  private write(preferences: WorkspacePreferences, updatedAt: number): void {
    this.driver
      .prepare(
        `INSERT INTO workspace_preferences (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
      )
      .run(PREFERENCE_KEY, JSON.stringify(preferences), updatedAt);
  }
}
