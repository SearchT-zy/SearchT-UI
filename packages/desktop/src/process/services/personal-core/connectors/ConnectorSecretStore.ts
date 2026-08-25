import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type EmailConnectorSecret = {
  emailAddress: string;
  authorizationCode: string;
};

export type WebDavConnectorSecret = {
  serverUrl: string;
  username: string;
  password: string;
};

export type S3ConnectorSecret = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export type CalendarIcsConnectorSecret = {
  url: string;
};

export type CloudSyncSecretRecord = {
  masterKey?: string;
  password?: string;
  secretAccessKey?: string;
};

export type ConnectorSecretCipher = {
  isAvailable(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
};

export type ConnectorSecretFileSystem = {
  exists(filePath: string): boolean;
  mkdir(directory: string): void;
  read(filePath: string): string;
  write(filePath: string, content: string): void;
  rename(from: string, to: string): void;
  remove(filePath: string): void;
};

type SecretFile = {
  version: 1;
  entries: Record<string, string>;
};

const nodeFileSystem: ConnectorSecretFileSystem = {
  exists: existsSync,
  mkdir: (directory) => mkdirSync(directory, { recursive: true }),
  read: (filePath) => readFileSync(filePath, 'utf8'),
  write: (filePath, content) => writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o600 }),
  rename: renameSync,
  remove: (filePath) => rmSync(filePath, { force: true }),
};

export class ConnectorSecretStore {
  constructor(
    private readonly filePath: string,
    private readonly cipher: ConnectorSecretCipher,
    private readonly fileSystem: ConnectorSecretFileSystem = nodeFileSystem
  ) {}

  setEmail(id: string, value: EmailConnectorSecret): void {
    assertConnectorId(id);
    this.assertEncryptionAvailable();
    let encrypted: Buffer;
    try {
      encrypted = this.cipher.encrypt(JSON.stringify(value));
    } catch {
      throw new Error('CONNECTOR_SECRET_ENCRYPTION_FAILED');
    }
    const file = this.readFile();
    file.entries[id] = encrypted.toString('base64');
    this.writeFile(file);
  }

  getEmail(id: string): EmailConnectorSecret | null {
    assertConnectorId(id);
    const encrypted = this.readFile().entries[id];
    if (!encrypted) return null;
    this.assertEncryptionAvailable();
    try {
      const parsed = JSON.parse(this.cipher.decrypt(Buffer.from(encrypted, 'base64'))) as Partial<EmailConnectorSecret>;
      if (typeof parsed.emailAddress !== 'string' || typeof parsed.authorizationCode !== 'string') throw new Error();
      return { emailAddress: parsed.emailAddress, authorizationCode: parsed.authorizationCode };
    } catch {
      throw new Error('CONNECTOR_SECRET_DECRYPTION_FAILED');
    }
  }

  setWebDav(id: string, value: WebDavConnectorSecret): void {
    assertConnectorId(id);
    this.assertEncryptionAvailable();
    let encrypted: Buffer;
    try {
      encrypted = this.cipher.encrypt(JSON.stringify(value));
    } catch {
      throw new Error('CONNECTOR_SECRET_ENCRYPTION_FAILED');
    }
    const file = this.readFile();
    file.entries[id] = encrypted.toString('base64');
    this.writeFile(file);
  }

  getWebDav(id: string): WebDavConnectorSecret | null {
    assertConnectorId(id);
    const encrypted = this.readFile().entries[id];
    if (!encrypted) return null;
    this.assertEncryptionAvailable();
    try {
      const parsed = JSON.parse(
        this.cipher.decrypt(Buffer.from(encrypted, 'base64'))
      ) as Partial<WebDavConnectorSecret>;
      if (
        typeof parsed.serverUrl !== 'string' ||
        typeof parsed.username !== 'string' ||
        typeof parsed.password !== 'string'
      ) {
        throw new Error();
      }
      return { serverUrl: parsed.serverUrl, username: parsed.username, password: parsed.password };
    } catch {
      throw new Error('CONNECTOR_SECRET_DECRYPTION_FAILED');
    }
  }

  delete(id: string): void {
    assertConnectorId(id);
    const file = this.readFile();
    if (!(id in file.entries)) return;
    delete file.entries[id];
    this.writeFile(file);
  }

  setS3(id: string, value: S3ConnectorSecret): void {
    assertConnectorId(id);
    this.assertEncryptionAvailable();
    let encrypted: Buffer;
    try {
      encrypted = this.cipher.encrypt(JSON.stringify(value));
    } catch {
      throw new Error('CONNECTOR_SECRET_ENCRYPTION_FAILED');
    }
    const file = this.readFile();
    file.entries[id] = encrypted.toString('base64');
    this.writeFile(file);
  }

  getS3(id: string): S3ConnectorSecret | null {
    assertConnectorId(id);
    const encrypted = this.readFile().entries[id];
    if (!encrypted) return null;
    this.assertEncryptionAvailable();
    try {
      const parsed = JSON.parse(this.cipher.decrypt(Buffer.from(encrypted, 'base64'))) as Partial<S3ConnectorSecret>;
      if (
        typeof parsed.endpoint !== 'string' ||
        typeof parsed.region !== 'string' ||
        typeof parsed.accessKeyId !== 'string' ||
        typeof parsed.secretAccessKey !== 'string'
      ) {
        throw new Error();
      }
      return {
        endpoint: parsed.endpoint,
        region: parsed.region,
        accessKeyId: parsed.accessKeyId,
        secretAccessKey: parsed.secretAccessKey,
      };
    } catch {
      throw new Error('CONNECTOR_SECRET_DECRYPTION_FAILED');
    }
  }

  setCalendarIcs(id: string, value: CalendarIcsConnectorSecret): void {
    assertConnectorId(id);
    this.assertEncryptionAvailable();
    let encrypted: Buffer;
    try {
      encrypted = this.cipher.encrypt(JSON.stringify(value));
    } catch {
      throw new Error('CONNECTOR_SECRET_ENCRYPTION_FAILED');
    }
    const file = this.readFile();
    file.entries[id] = encrypted.toString('base64');
    this.writeFile(file);
  }

  getCalendarIcs(id: string): CalendarIcsConnectorSecret | null {
    assertConnectorId(id);
    const encrypted = this.readFile().entries[id];
    if (!encrypted) return null;
    this.assertEncryptionAvailable();
    try {
      const parsed = JSON.parse(
        this.cipher.decrypt(Buffer.from(encrypted, 'base64'))
      ) as Partial<CalendarIcsConnectorSecret>;
      if (typeof parsed.url !== 'string') throw new Error();
      return { url: parsed.url };
    } catch {
      throw new Error('CONNECTOR_SECRET_DECRYPTION_FAILED');
    }
  }

  setCloudSync(id: string, value: CloudSyncSecretRecord): void {
    assertConnectorId(id);
    this.assertEncryptionAvailable();
    let encrypted: Buffer;
    try {
      encrypted = this.cipher.encrypt(JSON.stringify(value));
    } catch {
      throw new Error('CONNECTOR_SECRET_ENCRYPTION_FAILED');
    }
    const file = this.readFile();
    file.entries[id] = encrypted.toString('base64');
    this.writeFile(file);
  }

  getCloudSync(id: string): CloudSyncSecretRecord | null {
    assertConnectorId(id);
    const encrypted = this.readFile().entries[id];
    if (!encrypted) return null;
    this.assertEncryptionAvailable();
    try {
      const parsed = JSON.parse(this.cipher.decrypt(Buffer.from(encrypted, 'base64'))) as CloudSyncSecretRecord;
      if (typeof parsed !== 'object' || parsed === null) throw new Error();
      return parsed;
    } catch {
      throw new Error('CONNECTOR_SECRET_DECRYPTION_FAILED');
    }
  }

  private assertEncryptionAvailable(): void {
    if (!this.cipher.isAvailable()) throw new Error('CONNECTOR_SECURE_STORAGE_UNAVAILABLE');
  }

  private readFile(): SecretFile {
    if (!this.fileSystem.exists(this.filePath)) return { version: 1, entries: {} };
    try {
      const parsed = JSON.parse(this.fileSystem.read(this.filePath)) as Partial<SecretFile>;
      if (
        parsed.version !== 1 ||
        !parsed.entries ||
        typeof parsed.entries !== 'object' ||
        Array.isArray(parsed.entries)
      ) {
        throw new Error();
      }
      for (const value of Object.values(parsed.entries)) {
        if (typeof value !== 'string') throw new Error();
      }
      return { version: 1, entries: { ...parsed.entries } };
    } catch {
      throw new Error('CONNECTOR_SECRET_FILE_INVALID');
    }
  }

  private writeFile(file: SecretFile): void {
    const temporaryPath = `${this.filePath}.tmp-${randomUUID()}`;
    try {
      this.fileSystem.mkdir(path.dirname(this.filePath));
      this.fileSystem.write(temporaryPath, JSON.stringify(file));
      this.fileSystem.rename(temporaryPath, this.filePath);
    } catch {
      try {
        this.fileSystem.remove(temporaryPath);
      } catch {
        // The original file remains authoritative even if temporary cleanup fails.
      }
      throw new Error('CONNECTOR_SECRET_WRITE_FAILED');
    }
  }
}

function assertConnectorId(id: string): void {
  if (!id.trim()) throw new Error('CONNECTOR_SECRET_ID_INVALID');
}
