import { ipcBridge } from '@/common';
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  PERSONAL_MODULE_IDS,
  type PersonalModuleId,
  type WorkspacePreferences,
} from '@/common/types/searcht/workspace';
import { isElectronDesktop } from '@renderer/utils/platform';

const BROWSER_PREFERENCES_KEY = 'searcht.workspace.preferences.v1';
export const WORKSPACE_PREFERENCES_CHANGED_EVENT = 'searcht:workspace-preferences-changed';

export async function loadWorkspacePreferences(): Promise<WorkspacePreferences> {
  if (isElectronDesktop()) return ipcBridge.personalWorkspace.getPreferences.invoke();
  try {
    const value = localStorage.getItem(BROWSER_PREFERENCES_KEY);
    return value ? normalizeBrowserPreferences(JSON.parse(value) as unknown) : cloneDefaults();
  } catch {
    return cloneDefaults();
  }
}

function cloneDefaults(): WorkspacePreferences {
  return {
    ...DEFAULT_WORKSPACE_PREFERENCES,
    visibleModules: { ...DEFAULT_WORKSPACE_PREFERENCES.visibleModules },
    navigationOrder: [...DEFAULT_WORKSPACE_PREFERENCES.navigationOrder],
  };
}

function normalizeBrowserPreferences(value: unknown): WorkspacePreferences {
  const normalized = cloneDefaults();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return normalized;
  const stored = value as Partial<WorkspacePreferences>;
  if (stored.visibleModules && typeof stored.visibleModules === 'object') {
    for (const moduleId of PERSONAL_MODULE_IDS) {
      const visible = (stored.visibleModules as Partial<Record<PersonalModuleId, boolean>>)[moduleId];
      if (typeof visible === 'boolean') normalized.visibleModules[moduleId] = visible;
    }
  }
  const storedOrder = Array.isArray(stored.navigationOrder) ? stored.navigationOrder : [];
  const order = storedOrder.filter(
    (moduleId, index): moduleId is PersonalModuleId =>
      PERSONAL_MODULE_IDS.includes(moduleId as PersonalModuleId) && storedOrder.indexOf(moduleId) === index
  );
  normalized.navigationOrder = [...order, ...PERSONAL_MODULE_IDS.filter((moduleId) => !order.includes(moduleId))];
  if (stored.startPage && [...PERSONAL_MODULE_IDS, 'guid'].includes(stored.startPage))
    normalized.startPage = stored.startPage;
  if (stored.scenePack && ['general', 'creator', 'manager', 'researcher'].includes(stored.scenePack)) {
    normalized.scenePack = stored.scenePack;
  }
  if (typeof stored.onboardingCompleted === 'boolean') normalized.onboardingCompleted = stored.onboardingCompleted;
  if (typeof stored.onboardingVersion === 'number' && Number.isInteger(stored.onboardingVersion)) {
    normalized.onboardingVersion = stored.onboardingVersion;
  }
  return normalized;
}

export async function saveWorkspacePreferences(preferences: WorkspacePreferences): Promise<WorkspacePreferences> {
  const saved = isElectronDesktop()
    ? await ipcBridge.personalWorkspace.setPreferences.invoke(preferences)
    : (() => {
        localStorage.setItem(BROWSER_PREFERENCES_KEY, JSON.stringify(preferences));
        return preferences;
      })();
  window.dispatchEvent(new CustomEvent<WorkspacePreferences>(WORKSPACE_PREFERENCES_CHANGED_EVENT, { detail: saved }));
  return saved;
}
