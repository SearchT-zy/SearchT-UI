import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import {
  CURRENT_DB_VERSION,
  getDatabaseVersion,
  initSchema,
  setDatabaseVersion,
} from '@process/services/database/schema';
import { runMigrations } from '@process/services/database/migrations';
import { BetterSqlite3Driver } from '@process/services/database/drivers/BetterSqlite3Driver';
import {
  SearchtMigrationService,
  encodeConfigFile,
  SqliteSourceCatalog,
  SqliteTargetCatalog,
  type SearchtMigrationFileIO,
} from '@process/services/personal-core/searchtMigration/SearchtMigrationService';
import {
  NodeSearchtMigrationFileIO,
  SqliteSearchtImportReportStore,
} from '@process/services/personal-core/searchtMigration/SearchtMigrationStore';
import { ensureSystemUser } from '@process/services/database/runLegacyDatabaseMigrations';

function buildFullCatalog(driver: BetterSqlite3Driver): void {
  initSchema(driver);
  const version = getDatabaseVersion(driver);
  if (version < CURRENT_DB_VERSION) {
    runMigrations(driver, version, CURRENT_DB_VERSION);
    setDatabaseVersion(driver, CURRENT_DB_VERSION);
  }
}

let directory: string;
let personal: PersonalDatabase;
let sourceDriver: BetterSqlite3Driver;
let targetDriver: BetterSqlite3Driver;
let files: SearchtMigrationFileIO;
let store: SqliteSearchtImportReportStore;

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-searcht-import-'));
  personal = PersonalDatabase.open(directory);
  // The legacy install keeps the pre-migration baseline catalog, while the
  // SearchT-UI engine runs the fully migrated v26 schema. The importer must copy
  // the intersecting columns without touching the newer-only ones.
  sourceDriver = new BetterSqlite3Driver(path.join(directory, 'source-aionui.db'));
  initSchema(sourceDriver);
  targetDriver = new BetterSqlite3Driver(path.join(directory, 'target-aionui.db'));
  buildFullCatalog(targetDriver);
  ensureSystemUser(targetDriver);
  files = new NodeSearchtMigrationFileIO();
  store = new SqliteSearchtImportReportStore(personal.driver, () => 1_000);
});

afterEach(() => {
  sourceDriver.close();
  targetDriver.close();
  personal.close();
  rmSync(directory, { recursive: true, force: true });
});

function makeService(): SearchtMigrationService {
  return new SearchtMigrationService(
    path.join(directory, 'source-aionui.db'),
    new SqliteSourceCatalog(sourceDriver),
    new SqliteTargetCatalog(targetDriver),
    path.join(directory, 'legacy-config'),
    path.join(directory, 'searcht-config'),
    files,
    store,
    { now: () => 1_000, randomUUID: () => 'import-1' }
  );
}

function seedLegacyData(): void {
  const now = 1;
  sourceDriver
    .prepare(
      `INSERT INTO users (id, username, email, password_hash, avatar_path, created_at, updated_at, last_login, jwt_secret)
       VALUES ('legacy-user', 'legacy-user', NULL, '', NULL, ${now}, ${now}, NULL, NULL)`
    )
    .run();
  sourceDriver
    .prepare(
      `INSERT INTO conversations (id, user_id, name, type, extra, model, status, source, channel_chat_id, pinned, pinned_at, created_at, updated_at)
       VALUES ('conv-1', 'legacy-user', 'Old chat', 'agent', '{}', 'gpt', 'finished', NULL, NULL, 0, NULL, 1, 1)`
    )
    .run();
  sourceDriver
    .prepare(
      `INSERT INTO messages (id, conversation_id, msg_id, type, content, position, status, created_at)
       VALUES ('msg-1', 'conv-1', 'm1', 'text', 'hello', 'right', 'finish', 1)`
    )
    .run();
  sourceDriver
    .prepare(
      `INSERT INTO teams (id, user_id, name, workspace, workspace_mode, agents, lead_agent_id, session_mode, agents_version, created_at, updated_at)
       VALUES ('team-1', 'legacy-user', 'Launch', 'C:\\w', 'shared', '[]', NULL, NULL, '1.0.0', 1, 1)`
    )
    .run();

  const legacyConfig = path.join(directory, 'legacy-config');
  mkdirSync(path.join(legacyConfig, 'skills', 'my-skill'), { recursive: true });
  writeFileSync(
    path.join(legacyConfig, 'aionui-config.txt'),
    encodeConfigFile({
      'model.config': { providers: [{ id: 'p1' }] },
      'mcp.config': [{ id: 'mcp-1' }],
      'theme.activeId': 'midnight',
      'theme.userThemes': [{ id: 'midnight', name: 'Midnight' }],
    })
  );
  writeFileSync(
    path.join(legacyConfig, 'aionui-chat.txt'),
    encodeConfigFile({ 'conv-1': { id: 'conv-1', name: 'Old chat' } })
  );
  writeFileSync(path.join(legacyConfig, 'skills', 'my-skill', 'SKILL.md'), '# my skill');
}

describe('SearchtMigrationService', () => {
  it('plans categories from the legacy database and config directory', () => {
    seedLegacyData();
    const plan = makeService().plan();

    const byCategory = new Map(plan.categories.map((entry) => [entry.category, entry.planned]));
    expect(byCategory.get('conversations')).toBe(3); // conversation row + message row + chat list entry
    expect(byCategory.get('workspaces')).toBe(1);
    expect(byCategory.get('skills')).toBe(1); // skills dir file
    expect(byCategory.get('models')).toBe(1);
    expect(byCategory.get('mcp')).toBe(1);
    expect(byCategory.get('themes')).toBe(2);
    expect(byCategory.has('scheduled-tasks')).toBe(false); // legacy catalog predates cron_jobs
    expect(plan.configDirectory).toBe(path.join(directory, 'legacy-config'));
  });

  it('imports legacy rows non-destructively and remaps the user id', () => {
    seedLegacyData();
    const report = makeService().execute();

    expect(report.status).toBe('succeeded');
    const conversations = report.categories.find((entry) => entry.category === 'conversations')!;
    expect(conversations.imported).toBe(3);
    const conversation = targetDriver.prepare("SELECT * FROM conversations WHERE id = 'conv-1'").get() as {
      user_id: string;
      name: string;
    };
    expect(conversation.user_id).toBe('system_default_user');
    expect(conversation.name).toBe('Old chat');
    expect(targetDriver.prepare("SELECT COUNT(*) AS count FROM messages WHERE id = 'msg-1'").get()).toEqual({
      count: 1,
    });
    expect(targetDriver.prepare("SELECT COUNT(*) AS count FROM teams WHERE id = 'team-1'").get()).toEqual({
      count: 1,
    });
    const targetConfig = files.readFile(path.join(directory, 'searcht-config', 'aionui-config.txt'));
    expect(JSON.parse(decodeURIComponent(atob(targetConfig.trim())))).toMatchObject({
      'model.config': { providers: [{ id: 'p1' }] },
      'mcp.config': [{ id: 'mcp-1' }],
    });
    expect(files.exists(path.join(directory, 'searcht-config', 'skills', 'my-skill', 'SKILL.md'))).toBe(true);

    const legacyConfigStillThere = files.readFile(path.join(directory, 'legacy-config', 'aionui-config.txt'));
    expect(legacyConfigStillThere.length).toBeGreaterThan(0);
    const legacyCounts = sourceDriver.prepare('SELECT COUNT(*) AS count FROM conversations').get();
    expect(legacyCounts).toEqual({ count: 1 });
  });

  it('is idempotent: a second run skips already imported rows and files', () => {
    seedLegacyData();
    const service = makeService();
    service.execute();
    const second = service.execute();

    const conversations = second.categories.find((entry) => entry.category === 'conversations')!;
    expect(conversations.imported).toBe(0);
    expect(conversations.skipped).toBe(3);
    expect(targetDriver.prepare('SELECT COUNT(*) AS count FROM conversations').get()).toEqual({ count: 1 });
  });

  it('rolls back imported rows, merged config keys and copied files', () => {
    seedLegacyData();
    const service = makeService();
    const report = service.execute();

    const rolledBack = service.rollback(report.id);

    expect(rolledBack.status).toBe('rolled-back');
    expect(targetDriver.prepare("SELECT COUNT(*) AS count FROM conversations WHERE id = 'conv-1'").get()).toEqual({
      count: 0,
    });
    expect(targetDriver.prepare("SELECT COUNT(*) AS count FROM messages WHERE id = 'msg-1'").get()).toEqual({
      count: 0,
    });
    expect(files.exists(path.join(directory, 'searcht-config', 'aionui-config.txt'))).toBe(false);
    expect(files.exists(path.join(directory, 'searcht-config', 'skills', 'my-skill', 'SKILL.md'))).toBe(false);
    expect(() => service.rollback(report.id)).toThrow('SEARCHT_IMPORT_ALREADY_ROLLED_BACK');
  });

  it('keeps target-owned model providers untouched', () => {
    seedLegacyData();
    const targetConfig = path.join(directory, 'searcht-config');
    mkdirSync(targetConfig, { recursive: true });
    writeFileSync(
      path.join(targetConfig, 'aionui-config.txt'),
      encodeConfigFile({ 'migration.providersMigrated_v1': true })
    );

    const report = makeService().execute();

    const models = report.categories.find((entry) => entry.category === 'models')!;
    expect(models.imported).toBe(0);
    expect(models.skipped).toBe(1);
  });
});
