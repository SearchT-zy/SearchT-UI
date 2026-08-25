import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BetterSqlite3Driver } from '@process/services/database/drivers/BetterSqlite3Driver';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { PERSONAL_SCHEMA_VERSION } from '@process/services/personal-core/schema';

const directories: string[] = [];

function makeDataDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-personal-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('PersonalDatabase', () => {
  it('creates and migrates a new catalog to the current version', () => {
    const database = PersonalDatabase.open(makeDataDirectory());

    const connectorTable = database.driver
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'connector_accounts'")
      .get();
    const connectorIndexes = database.driver
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'connector_accounts' ORDER BY name")
      .all() as Array<{ name: string }>;
    const ingestTable = database.driver
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'connector_ingest_records'")
      .get();

    database.driver
      .prepare(`INSERT INTO connector_accounts (
        id, kind, display_name, state, config_json, cursor_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        'email-1',
        'email-imap',
        'QQ Mail',
        'active',
        JSON.stringify({
          provider: 'qq-mail',
          emailAddress: 'person@qq.com',
          mailbox: 'INBOX',
          initialSync: 'from-now',
        }),
        JSON.stringify({ uidValidity: null, lastUid: null }),
        1,
        1
      );

    expect(PERSONAL_SCHEMA_VERSION).toBe(13);
    expect(database.health()).toEqual({ ok: true, version: 13 });
    expect(database.path).toMatch(/[\\/]personal-core[\\/]searcht-personal\.db$/);
    expect(connectorTable).toEqual({ name: 'connector_accounts' });
    expect(ingestTable).toEqual({ name: 'connector_ingest_records' });
    expect(connectorIndexes.map(({ name }) => name)).toContain('idx_connector_accounts_state');

    database.close();
  });

  it('widens v10 connector kinds without losing existing local-folder accounts', () => {
    const directory = makeDataDirectory();
    const databaseDirectory = path.join(directory, 'personal-core');
    const databasePath = path.join(databaseDirectory, 'searcht-personal.db');
    mkdirSync(databaseDirectory, { recursive: true });
    const fixture = new BetterSqlite3Driver(databasePath);
    fixture.exec(`CREATE TABLE connector_accounts (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('local-folder')),
      display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
      state TEXT NOT NULL CHECK (state IN ('active', 'paused', 'error')),
      config_json TEXT NOT NULL,
      cursor_json TEXT NOT NULL,
      last_sync_at INTEGER,
      last_success_at INTEGER,
      last_error_code TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    )`);
    fixture
      .prepare(`INSERT INTO connector_accounts (
        id, kind, display_name, state, config_json, cursor_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        'folder-1',
        'local-folder',
        'Incoming',
        'paused',
        JSON.stringify({ path: 'C:\\Incoming', includeSubfolders: true }),
        JSON.stringify({}),
        10,
        20
      );
    fixture.pragma('user_version = 10');
    fixture.close();

    const database = PersonalDatabase.open(directory);
    const folder = database.driver.prepare('SELECT * FROM connector_accounts WHERE id = ?').get('folder-1') as {
      kind: string;
      display_name: string;
      state: string;
    };
    database.driver
      .prepare(`INSERT INTO connector_accounts (
        id, kind, display_name, state, config_json, cursor_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        'email-1',
        'email-imap',
        '163 Mail',
        'active',
        JSON.stringify({
          provider: 'netease-163',
          emailAddress: 'person@163.com',
          mailbox: 'INBOX',
          initialSync: 'last-7-days',
        }),
        JSON.stringify({ uidValidity: null, lastUid: null }),
        30,
        30
      );

    expect(database.health()).toEqual({ ok: true, version: 13 });
    expect(folder).toMatchObject({ kind: 'local-folder', display_name: 'Incoming', state: 'paused' });
    expect(database.driver.prepare('SELECT COUNT(*) AS count FROM connector_accounts').get()).toEqual({ count: 2 });

    database.close();
  });

  it('widens v11 connector kinds without losing existing email accounts', () => {
    const directory = makeDataDirectory();
    const databaseDirectory = path.join(directory, 'personal-core');
    const databasePath = path.join(databaseDirectory, 'searcht-personal.db');
    mkdirSync(databaseDirectory, { recursive: true });
    const fixture = new BetterSqlite3Driver(databasePath);
    fixture.exec(`CREATE TABLE connector_accounts (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('local-folder', 'email-imap')),
      display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
      state TEXT NOT NULL CHECK (state IN ('active', 'paused', 'error')),
      config_json TEXT NOT NULL,
      cursor_json TEXT NOT NULL,
      last_sync_at INTEGER,
      last_success_at INTEGER,
      last_error_code TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    )`);
    fixture
      .prepare(`INSERT INTO connector_accounts (
        id, kind, display_name, state, config_json, cursor_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        'email-1',
        'email-imap',
        'QQ Mail',
        'paused',
        JSON.stringify({
          provider: 'qq-mail',
          emailAddress: 'person@qq.com',
          mailbox: 'INBOX',
          initialSync: 'from-now',
        }),
        JSON.stringify({ uidValidity: '10', lastUid: 20 }),
        10,
        20
      );
    fixture.pragma('user_version = 11');
    fixture.close();

    const database = PersonalDatabase.open(directory);
    const email = database.driver.prepare('SELECT * FROM connector_accounts WHERE id = ?').get('email-1');
    database.driver
      .prepare(`INSERT INTO connector_accounts (
        id, kind, display_name, state, config_json, cursor_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        'webdav-1',
        'webdav',
        '坚果云',
        'active',
        JSON.stringify({ provider: 'jianguoyun', rootPath: '/', initialSync: 'from-now' }),
        JSON.stringify({}),
        30,
        30
      );

    expect(database.health()).toEqual({ ok: true, version: 13 });
    expect(email).toMatchObject({ kind: 'email-imap', display_name: 'QQ Mail', state: 'paused' });
    expect(database.driver.prepare('SELECT COUNT(*) AS count FROM connector_accounts').get()).toEqual({ count: 2 });

    database.close();
  });

  it('creates a complete versioned manual backup beside the catalog', async () => {
    const database = PersonalDatabase.open(makeDataDirectory());

    const result = await database.backup('manual');
    const databasePath = path.join(result.path, 'searcht-personal.db');
    const backup = new BetterSqlite3Driver(databasePath);

    expect(result).toEqual({ path: expect.stringMatching(/[\\/]backups[\\/]searcht-personal-/), formatVersion: 1 });
    expect(JSON.parse(readFileSync(path.join(result.path, 'manifest.json'), 'utf8'))).toMatchObject({
      formatVersion: 1,
      database: { path: 'searcht-personal.db' },
    });
    expect(backup.pragma('quick_check')).toEqual([{ quick_check: 'ok' }]);

    backup.close();
    database.close();
  });

  it('rejects a catalog newer than this application without replacing it', () => {
    const directory = makeDataDirectory();
    const database = PersonalDatabase.open(directory);
    const databasePath = database.path;
    database.close();
    const driver = new BetterSqlite3Driver(databasePath);
    driver.pragma('user_version = 99');
    driver.close();

    expect(() => PersonalDatabase.open(directory)).toThrow(
      `Personal Core schema 99 is newer than supported schema ${PERSONAL_SCHEMA_VERSION}`
    );
    expect(readdirSync(path.dirname(databasePath)).filter((name) => name.includes('.corrupt.'))).toEqual([]);
  });

  it('preserves a corrupt catalog before creating a healthy replacement', () => {
    const directory = makeDataDirectory();
    const database = PersonalDatabase.open(directory);
    const databasePath = database.path;
    database.close();
    writeFileSync(databasePath, 'not a sqlite database');

    const recovered = PersonalDatabase.open(directory);
    const files = readdirSync(path.dirname(databasePath));

    expect(files.some((name) => /^searcht-personal\.corrupt\.\d+\.db$/.test(name))).toBe(true);
    expect(recovered.health()).toEqual({ ok: true, version: PERSONAL_SCHEMA_VERSION });

    recovered.close();
  });
});
