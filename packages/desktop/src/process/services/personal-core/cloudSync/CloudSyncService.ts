import type {
  CloudSyncConfigureInput,
  CloudSyncConnectionConfig,
  CloudSyncReport,
  CloudSyncStatus,
  CloudSyncStoredConnection,
} from '@/common/types/searcht/cloudSync';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import {
  bundleFingerprint,
  decryptBundle,
  deriveMasterKey,
  encryptBundle,
  makeVerifier,
  masterKeyMatches,
  newMasterSalt,
} from './CloudSyncCrypto';
import type { CloudSyncTransport } from './CloudSyncTransport';
import { CloudSyncRepository, type SyncManifest, type SyncSnapshot } from './CloudSyncRepository';

const KEY_FILE = 'searcht-sync/keyfile.json';
const MANIFEST_FILE = 'searcht-sync/manifest.zxsync';

export type CloudSyncTransportFactory = (config: CloudSyncConnectionConfig) => CloudSyncTransport;

export type CloudSyncSecrets = {
  masterKey?: string;
  password?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
};

export type CloudSyncSecretPort = {
  set(id: string, value: CloudSyncSecrets): void;
  get(id: string): CloudSyncSecrets | null;
  delete(id: string): void;
};

const SECRET_ID = 'cloud-sync';

export class CloudSyncService {
  private readonly repository: CloudSyncRepository;
  private readonly syncLocks = new Map<string, Promise<CloudSyncReport>>();
  private transportFactory: CloudSyncTransportFactory;

  constructor(
    driver: ISqliteDriver,
    transportFactory: CloudSyncTransportFactory,
    private readonly secrets: CloudSyncSecretPort,
    private readonly now: () => number = Date.now
  ) {
    this.repository = new CloudSyncRepository(driver, now);
    this.transportFactory = transportFactory;
  }

  getStatus(): CloudSyncStatus {
    const state = this.repository.getState();
    const stateName =
      state.mode === 'disabled'
        ? 'disabled'
        : this.syncLocks.size > 0
          ? 'syncing'
          : state.lastErrorCode
            ? 'error'
            : 'idle';
    return {
      mode: state.mode,
      state: stateName,
      deviceId: state.deviceId,
      lastSyncAt: state.lastSyncAt,
      lastSuccessAt: state.lastSuccessAt,
      lastErrorCode: state.lastErrorCode,
      pendingOutbox: this.repository.pendingOutbox(),
      remoteDeviceId: state.remoteManifest?.deviceId ?? null,
      remoteUpdatedAt: state.remoteManifest?.updatedAt ?? null,
    };
  }

  async configure(input: CloudSyncConfigureInput): Promise<CloudSyncStatus> {
    const passphrase = normalizePassphrase(input.passphrase);
    if (input.mode !== input.connection.mode) throw new Error('CLOUD_SYNC_INPUT_INVALID');
    const transport = this.transportFactory(input.connection);
    const state = this.repository.getState();

    // Reuse the local sync root when the passphrase still unlocks it.
    if (state.masterSalt && state.verifier) {
      const masterKey = deriveMasterKey(passphrase, Buffer.from(state.masterSalt, 'base64'));
      if (!masterKeyMatches(masterKey, Buffer.from(state.verifier, 'base64'))) {
        throw new Error('CLOUD_SYNC_PASSPHRASE_MISMATCH');
      }
      this.secrets.set(SECRET_ID, fullSecrets(input.connection, masterKey));
      this.repository.setMode(input.mode, stripSecrets(input.connection), this.now());
      return this.getStatus();
    }

    // Join an existing remote sync root instead of resetting it.
    const existing = await transport.get(KEY_FILE);
    if (existing) {
      const parsed = JSON.parse(existing.toString('utf8')) as { masterSalt: string; verifier: string };
      const masterKey = deriveMasterKey(passphrase, Buffer.from(parsed.masterSalt, 'base64'));
      if (!masterKeyMatches(masterKey, Buffer.from(parsed.verifier, 'base64'))) {
        throw new Error('CLOUD_SYNC_PASSPHRASE_MISMATCH');
      }
      this.repository.storeSecrets(parsed.masterSalt, parsed.verifier);
      this.secrets.set(SECRET_ID, fullSecrets(input.connection, masterKey));
      this.repository.setMode(input.mode, stripSecrets(input.connection), this.now());
      return this.getStatus();
    }

    const masterSalt = newMasterSalt();
    const masterKey = deriveMasterKey(passphrase, masterSalt);
    const verifier = makeVerifier(masterKey);
    await transport.put(
      KEY_FILE,
      Buffer.from(
        JSON.stringify({ masterSalt: masterSalt.toString('base64'), verifier: verifier.toString('base64') }),
        'utf8'
      )
    );
    this.repository.storeSecrets(masterSalt.toString('base64'), verifier.toString('base64'));
    this.secrets.set(SECRET_ID, fullSecrets(input.connection, masterKey));
    this.repository.setMode(input.mode, stripSecrets(input.connection), this.now());
    return this.getStatus();
  }

  disable(): CloudSyncStatus {
    this.repository.setMode('disabled', null, this.now());
    return this.getStatus();
  }

  syncNow(): Promise<CloudSyncReport> {
    const state = this.repository.getState();
    const running = this.syncLocks.get(state.deviceId);
    if (running) return running;
    const operation = this.performSync().finally(() => {
      if (this.syncLocks.get(state.deviceId) === operation) this.syncLocks.delete(state.deviceId);
    });
    this.syncLocks.set(state.deviceId, operation);
    return operation;
  }

  private async performSync(): Promise<CloudSyncReport> {
    const startedAt = this.now();
    const report: CloudSyncReport = {
      startedAt,
      finishedAt: startedAt,
      pushed: 0,
      pulled: 0,
      merged: 0,
      conflicts: [],
      outboxRemaining: 0,
      errorCode: null,
    };

    const state = this.repository.getState();
    if (state.mode === 'disabled') {
      report.errorCode = 'CLOUD_SYNC_DISABLED';
      report.finishedAt = this.now();
      return report;
    }
    if (!state.connection) {
      report.errorCode = 'CLOUD_SYNC_NOT_CONFIGURED';
      report.finishedAt = this.now();
      this.repository.recordSyncAttempt(report.errorCode, this.now());
      return report;
    }
    const secret = this.secrets.get(SECRET_ID);
    if (!secret?.masterKey) {
      report.errorCode = 'CLOUD_SYNC_NOT_CONFIGURED';
      report.finishedAt = this.now();
      this.repository.recordSyncAttempt(report.errorCode, this.now());
      return report;
    }
    const masterKey = Buffer.from(secret.masterKey, 'base64');
    const verifier = Buffer.from(state.verifier ?? '', 'base64');
    if (!state.verifier || !masterKeyMatches(masterKey, verifier)) {
      report.errorCode = 'CLOUD_SYNC_KEY_INVALID';
      report.finishedAt = this.now();
      this.repository.recordSyncAttempt(report.errorCode, this.now());
      return report;
    }

    const transport = this.transportFactory(withSecrets(state.connection, secret));
    let transportError: string | null = null;

    // Pull first so pushes are built on top of the freshest remote state.
    try {
      const manifestBundle = await transport.get(MANIFEST_FILE);
      if (manifestBundle) {
        const manifest = JSON.parse(decryptBundle(manifestBundle, masterKey).toString('utf8')) as SyncManifest;
        const known = state.remoteManifest;
        const stale = !known || known.bundleKey !== manifest.bundleKey;
        if (stale && manifest.deviceId !== state.deviceId) {
          const dataBundle = await transport.get(manifest.bundleKey);
          if (!dataBundle) throw new Error('CLOUD_SYNC_REMOTE_DATA_MISSING');
          const snapshot = JSON.parse(decryptBundle(dataBundle, masterKey).toString('utf8')) as SyncSnapshot;
          const merged = this.repository.applySnapshot(snapshot);
          report.pulled = merged.pulled;
          report.merged = merged.merged;
          report.conflicts = merged.conflicts;
          this.repository.saveRemoteManifest(manifest, this.now());
        }
      }
    } catch (error) {
      transportError = errorCode(error);
    }

    // Push (or queue offline) the merged local state.
    try {
      const due = this.repository.dueSnapshot(this.now());
      if (due) {
        // Drain a previously queued snapshot before replacing it with a fresh one.
        this.repository.markOutboxAttempt(due.id, null, this.now());
      }
      const snapshot = this.repository.captureSnapshot(state.deviceId, this.now());
      const bundle = encryptBundle(Buffer.from(JSON.stringify(snapshot), 'utf8'), masterKey);
      const bundleKey = `searcht-sync/data-${bundleFingerprint(bundle)}.zxsync`;
      await transport.put(bundleKey, bundle);
      const manifest: SyncManifest = {
        formatVersion: 1,
        deviceId: state.deviceId,
        updatedAt: this.now(),
        bundleKey,
        recordCount: snapshot.records.length,
      };
      await transport.put(MANIFEST_FILE, encryptBundle(Buffer.from(JSON.stringify(manifest), 'utf8'), masterKey));
      this.repository.markPushedBase(snapshot);
      this.repository.saveRemoteManifest(manifest, this.now());
      report.pushed = snapshot.records.length;
    } catch (error) {
      transportError = errorCode(error);
      const snapshot = this.repository.captureSnapshot(state.deviceId, this.now());
      this.repository.enqueueSnapshot(snapshot, this.now());
      this.repository.markOutboxAttempt(`push-${state.deviceId}`, transportError, this.now());
    }

    report.outboxRemaining = this.repository.pendingOutbox();
    report.errorCode = transportError;
    report.finishedAt = this.now();
    if (transportError) this.repository.recordSyncAttempt(transportError, this.now());
    else this.repository.recordSuccess(this.now());
    return report;
  }
}

function normalizePassphrase(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 1_024) throw new Error('CLOUD_SYNC_PASSPHRASE_INVALID');
  return normalized;
}

function fullSecrets(connection: CloudSyncConnectionConfig, masterKey: Buffer): CloudSyncSecrets {
  return connection.mode === 'webdav'
    ? { masterKey: masterKey.toString('base64'), password: connection.password }
    : {
        masterKey: masterKey.toString('base64'),
        accessKeyId: connection.accessKeyId,
        secretAccessKey: connection.secretAccessKey,
      };
}

function stripSecrets(connection: CloudSyncConnectionConfig): CloudSyncStoredConnection {
  if (connection.mode === 'webdav') {
    const { password: _password, ...rest } = connection;
    return rest;
  }
  const { secretAccessKey: _secretAccessKey, accessKeyId: _accessKeyId, ...rest } = connection;
  return rest;
}

function withSecrets(connection: CloudSyncStoredConnection, secret: CloudSyncSecrets): CloudSyncConnectionConfig {
  if (connection.mode === 'webdav') return { ...connection, password: secret.password ?? '' };
  return { ...connection, secretAccessKey: secret.secretAccessKey ?? '', accessKeyId: secret.accessKeyId ?? '' };
}

function errorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) return error.message;
  return 'CLOUD_SYNC_FAILED';
}

export type { SyncManifest, SyncSnapshot };
