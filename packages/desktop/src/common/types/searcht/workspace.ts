export const PERSONAL_MODULE_IDS = ['today', 'inbox', 'calendar', 'tasks', 'notes', 'knowledge', 'workflows'] as const;

export type PersonalModuleId = (typeof PERSONAL_MODULE_IDS)[number];
export type PersonalStartPage = PersonalModuleId | 'guid';
export type PersonalScenePack = 'general' | 'creator' | 'manager' | 'researcher';

/** Where AI processing is allowed to happen; cloud transitions need consent. */
export type SearchtModelBoundary = 'included-cloud' | 'own-key' | 'local-only' | 'undecided';

export const SEARCHT_CONNECTOR_INTERESTS = ['email', 'calendar', 'webdav', 's3', 'folder'] as const;

export type SearchtConnectorInterest = (typeof SEARCHT_CONNECTOR_INTERESTS)[number];

export type WorkspacePreferences = {
  visibleModules: Record<PersonalModuleId, boolean>;
  navigationOrder: PersonalModuleId[];
  startPage: PersonalStartPage;
  scenePack: PersonalScenePack;
  onboardingCompleted: boolean;
  onboardingVersion: number;
  modelBoundary: SearchtModelBoundary;
  cloudConsentGranted: boolean;
  connectorInterests: SearchtConnectorInterest[];
  permissionsReviewed: boolean;
};

export type PersonalCoreHealth = { ok: true; version: number };
export type PersonalBackupResult = { path: string; formatVersion: 1 };

export type SearchtImportDiscovery =
  | { available: false }
  | {
      available: true;
      dataDirectory: string;
      databasePath: string;
      configDirectory: string | null;
    };

export const SEARCHT_IMPORT_CATEGORIES = [
  'models',
  'assistants',
  'skills',
  'mcp',
  'conversations',
  'workspaces',
  'themes',
  'scheduled-tasks',
] as const;

export type SearchtImportCategory = (typeof SEARCHT_IMPORT_CATEGORIES)[number];

export type SearchtImportPlanCategory = {
  category: SearchtImportCategory;
  planned: number;
};

export type SearchtImportPlan = {
  databasePath: string;
  configDirectory: string | null;
  categories: SearchtImportPlanCategory[];
};

export type SearchtImportReportCategory = {
  category: SearchtImportCategory;
  planned: number;
  imported: number;
  skipped: number;
  failed: number;
  errors: string[];
};

export type SearchtImportStatus = 'running' | 'succeeded' | 'failed' | 'rolled-back';

export type SearchtImportReport = {
  id: string;
  startedAt: number;
  finishedAt: number;
  status: SearchtImportStatus;
  categories: SearchtImportReportCategory[];
  rollbackAvailable: boolean;
};

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  visibleModules: {
    today: true,
    inbox: true,
    calendar: true,
    tasks: true,
    notes: true,
    knowledge: true,
    workflows: true,
  },
  navigationOrder: [...PERSONAL_MODULE_IDS],
  startPage: 'today',
  scenePack: 'general',
  onboardingCompleted: false,
  onboardingVersion: 2,
  modelBoundary: 'undecided',
  cloudConsentGranted: false,
  connectorInterests: [],
  permissionsReviewed: false,
};
