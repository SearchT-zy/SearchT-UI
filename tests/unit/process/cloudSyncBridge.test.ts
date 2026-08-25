import { describe, expect, it, vi } from 'vitest';
import { initCloudSyncBridge } from '@process/bridge/cloudSyncBridge';

const envPassword = (): string => process.env.SEARCHT_UNIT_TEST_WEBDAV_PASSWORD ?? 'unit-test-password';
const envSecret = (): string => process.env.SEARCHT_UNIT_TEST_S3_SECRET_ACCESS_KEY ?? 'unit-test-secret-access-key';

describe('cloud sync bridge', () => {
  it('forwards status, configure, sync, and disable calls to the service', async () => {
    const status = {
      mode: 'webdav' as const,
      state: 'idle' as const,
      deviceId: 'device-1',
      lastSyncAt: null,
      lastSuccessAt: null,
      lastErrorCode: null,
      pendingOutbox: 0,
      remoteDeviceId: null,
      remoteUpdatedAt: null,
    };
    const service = {
      getStatus: vi.fn(() => status),
      configure: vi.fn(async () => ({ ...status, mode: 's3' })),
      syncNow: vi.fn(async () => ({
        startedAt: 1,
        finishedAt: 2,
        pushed: 3,
        pulled: 1,
        merged: 0,
        conflicts: [],
        outboxRemaining: 0,
        errorCode: null,
      })),
      disable: vi.fn(() => ({ ...status, mode: 'disabled' as const })),
    };
    const handlers = initCloudSyncBridge({ service });

    await handlers.getStatus();
    const configureInput = {
      mode: 's3' as const,
      passphrase: 'correct horse battery',
      connection: {
        mode: 's3' as const,
        endpoint: 'https://s3.example.com',
        region: 'us-east-1',
        bucket: 'bucket',
        prefix: '',
        pathStyle: true,
        accessKeyId: process.env.SEARCHT_UNIT_TEST_S3_ACCESS_KEY_ID ?? 'unit-test-access-key-id',
        secretAccessKey: envSecret(),
      },
    };
    await handlers.configure(configureInput);
    await handlers.syncNow();
    await handlers.disable();

    expect(service.getStatus).toHaveBeenCalled();
    expect(service.configure).toHaveBeenCalledWith(configureInput);
    expect(service.syncNow).toHaveBeenCalled();
    expect(service.disable).toHaveBeenCalled();
  });

  it('rejects unsafe or malformed renderer input before touching storage', async () => {
    const service = {
      getStatus: vi.fn(),
      configure: vi.fn(),
      syncNow: vi.fn(),
      disable: vi.fn(),
    };
    const handlers = initCloudSyncBridge({ service });

    await expect(
      handlers.configure({
        mode: 'webdav',
        passphrase: 'correct horse battery',
        connection: {
          mode: 'webdav',
          serverUrl: 'http://dav.example.com/dav',
          username: 'user',
          password: envPassword(),
          rootPath: '/searcht',
        },
      })
    ).rejects.toThrow('CLOUD_SYNC_INPUT_INVALID');
    await expect(
      handlers.configure({
        mode: 'webdav',
        passphrase: 'short',
        connection: {
          mode: 'webdav',
          serverUrl: 'https://dav.example.com/dav',
          username: 'user',
          password: envPassword(),
          rootPath: '/searcht',
        },
      })
    ).rejects.toThrow('CLOUD_SYNC_INPUT_INVALID');
    await expect(
      handlers.configure({
        mode: 's3',
        passphrase: 'correct horse battery',
        connection: {
          mode: 's3',
          endpoint: 'https://s3.example.com',
          region: '',
          bucket: 'bucket',
          prefix: '',
          pathStyle: true,
          accessKeyId: 'unit-test-access-key-id',
          secretAccessKey: envSecret(),
        },
      })
    ).rejects.toThrow('CLOUD_SYNC_INPUT_INVALID');
    expect(service.configure).not.toHaveBeenCalled();
  });
});
