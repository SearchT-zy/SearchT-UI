export type CloudSyncMode = 'disabled' | 'webdav' | 's3';

export type CloudSyncStatusName = 'disabled' | 'idle' | 'syncing' | 'error';

export type CloudSyncWebDavConfig = {
  mode: 'webdav';
  serverUrl: string;
  username: string;
  password: string;
  rootPath: string;
};

export type CloudSyncS3Config = {
  mode: 's3';
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  pathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
};

export type CloudSyncConnectionConfig = CloudSyncWebDavConfig | CloudSyncS3Config;

/** Connection settings persisted locally — credentials stay in secure storage. */
export type CloudSyncStoredWebDavConfig = Omit<CloudSyncWebDavConfig, 'password'>;
export type CloudSyncStoredS3Config = Omit<CloudSyncS3Config, 'accessKeyId' | 'secretAccessKey'>;
export type CloudSyncStoredConnection = CloudSyncStoredWebDavConfig | CloudSyncStoredS3Config;

export type CloudSyncConfigureInput = {
  mode: 'webdav' | 's3';
  passphrase: string;
  connection: CloudSyncConnectionConfig;
};

export type CloudSyncStatus = {
  mode: CloudSyncMode;
  state: CloudSyncStatusName;
  deviceId: string;
  lastSyncAt: number | null;
  lastSuccessAt: number | null;
  lastErrorCode: string | null;
  pendingOutbox: number;
  remoteDeviceId: string | null;
  remoteUpdatedAt: number | null;
};

export type CloudSyncConflictRecord = {
  table: string;
  recordId: string;
  localUpdatedAt: number;
  remoteUpdatedAt: number;
  remoteDeviceId: string;
};

export type CloudSyncReport = {
  startedAt: number;
  finishedAt: number;
  pushed: number;
  pulled: number;
  merged: number;
  conflicts: CloudSyncConflictRecord[];
  outboxRemaining: number;
  errorCode: string | null;
};
