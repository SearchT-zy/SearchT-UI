import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersonalBackupService } from '@process/services/personal-core/PersonalBackupService';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { InboxFileStore } from '@process/services/personal-core/InboxFileStore';
import { InboxService } from '@process/services/personal-core/InboxService';

const directories: string[] = [];

function makeDataDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-backup-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function fixture() {
  const dataDirectory = makeDataDirectory();
  const database = PersonalDatabase.open(dataDirectory);
  const inboxRoot = path.join(path.dirname(database.path), 'inbox');
  const fileStore = new InboxFileStore(inboxRoot);
  const source = path.join(dataDirectory, 'source.txt');
  writeFileSync(source, 'backup payload');
  const imported = await new InboxService(database.driver, fileStore).importFiles({
    files: [{ kind: 'path', path: source, name: 'source.txt', sizeBytes: 14, mimeType: 'text/plain' }],
  });
  const asset = imported.imported[0]!.detail.asset!;
  return { dataDirectory, database, inboxRoot, fileStore, asset };
}

describe('PersonalBackupService', () => {
  it('publishes a database snapshot, referenced managed files, and a verified manifest', async () => {
    const { database, inboxRoot, asset } = await fixture();
    const service = new PersonalBackupService(database, inboxRoot, {
      now: () => new Date('2026-08-14T10:20:30.000Z'),
      randomId: () => 'test-id',
    });

    const result = await service.createBackup();
    const manifest = JSON.parse(readFileSync(path.join(result.path, 'manifest.json'), 'utf8')) as {
      formatVersion: number;
      database: { path: string; sizeBytes: number; sha256: string };
      files: Array<{ path: string; sizeBytes: number; sha256: string }>;
    };

    expect(result).toEqual({ path: expect.stringContaining('2026-08-14T10-20-30-000Z'), formatVersion: 1 });
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.database.path).toBe('searcht-personal.db');
    expect(manifest.database.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.database.sizeBytes).toBeGreaterThan(0);
    expect(manifest.files).toEqual([
      {
        path: `files/${asset.managedName.slice(0, 2)}/${asset.managedName}`,
        sizeBytes: asset.sizeBytes,
        sha256: asset.sha256,
      },
    ]);
    expect(readFileSync(path.join(result.path, manifest.files[0]!.path), 'utf8')).toBe('backup payload');
    database.close();
  });

  it('rejects digest mismatches and removes the unpublished temporary directory', async () => {
    const { database, inboxRoot, fileStore, asset } = await fixture();
    writeFileSync(fileStore.resolveManagedPath(asset.managedName), 'changed payload');
    const service = new PersonalBackupService(database, inboxRoot, { randomId: () => 'digest-failure' });

    await expect(service.createBackup()).rejects.toThrow('PERSONAL_BACKUP_DIGEST_MISMATCH');
    const backupRoot = path.join(path.dirname(database.path), 'backups');
    expect(existsSync(backupRoot) ? readdirSync(backupRoot) : []).toEqual([]);
    database.close();
  });

  it('cleans copy failures without replacing a previously completed backup', async () => {
    const { database, inboxRoot } = await fixture();
    const completed = await new PersonalBackupService(database, inboxRoot, {
      now: () => new Date('2026-08-14T10:20:30.000Z'),
      randomId: () => 'first',
    }).createBackup();
    const copyFile = vi.fn(async () => {
      throw new Error('copy failed');
    });
    const failing = new PersonalBackupService(database, inboxRoot, {
      now: () => new Date('2026-08-14T10:21:30.000Z'),
      randomId: () => 'copy-failure',
      copyFile,
    });

    await expect(failing.createBackup()).rejects.toThrow('copy failed');
    expect(existsSync(completed.path)).toBe(true);
    expect(readdirSync(path.dirname(completed.path))).toEqual([path.basename(completed.path)]);
    database.close();
  });

  it('records file hashes that match the published bytes', async () => {
    const { database, inboxRoot } = await fixture();
    const result = await new PersonalBackupService(database, inboxRoot).createBackup();
    const manifest = JSON.parse(readFileSync(path.join(result.path, 'manifest.json'), 'utf8')) as {
      files: Array<{ path: string; sha256: string }>;
    };
    const entry = manifest.files[0]!;
    const bytes = readFileSync(path.join(result.path, entry.path));

    expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
    database.close();
  });
});
