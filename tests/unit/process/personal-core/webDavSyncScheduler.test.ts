import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorAccount } from '@/common/types/searcht/connectors';
import { WebDavSyncScheduler } from '@process/services/personal-core/connectors/webdav/WebDavSyncScheduler';

afterEach(() => vi.useRealTimers());

describe('WebDavSyncScheduler', () => {
  it('polls immediately, skips paused accounts, and repeats at the configured interval', async () => {
    vi.useFakeTimers();
    const sync = vi.fn(async () => undefined);
    const service = {
      list: () => [account('active', 'active'), account('paused', 'paused')] as ConnectorAccount[],
      sync,
    };
    const scheduler = new WebDavSyncScheduler(service, 600_000);

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenLastCalledWith('active');

    await vi.advanceTimersByTimeAsync(600_000);
    expect(sync).toHaveBeenCalledTimes(2);
    await scheduler.stop();
  });

  it('waits for an active poll during shutdown', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const scheduler = new WebDavSyncScheduler(
      { list: () => [account('active', 'active')], sync: () => pending },
      600_000
    );
    const poll = scheduler.poll();
    let stopped = false;
    const stop = scheduler.stop().then(() => (stopped = true));

    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await Promise.all([poll, stop]);
    expect(stopped).toBe(true);
  });
});

function account(id: string, state: 'active' | 'paused'): ConnectorAccount {
  return {
    id,
    kind: 'webdav',
    displayName: id,
    state,
    config: { provider: 'jianguoyun', rootPath: '/', initialSync: 'from-now' },
    lastSyncAt: null,
    lastSuccessAt: null,
    lastErrorCode: null,
    createdAt: 0,
    updatedAt: 0,
  };
}
