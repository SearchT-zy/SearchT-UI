import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PersonalBackupResult } from '@/common/types/searcht/workspace';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';

type PersonalBackupCatalog = {
  path: string;
  driver: ISqliteDriver;
};

type PersonalBackupOptions = {
  now?: () => Date;
  randomId?: () => string;
  copyFile?: (source: string, destination: string) => Promise<void>;
};

type ReferencedAssetRow = {
  managed_name: string;
  sha256: string;
  size_bytes: number;
};

type ManifestEntry = {
  path: string;
  sizeBytes: number;
  sha256: string;
};

type PersonalBackupManifest = {
  formatVersion: 1;
  createdAt: string;
  database: ManifestEntry;
  files: ManifestEntry[];
};

const escapeSqliteString = (value: string): string => value.replaceAll("'", "''");
const manifestPath = (...segments: string[]): string => segments.join('/');

async function digestFile(filePath: string): Promise<{ sha256: string; sizeBytes: number }> {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for await (const value of createReadStream(filePath)) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    hash.update(chunk);
    sizeBytes += chunk.byteLength;
  }
  return { sha256: hash.digest('hex'), sizeBytes };
}

export class PersonalBackupService {
  private readonly now: () => Date;
  private readonly randomId: () => string;
  private readonly copyManagedFile: (source: string, destination: string) => Promise<void>;

  constructor(
    private readonly database: PersonalBackupCatalog,
    private readonly inboxRoot: string,
    options: PersonalBackupOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.randomId = options.randomId ?? randomUUID;
    this.copyManagedFile = options.copyFile ?? copyFile;
  }

  async createBackup(): Promise<PersonalBackupResult> {
    const createdAt = this.now();
    const backupRoot = path.join(path.dirname(this.database.path), 'backups');
    const name = `searcht-personal-${createdAt.toISOString().replaceAll(':', '-').replace('.', '-')}`;
    const destination = path.join(backupRoot, name);
    const temporary = `${destination}.tmp-${this.randomId()}`;
    mkdirSync(temporary, { recursive: true });

    try {
      const databaseName = path.basename(this.database.path);
      const databaseCopy = path.join(temporary, databaseName);
      this.database.driver.exec(`VACUUM INTO '${escapeSqliteString(databaseCopy)}'`);
      const databaseDigest = await digestFile(databaseCopy);

      const files: ManifestEntry[] = [];
      for (const asset of this.listReferencedAssets()) {
        const relativePath = manifestPath('files', asset.managed_name.slice(0, 2), asset.managed_name);
        const source = this.resolveManagedPath(asset.managed_name);
        const copied = path.join(temporary, ...relativePath.split('/'));
        mkdirSync(path.dirname(copied), { recursive: true });
        // eslint-disable-next-line no-await-in-loop -- Keep large managed-file copies sequential to bound disk pressure.
        await this.copyManagedFile(source, copied);
        // eslint-disable-next-line no-await-in-loop -- Verify each copy before starting the next large file.
        const digest = await digestFile(copied);
        if (digest.sha256 !== asset.sha256 || digest.sizeBytes !== asset.size_bytes) {
          throw new Error('PERSONAL_BACKUP_DIGEST_MISMATCH');
        }
        files.push({ path: relativePath, ...digest });
      }

      const manifest: PersonalBackupManifest = {
        formatVersion: 1,
        createdAt: createdAt.toISOString(),
        database: { path: databaseName, ...databaseDigest },
        files,
      };
      writeFileSync(path.join(temporary, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      renameSync(temporary, destination);
      return { path: destination, formatVersion: 1 };
    } catch (error) {
      rmSync(temporary, { recursive: true, force: true });
      throw error;
    }
  }

  private listReferencedAssets(): ReferencedAssetRow[] {
    return this.database.driver
      .prepare(
        `SELECT DISTINCT a.managed_name, a.sha256, a.size_bytes
         FROM inbox_assets a
         INNER JOIN inbox_asset_origins o ON o.asset_id = a.id
         INNER JOIN inbox_items i ON i.origin_id = o.id
         ORDER BY a.managed_name`
      )
      .all() as ReferencedAssetRow[];
  }

  private resolveManagedPath(managedName: string): string {
    if (!/^[a-f0-9]{64}$/.test(managedName)) throw new Error('PERSONAL_BACKUP_MANAGED_NAME_INVALID');
    const filesRoot = path.resolve(this.inboxRoot, 'files');
    const resolved = path.resolve(filesRoot, managedName.slice(0, 2), managedName);
    if (!resolved.startsWith(`${filesRoot}${path.sep}`)) throw new Error('PERSONAL_BACKUP_PATH_OUTSIDE_ROOT');
    if (!statSync(resolved).isFile()) throw new Error('PERSONAL_BACKUP_FILE_NOT_REGULAR');
    return resolved;
  }
}
