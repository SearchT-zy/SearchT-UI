/**
 * Local-machine functional E2E for the new SearchT-UI features, run against a
 * COPY of the real dev databases via the Electron runtime (so the
 * Electron-built better-sqlite3 native module loads).
 *
 *   ELECTRON_RUN_AS_NODE=1 electron.exe node_modules/tsx/dist/cli.mjs scripts/e2e/local-machine-e2e.ts
 *
 * Covers: schema v12→v13 migration on real data, group invite codes,
 * SearchT-UI one-shot import + rollback with a fabricated upstream install,
 * and cloud sync end-to-end encryption on the real personal catalog.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
function report(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

async function load<T>(id: string): Promise<T> {
  return (await import(id)) as T;
}

const appData = process.env.APPDATA!;
const devDataRoot = path.join(appData, 'SearchT-UI-Dev');
// SEARCHT_E2E_PERSONAL_DIR points at a personal-core directory to copy and
// exercise (defaults to the dev profile; the installed release profile can be
// passed to validate production data as well).
const realPersonalDb = process.env.SEARCHT_E2E_PERSONAL_DIR
  ? path.join(process.env.SEARCHT_E2E_PERSONAL_DIR, 'searcht-personal.db')
  : path.join(devDataRoot, 'searcht', 'personal-core', 'searcht-personal.db');

if (!existsSync(realPersonalDb)) {
  console.error(`real dev personal db not found: ${realPersonalDb}`);
  process.exit(1);
}

const work = mkdtempSync(path.join(os.tmpdir(), 'searcht-local-e2e-'));
const personalCopyDir = path.join(work, 'personal-core-data');
mkdirSync(personalCopyDir, { recursive: true });
cpSync(path.dirname(realPersonalDb), path.join(personalCopyDir, 'personal-core'), { recursive: true });
console.log(`working copy: ${work}`);

async function main(): Promise<void> {
  const { PersonalDatabase } = await load<typeof import('@process/services/personal-core/PersonalDatabase')>(
    '@process/services/personal-core/PersonalDatabase'
  );
  const { CollaborationService } = await load<
    typeof import('@process/services/personal-core/content/collaboration/CollaborationService')
  >('@process/services/personal-core/content/collaboration/CollaborationService');
  const { CollaborationRepository } = await load<
    typeof import('@process/services/personal-core/content/collaboration/CollaborationRepository')
  >('@process/services/personal-core/content/collaboration/CollaborationRepository');

  // --- 1. Real-data migration to v13 -----------------------------------------
  const personal = PersonalDatabase.open(personalCopyDir);
  const health = personal.health();
  report('real dev personal db migrated to v13', health.ok && health.version === 13, `version=${health.version}`);
  const inviteTable = personal.driver
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('collaboration_members','collaboration_invite_codes','cloud_sync_state','cloud_sync_outbox','cloud_sync_base','searcht_import_reports')"
    )
    .all() as Array<{ name: string }>;
  report('v13 tables present on migrated catalog', inviteTable.length === 6, inviteTable.map((r) => r.name).join(','));

  // --- 2. Group invite codes on real catalog ---------------------------------
  const collaboration = new CollaborationService(new CollaborationRepository(personal.driver));
  const invite = collaboration.createInviteCode({ teamId: 'e2e-team', maxUses: 2, expiresInDays: 1 });
  const joined = collaboration.joinByInviteCode({ code: invite.code, displayName: 'E2E Tester' });
  const members = collaboration.listMembers('e2e-team');
  const snapshot = collaboration.list('e2e-team');
  report(
    'invite create/join/list on real catalog',
    /^ZX-/.test(invite.code) && joined.member.displayName === 'E2E Tester' && members.length === 1,
    `code=${invite.code} members=${members.length}`
  );
  const joinNotice = snapshot.messages.some((message) => message.content.includes('E2E Tester'));
  report('join notice recorded in timeline', joinNotice);
  collaboration.removeMember({ teamId: 'e2e-team', memberId: joined.member.id });
  let removalGuardHeld = true;
  try {
    collaboration.removeMember({ teamId: 'e2e-team', memberId: 'missing' });
    removalGuardHeld = false;
  } catch {
    removalGuardHeld = true;
  }
  report('member removal + missing-id guard', collaboration.listMembers('e2e-team').length === 0 && removalGuardHeld);

  // --- 3. SearchT-UI import + rollback with fabricated upstream install ----------
  const legacyRoot = path.join(work, 'legacy-roaming');
  const legacyData = path.join(legacyRoot, 'AionUi', 'aionui');
  const legacyConfig = path.join(legacyRoot, 'AionUi', 'config');
  mkdirSync(legacyData, { recursive: true });
  mkdirSync(path.join(legacyConfig, 'skills', 'e2e-skill'), { recursive: true });
  const { initSchema, CURRENT_DB_VERSION, getDatabaseVersion, setDatabaseVersion } = await load<
    typeof import('@process/services/database/schema')
  >('@process/services/database/schema');
  const { runMigrations } = await load<typeof import('@process/services/database/migrations')>(
    '@process/services/database/migrations'
  );
  const { BetterSqlite3Driver } = await load<typeof import('@process/services/database/drivers/BetterSqlite3Driver')>(
    '@process/services/database/drivers/BetterSqlite3Driver'
  );
  const legacyDb = new BetterSqlite3Driver(path.join(legacyData, 'aionui.db'));
  initSchema(legacyDb);
  const legacyVersion = getDatabaseVersion(legacyDb);
  if (legacyVersion < CURRENT_DB_VERSION) {
    runMigrations(legacyDb, legacyVersion, CURRENT_DB_VERSION);
    setDatabaseVersion(legacyDb, CURRENT_DB_VERSION);
  }
  legacyDb
    .prepare(
      `INSERT INTO users (id, username, email, password_hash, avatar_path, created_at, updated_at, last_login, jwt_secret)
       VALUES ('legacy-user', 'legacy-user', NULL, '', NULL, 1, 1, NULL, NULL)`
    )
    .run();
  legacyDb
    .prepare(
      `INSERT INTO conversations (id, user_id, name, type, extra, model, status, source, channel_chat_id, created_at, updated_at)
       VALUES ('legacy-conv-1', 'legacy-user', 'E2E legacy chat', 'agent', '{}', NULL, 'finished', NULL, NULL, 1, 1)`
    )
    .run();
  legacyDb.close();
  const { encodeConfigFile } = await load<
    typeof import('@process/services/personal-core/searchtMigration/SearchtMigrationService')
  >('@process/services/personal-core/searchtMigration/SearchtMigrationService');
  writeFileSync(
    path.join(legacyConfig, 'aionui-config.txt'),
    encodeConfigFile({
      'model.config': { providers: [{ id: 'e2e' }] },
      'mcp.config': [],
      'theme.activeId': 'e2e-theme',
    })
  );
  writeFileSync(path.join(legacyConfig, 'skills', 'e2e-skill', 'SKILL.md'), '# e2e skill');

  const { discoverSearchtImport } = await load<typeof import('@process/services/personal-core/importDiscovery')>(
    '@process/services/personal-core/importDiscovery'
  );
  const discovery = discoverSearchtImport(legacyRoot, (candidate) => existsSync(candidate));
  report(
    'discovery finds fabricated upstream',
    discovery.available && discovery.configDirectory === legacyConfig,
    discovery.available ? `config=${discovery.configDirectory}` : 'not available'
  );

  const engineCopy = path.join(work, 'engine-copy');
  mkdirSync(engineCopy, { recursive: true });
  const engineDbPath = path.join(engineCopy, 'aionui.db');
  const engineDb = new BetterSqlite3Driver(engineDbPath);
  initSchema(engineDb);
  const engineVersion = getDatabaseVersion(engineDb);
  if (engineVersion < CURRENT_DB_VERSION) {
    runMigrations(engineDb, engineVersion, CURRENT_DB_VERSION);
    setDatabaseVersion(engineDb, CURRENT_DB_VERSION);
  }
  const { ensureSystemUser } = await load<typeof import('@process/services/database/runLegacyDatabaseMigrations')>(
    '@process/services/database/runLegacyDatabaseMigrations'
  );
  ensureSystemUser(engineDb);
  engineDb.close();

  const { SearchtMigrationService, SqliteSourceCatalog, SqliteTargetCatalog } = await load<
    typeof import('@process/services/personal-core/searchtMigration/SearchtMigrationService')
  >('@process/services/personal-core/searchtMigration/SearchtMigrationService');
  const { SqliteSearchtImportReportStore, NodeSearchtMigrationFileIO } = await load<
    typeof import('@process/services/personal-core/searchtMigration/SearchtMigrationStore')
  >('@process/services/personal-core/searchtMigration/SearchtMigrationStore');
  const targetConfigDir = path.join(engineCopy, 'config');
  const migration = new SearchtMigrationService(
    discovery.available ? discovery.databasePath : null,
    new SqliteSourceCatalog(new BetterSqlite3Driver(path.join(legacyData, 'aionui.db'))),
    new SqliteTargetCatalog(new BetterSqlite3Driver(engineDbPath)),
    legacyConfig,
    targetConfigDir,
    new NodeSearchtMigrationFileIO(),
    new SqliteSearchtImportReportStore(personal.driver, () => Date.now())
  );
  const plan = migration.plan();
  const plannedConversations = plan.categories.find((entry) => entry.category === 'conversations')?.planned ?? 0;
  report('migration plan sees legacy data', plannedConversations >= 1, `conversations planned=${plannedConversations}`);

  const importReport = migration.execute();
  const verifyDb = new BetterSqlite3Driver(engineDbPath);
  const importedConversation = verifyDb.prepare("SELECT user_id FROM conversations WHERE id = 'legacy-conv-1'").get() as
    | { user_id: string }
    | undefined;
  const importedSkill = existsSync(path.join(targetConfigDir, 'skills', 'e2e-skill', 'SKILL.md'));
  const importedConfig = existsSync(path.join(targetConfigDir, 'aionui-config.txt'));
  report(
    'import executes on real service stack',
    importReport.status === 'succeeded' &&
      importedConversation?.user_id === 'system_default_user' &&
      importedSkill &&
      importedConfig,
    `status=${importReport.status} conv=${Boolean(importedConversation)} skill=${importedSkill} config=${importedConfig}`
  );

  const rollbackReport = migration.rollback(importReport.id);
  const afterRollback = verifyDb.prepare("SELECT id FROM conversations WHERE id = 'legacy-conv-1'").get() as
    | { id: string }
    | undefined;
  const skillGone = !existsSync(path.join(targetConfigDir, 'skills', 'e2e-skill', 'SKILL.md'));
  verifyDb.close();
  report(
    'rollback removes imported rows and files',
    rollbackReport.status === 'rolled-back' && !afterRollback && skillGone,
    `status=${rollbackReport.status} conv-left=${Boolean(afterRollback)} skill-gone=${skillGone}`
  );

  // --- 4. Cloud sync end-to-end on real catalog ------------------------------
  // Seed one task + note so the sync snapshot is non-empty regardless of the
  // current dev catalog contents.
  const seedTime = Date.now();
  personal.driver
    .prepare(
      `INSERT OR REPLACE INTO tasks (id, title, notes, priority, status, created_at, updated_at)
       VALUES ('e2e-sync-task', 'E2E sync task', '', 'medium', 'open', ?, ?)`
    )
    .run(seedTime, seedTime);
  personal.driver
    .prepare(
      `INSERT OR REPLACE INTO notes (id, title, body, revision_number, created_at, updated_at)
       VALUES ('e2e-sync-note', 'E2E sync note', 'body', 1, ?, ?)`
    )
    .run(seedTime, seedTime);

  const { CloudSyncService } = await load<typeof import('@process/services/personal-core/cloudSync/CloudSyncService')>(
    '@process/services/personal-core/cloudSync/CloudSyncService'
  );
  const remoteStore = new Map<string, Buffer>();
  const secrets = new Map<string, { masterKey?: string; password?: string }>();
  const cloudSync = new CloudSyncService(
    personal.driver,
    () => ({
      put: async (key: string, body: Buffer) => {
        remoteStore.set(key, Buffer.from(body));
      },
      get: async (key: string) => (remoteStore.get(key) ? Buffer.from(remoteStore.get(key)!) : null),
    }),
    {
      set: (id: string, value: { masterKey?: string; password?: string }) => void secrets.set(id, value),
      get: (id: string) => secrets.get(id) ?? null,
      delete: (id: string) => void secrets.delete(id),
    }
  );
  const configured = await cloudSync.configure({
    mode: 'webdav',
    passphrase: process.env.SEARCHT_E2E_SYNC_PASSPHRASE ?? 'local-e2e-passphrase',
    connection: {
      mode: 'webdav',
      serverUrl: 'https://dav.example.com/searcht-e2e',
      username: 'e2e-user',
      password: process.env.SEARCHT_E2E_WEBDAV_PASSWORD ?? 'local-e2e-password',
      rootPath: '/searcht',
    },
  });
  const push = await cloudSync.syncNow();
  const manifestBlob = remoteStore.get('searcht-sync/manifest.zxsync');
  const leaked = [...remoteStore.values()].some((blob) => blob.toString('utf8').includes('E2E Tester'));
  const statusAfter = cloudSync.getStatus();
  report(
    'cloud sync configures and pushes ciphertext',
    configured.mode === 'webdav' && push.errorCode === null && push.pushed > 0 && Boolean(manifestBlob) && !leaked,
    `pushed=${push.pushed} pending=${statusAfter.pendingOutbox}`
  );
  const notes = personal.driver.prepare('SELECT COUNT(*) AS c FROM notes').get() as { c: number };
  report(
    'real catalog snapshot includes notes table',
    push.pushed >= notes.c,
    `notes=${notes.c} pushed=${push.pushed}`
  );

  personal.close();
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // Windows may briefly hold sqlite handles; the temp dir is disposable.
  }

  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n[local-e2e] ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exit(1);
}

void main().catch((error) => {
  console.error('[local-e2e] crashed:', error);
  process.exit(1);
});
