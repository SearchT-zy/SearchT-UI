import { existsSync, mkdirSync, renameSync } from 'fs';
import nodePath from 'path';
import { SEARCHT_BRAND } from '@/common/config/brand';
import type { PersonalBackupResult, PersonalCoreHealth } from '@/common/types/searcht/workspace';
import { BetterSqlite3Driver } from '@process/services/database/drivers/BetterSqlite3Driver';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import { migratePersonalSchema } from './schema';
import { PersonalBackupService } from './PersonalBackupService';

const FUTURE_SCHEMA_PREFIX = 'Personal Core schema ';

function assertHealthy(driver: ISqliteDriver): void {
  const result = driver.pragma('quick_check') as Array<Record<string, unknown>>;
  if (result.length !== 1 || result[0]?.quick_check !== 'ok') {
    throw new Error('Personal Core database integrity check failed');
  }
}

function preserveCorruptCatalog(databasePath: string): void {
  const timestamp = Date.now();
  const directory = nodePath.dirname(databasePath);
  const corruptBase = nodePath.join(directory, `searcht-personal.corrupt.${timestamp}.db`);
  renameSync(databasePath, corruptBase);

  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${databasePath}${suffix}`;
    if (existsSync(sidecar)) {
      renameSync(sidecar, `${corruptBase}${suffix}`);
    }
  }
}

export class PersonalDatabase {
  private closed = false;

  private constructor(
    public readonly path: string,
    public readonly driver: ISqliteDriver
  ) {}

  static open(dataDirectory: string): PersonalDatabase {
    const directory = nodePath.join(dataDirectory, 'personal-core');
    const databasePath = nodePath.join(directory, SEARCHT_BRAND.personalDatabaseName);
    mkdirSync(directory, { recursive: true });

    try {
      return PersonalDatabase.openCatalog(databasePath);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(FUTURE_SCHEMA_PREFIX)) {
        throw error;
      }
      if (!existsSync(databasePath)) {
        throw error;
      }
      preserveCorruptCatalog(databasePath);
      return PersonalDatabase.openCatalog(databasePath);
    }
  }

  private static openCatalog(databasePath: string): PersonalDatabase {
    const driver = new BetterSqlite3Driver(databasePath);
    try {
      driver.pragma('journal_mode = WAL');
      driver.pragma('foreign_keys = ON');
      driver.pragma('busy_timeout = 5000');
      assertHealthy(driver);
      const version = driver.pragma('user_version', { simple: true }) as number;
      migratePersonalSchema(driver, version);
      assertHealthy(driver);
      return new PersonalDatabase(databasePath, driver);
    } catch (error) {
      driver.close();
      throw error;
    }
  }

  health(): PersonalCoreHealth {
    assertHealthy(this.driver);
    const version = this.driver.pragma('user_version', { simple: true }) as number;
    return { ok: true, version };
  }

  backup(reason: string): Promise<PersonalBackupResult> {
    if (!/^[a-z0-9-]+$/i.test(reason)) {
      throw new Error('Invalid Personal Core backup reason');
    }
    return new PersonalBackupService(this, nodePath.join(nodePath.dirname(this.path), 'inbox')).createBackup();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.driver.close();
  }
}
