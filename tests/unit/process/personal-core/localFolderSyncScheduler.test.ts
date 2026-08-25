import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalFolderSyncScheduler } from '@process/services/personal-core/connectors/LocalFolderSyncScheduler';

afterEach(() => {
  vi.useRealTimers();
});

describe('LocalFolderSyncScheduler', () => {
  it('syncs active and recoverable error connections but leaves paused connections alone', async () => {
    const service = {
      list: vi.fn(() => [
        { id: 'active', state: 'active' },
        { id: 'paused', state: 'paused' },
        { id: 'recoverable', state: 'error' },
      ]),
      sync: vi.fn(async () => undefined),
    };
    const scheduler = new LocalFolderSyncScheduler(service as never);

    await scheduler.poll();

    expect(service.sync.mock.calls.map(([id]) => id)).toEqual(['active', 'recoverable']);
  });

  it('runs immediately, repeats on the configured interval, and stops cleanly', async () => {
    vi.useFakeTimers();
    const service = {
      list: vi.fn(() => [{ id: 'active', state: 'active' }]),
      sync: vi.fn(async () => undefined),
    };
    const scheduler = new LocalFolderSyncScheduler(service as never, 1_000);

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.sync).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(service.sync).toHaveBeenCalledTimes(2);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(service.sync).toHaveBeenCalledTimes(2);
  });

  it('isolates one connection failure from the remaining connections', async () => {
    const service = {
      list: vi.fn(() => [
        { id: 'missing', state: 'error' },
        { id: 'healthy', state: 'active' },
      ]),
      sync: vi.fn(async (id: string) => {
        if (id === 'missing') throw new Error('CONNECTOR_FOLDER_UNAVAILABLE');
      }),
    };
    const scheduler = new LocalFolderSyncScheduler(service as never);

    await expect(scheduler.poll()).resolves.toBeUndefined();
    expect(service.sync).toHaveBeenCalledTimes(2);
  });

  it('waits for an in-flight sync before stopping', async () => {
    let releaseSync: (() => void) | undefined;
    const syncGate = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    const service = {
      list: vi.fn(() => [{ id: 'active', state: 'active' }]),
      sync: vi.fn(() => syncGate),
    };
    const scheduler = new LocalFolderSyncScheduler(service as never);
    scheduler.start();
    await vi.waitFor(() => expect(service.sync).toHaveBeenCalledTimes(1));

    let stopped = false;
    const stopping = Promise.resolve(scheduler.stop()).then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    releaseSync?.();
    await stopping;
    expect(stopped).toBe(true);
  });
});
