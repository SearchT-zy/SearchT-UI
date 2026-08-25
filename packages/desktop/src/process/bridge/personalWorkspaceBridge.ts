import { existsSync } from 'node:fs';
import { app } from 'electron';
import { ipcBridge } from '@/common';
import { initSchema } from '@process/services/database/schema';
import { BetterSqlite3Driver } from '@process/services/database/drivers/BetterSqlite3Driver';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import { resolveLegacyDatabasePath, ensureSystemUser } from '@process/services/database/runLegacyDatabaseMigrations';
import { getConfigPath } from '@process/utils';
import {
  SearchtMigrationService,
  SqliteSourceCatalog,
  SqliteTargetCatalog,
} from '@process/services/personal-core/searchtMigration/SearchtMigrationService';
import {
  NodeSearchtMigrationFileIO,
  SqliteSearchtImportReportStore,
} from '@process/services/personal-core/searchtMigration/SearchtMigrationStore';
import type {
  SearchtImportDiscovery,
  SearchtImportPlan,
  SearchtImportReport,
  PersonalBackupResult,
  PersonalCoreHealth,
  WorkspacePreferences,
} from '@/common/types/searcht/workspace';
import type {
  CollaborationAppendEventInput,
  CollaborationCreateInput,
  CollaborationDelivery,
  CollaborationDeliveryUpdate,
  CollaborationInviteCode,
  CollaborationInviteCreateInput,
  CollaborationJoinInput,
  CollaborationJoinResult,
  CollaborationMember,
  CollaborationMessage,
  CollaborationRunDeliveryUpdate,
  CollaborationSnapshot,
} from '@/common/types/searcht/collaboration';
import { discoverSearchtImport } from '@process/services/personal-core/importDiscovery';
import { getPersonalDatabase } from '@process/services/personal-core';
import { CollaborationRepository } from '@process/services/personal-core/content/collaboration/CollaborationRepository';
import { CollaborationService } from '@process/services/personal-core/content/collaboration/CollaborationService';
import { WorkspacePreferenceRepository } from '@process/services/personal-core/WorkspacePreferenceRepository';

type PersonalWorkspaceBridgeDependencies = {
  repository: {
    get: () => WorkspacePreferences;
    set: (preferences: WorkspacePreferences) => WorkspacePreferences;
  };
  database: {
    health: () => PersonalCoreHealth;
    backup: (reason: string) => Promise<PersonalBackupResult>;
  };
  discoverImport: () => SearchtImportDiscovery;
  migration?: {
    plan: () => SearchtImportPlan;
    execute: () => SearchtImportReport;
    listRecent: (limit?: number) => SearchtImportReport[];
    rollback: (id: string) => SearchtImportReport;
  };
};

export type PersonalWorkspaceBridgeHandlers = {
  getPreferences: () => Promise<WorkspacePreferences>;
  setPreferences: (preferences: WorkspacePreferences) => Promise<WorkspacePreferences>;
  getHealth: () => Promise<PersonalCoreHealth>;
  createBackup: () => Promise<PersonalBackupResult>;
  discoverSearchtImport: () => Promise<SearchtImportDiscovery>;
  planSearchtImport: () => Promise<SearchtImportPlan>;
  runSearchtImport: () => Promise<SearchtImportReport>;
  listSearchtImports: () => Promise<SearchtImportReport[]>;
  rollbackSearchtImport: (input: { id: string }) => Promise<SearchtImportReport>;
};

type CollaborationBridgeDependencies = {
  service: {
    list: (teamId: string, limit?: number) => CollaborationSnapshot;
    createInstruction: (input: CollaborationCreateInput) => CollaborationSnapshot;
    appendEvent: (input: CollaborationAppendEventInput) => CollaborationMessage;
    updateDelivery: (input: CollaborationDeliveryUpdate) => CollaborationDelivery;
    updateDeliveryByRun: (input: CollaborationRunDeliveryUpdate) => CollaborationDelivery[];
    removeTeam: (teamId: string) => void;
    listMembers: (teamId: string) => CollaborationMember[];
    createInviteCode: (input: CollaborationInviteCreateInput) => CollaborationInviteCode;
    listInviteCodes: (teamId: string) => CollaborationInviteCode[];
    revokeInviteCode: (input: { id: string }) => CollaborationInviteCode;
    joinByInviteCode: (input: CollaborationJoinInput) => CollaborationJoinResult;
    removeMember: (input: { teamId: string; memberId: string }) => void;
  };
};

export type CollaborationBridgeHandlers = {
  list: (input: { teamId: string; limit?: number }) => Promise<CollaborationSnapshot>;
  createInstruction: (input: CollaborationCreateInput) => Promise<CollaborationSnapshot>;
  appendEvent: (input: CollaborationAppendEventInput) => Promise<CollaborationMessage>;
  updateDelivery: (input: CollaborationDeliveryUpdate) => Promise<CollaborationDelivery>;
  updateDeliveryByRun: (input: CollaborationRunDeliveryUpdate) => Promise<CollaborationDelivery[]>;
  removeTeam: (input: { teamId: string }) => Promise<void>;
  listMembers: (input: { teamId: string }) => Promise<CollaborationMember[]>;
  createInviteCode: (input: CollaborationInviteCreateInput) => Promise<CollaborationInviteCode>;
  listInviteCodes: (input: { teamId: string }) => Promise<CollaborationInviteCode[]>;
  revokeInviteCode: (input: { id: string }) => Promise<CollaborationInviteCode>;
  joinByInviteCode: (input: CollaborationJoinInput) => Promise<CollaborationJoinResult>;
  removeMember: (input: { teamId: string; memberId: string }) => Promise<void>;
};

function getDefaultDependencies(): PersonalWorkspaceBridgeDependencies {
  const database = getPersonalDatabase();
  return {
    repository: new WorkspacePreferenceRepository(database.driver),
    database,
    discoverImport: () => discoverSearchtImport(app.getPath('appData'), existsSync),
    migration: buildDefaultMigration(database.driver),
  };
}

function buildDefaultMigration(personalDriver: ISqliteDriver) {
  const discovery = discoverSearchtImport(app.getPath('appData'), existsSync);
  if (!discovery.available) return null;
  const reportStore = new SqliteSearchtImportReportStore(personalDriver);
  const files = new NodeSearchtMigrationFileIO();
  const sourceConfigDirectory = discovery.configDirectory;

  const withService = <T>(body: (service: SearchtMigrationService) => T): T => {
    const targetDriver = new BetterSqlite3Driver(resolveLegacyDatabasePath());
    try {
      initSchema(targetDriver);
      ensureSystemUser(targetDriver);
      const databaseExists = existsSync(discovery.databasePath);
      const sourceDriver = databaseExists ? new BetterSqlite3Driver(discovery.databasePath) : null;
      try {
        const service = new SearchtMigrationService(
          databaseExists ? discovery.databasePath : null,
          sourceDriver ? new SqliteSourceCatalog(sourceDriver) : null,
          new SqliteTargetCatalog(targetDriver),
          sourceConfigDirectory,
          getConfigPath(),
          files,
          reportStore
        );
        return body(service);
      } finally {
        sourceDriver?.close();
      }
    } finally {
      targetDriver.close();
    }
  };

  return {
    plan: () => withService((service) => service.plan()),
    execute: () => withService((service) => service.execute()),
    listRecent: (limit?: number) => reportStore.listRecent(limit),
    rollback: (id: string) => withService((service) => service.rollback(id)),
  };
}

export function initPersonalWorkspaceBridge(
  dependencies?: PersonalWorkspaceBridgeDependencies
): PersonalWorkspaceBridgeHandlers {
  const getDependencies = (): PersonalWorkspaceBridgeDependencies => dependencies ?? getDefaultDependencies();
  const handlers: PersonalWorkspaceBridgeHandlers = {
    getPreferences: async () => getDependencies().repository.get(),
    setPreferences: async (preferences) => getDependencies().repository.set(preferences),
    getHealth: async () => getDependencies().database.health(),
    createBackup: async () => getDependencies().database.backup('manual'),
    discoverSearchtImport: async () => getDependencies().discoverImport(),
    planSearchtImport: async () => {
      const migration = getDependencies().migration;
      if (!migration) throw new Error('SEARCHT_IMPORT_UNAVAILABLE');
      return migration.plan();
    },
    runSearchtImport: async () => {
      const migration = getDependencies().migration;
      if (!migration) throw new Error('SEARCHT_IMPORT_UNAVAILABLE');
      return migration.execute();
    },
    listSearchtImports: async () => getDependencies().migration?.listRecent() ?? [],
    rollbackSearchtImport: async ({ id }) => {
      const migration = getDependencies().migration;
      if (!migration) throw new Error('SEARCHT_IMPORT_UNAVAILABLE');
      return migration.rollback(id);
    },
  };

  ipcBridge.personalWorkspace.getPreferences.provider(handlers.getPreferences);
  ipcBridge.personalWorkspace.setPreferences.provider(handlers.setPreferences);
  ipcBridge.personalWorkspace.getHealth.provider(handlers.getHealth);
  ipcBridge.personalWorkspace.createBackup.provider(handlers.createBackup);
  ipcBridge.personalWorkspace.discoverSearchtImport.provider(handlers.discoverSearchtImport);
  ipcBridge.personalWorkspace.planSearchtImport.provider(handlers.planSearchtImport);
  ipcBridge.personalWorkspace.runSearchtImport.provider(handlers.runSearchtImport);
  ipcBridge.personalWorkspace.listSearchtImports.provider(handlers.listSearchtImports);
  ipcBridge.personalWorkspace.rollbackSearchtImport.provider(handlers.rollbackSearchtImport);

  return handlers;
}

export function initCollaborationBridge(dependencies?: CollaborationBridgeDependencies): CollaborationBridgeHandlers {
  const getDependencies = (): CollaborationBridgeDependencies => {
    if (dependencies) return dependencies;
    const database = getPersonalDatabase();
    return { service: new CollaborationService(new CollaborationRepository(database.driver)) };
  };
  const handlers: CollaborationBridgeHandlers = {
    list: async ({ teamId, limit }) => getDependencies().service.list(teamId, limit),
    createInstruction: async (input) => getDependencies().service.createInstruction(input),
    appendEvent: async (input) => getDependencies().service.appendEvent(input),
    updateDelivery: async (input) => getDependencies().service.updateDelivery(input),
    updateDeliveryByRun: async (input) => getDependencies().service.updateDeliveryByRun(input),
    removeTeam: async ({ teamId }) => getDependencies().service.removeTeam(teamId),
    listMembers: async ({ teamId }) => getDependencies().service.listMembers(teamId),
    createInviteCode: async (input) => getDependencies().service.createInviteCode(input),
    listInviteCodes: async ({ teamId }) => getDependencies().service.listInviteCodes(teamId),
    revokeInviteCode: async (input) => getDependencies().service.revokeInviteCode(input),
    joinByInviteCode: async (input) => getDependencies().service.joinByInviteCode(input),
    removeMember: async (input) => getDependencies().service.removeMember(input),
  };

  ipcBridge.collaboration.list.provider(handlers.list);
  ipcBridge.collaboration.createInstruction.provider(handlers.createInstruction);
  ipcBridge.collaboration.appendEvent.provider(handlers.appendEvent);
  ipcBridge.collaboration.updateDelivery.provider(handlers.updateDelivery);
  ipcBridge.collaboration.updateDeliveryByRun.provider(handlers.updateDeliveryByRun);
  ipcBridge.collaboration.removeTeam.provider(handlers.removeTeam);
  ipcBridge.collaboration.listMembers.provider(handlers.listMembers);
  ipcBridge.collaboration.createInviteCode.provider(handlers.createInviteCode);
  ipcBridge.collaboration.listInviteCodes.provider(handlers.listInviteCodes);
  ipcBridge.collaboration.revokeInviteCode.provider(handlers.revokeInviteCode);
  ipcBridge.collaboration.joinByInviteCode.provider(handlers.joinByInviteCode);
  ipcBridge.collaboration.removeMember.provider(handlers.removeMember);

  return handlers;
}
