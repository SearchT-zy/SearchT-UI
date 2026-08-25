import { ipcBridge } from '@/common';
import type { CloudSyncConfigureInput, CloudSyncReport, CloudSyncStatus } from '@/common/types/searcht/cloudSync';
import { getCloudSyncService } from '@process/services/personal-core';
import type { CloudSyncService } from '@process/services/personal-core/cloudSync/CloudSyncService';

type CloudSyncServiceContract = Pick<CloudSyncService, 'getStatus' | 'configure' | 'syncNow' | 'disable'>;

export type CloudSyncBridgeDependencies = {
  service: CloudSyncServiceContract;
};

export type CloudSyncBridgeHandlers = {
  getStatus: () => Promise<CloudSyncStatus>;
  configure: (input: CloudSyncConfigureInput) => Promise<CloudSyncStatus>;
  syncNow: () => Promise<CloudSyncReport>;
  disable: () => Promise<CloudSyncStatus>;
};

export function initCloudSyncBridge(dependencies?: CloudSyncBridgeDependencies): CloudSyncBridgeHandlers {
  const getService = (): CloudSyncServiceContract => dependencies?.service ?? getCloudSyncService();
  const handlers: CloudSyncBridgeHandlers = {
    getStatus: async () => getService().getStatus(),
    configure: async (input) => {
      validateConfigureInput(input);
      return getService().configure(input);
    },
    syncNow: async () => getService().syncNow(),
    disable: async () => getService().disable(),
  };

  ipcBridge.cloudSync.getStatus.provider(handlers.getStatus);
  ipcBridge.cloudSync.configure.provider(handlers.configure);
  ipcBridge.cloudSync.syncNow.provider(handlers.syncNow);
  ipcBridge.cloudSync.disable.provider(handlers.disable);
  return handlers;
}

function validateConfigureInput(input: CloudSyncConfigureInput): void {
  if (
    !input ||
    (input.mode !== 'webdav' && input.mode !== 's3') ||
    !input.connection ||
    input.connection.mode !== input.mode
  ) {
    throw new Error('CLOUD_SYNC_INPUT_INVALID');
  }
  if (typeof input.passphrase !== 'string' || input.passphrase.trim().length < 8) {
    throw new Error('CLOUD_SYNC_INPUT_INVALID');
  }
  const connection = input.connection;
  if (connection.mode === 'webdav') {
    if (
      !isHttpsUrl(connection.serverUrl) ||
      typeof connection.username !== 'string' ||
      !connection.username.trim() ||
      typeof connection.password !== 'string' ||
      !connection.password ||
      typeof connection.rootPath !== 'string'
    ) {
      throw new Error('CLOUD_SYNC_INPUT_INVALID');
    }
    return;
  }
  if (
    !isHttpsUrl(connection.endpoint) ||
    !/^[a-z0-9-]{1,64}$/i.test(connection.region ?? '') ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/i.test(connection.bucket ?? '') ||
    typeof connection.accessKeyId !== 'string' ||
    !connection.accessKeyId.trim() ||
    typeof connection.secretAccessKey !== 'string' ||
    !connection.secretAccessKey
  ) {
    throw new Error('CLOUD_SYNC_INPUT_INVALID');
  }
}

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}
