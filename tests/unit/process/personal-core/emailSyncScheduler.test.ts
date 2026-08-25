import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailSyncScheduler } from '@process/services/personal-core/connectors/email/EmailSyncScheduler';

afterEach(() => vi.useRealTimers());

describe('EmailSyncScheduler', () => {
  it('runs immediately every five minutes and only syncs active email accounts', async () => {
    vi.useFakeTimers();
    const service = {
      list: vi.fn(() => [
        { id: 'email-active', kind: 'email-imap', state: 'active' },
        { id: 'email-paused', kind: 'email-imap', state: 'paused' },
        { id: 'folder', kind: 'local-folder', state: 'active' },
      ]),
      sync: vi.fn(async () => undefined),
    };
    const scheduler = new EmailSyncScheduler(service as never);

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.sync.mock.calls.map(([id]) => id)).toEqual(['email-active']);

    await vi.advanceTimersByTimeAsync(300_000);
    expect(service.sync).toHaveBeenCalledTimes(2);
    await scheduler.stop();
  });

  it('isolates account failures and waits for the in-flight poll when stopping', async () => {
    let releaseSync: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    const service = {
      list: vi.fn(() => [
        { id: 'failing', kind: 'email-imap', state: 'error' },
        { id: 'waiting', kind: 'email-imap', state: 'active' },
      ]),
      sync: vi.fn((id: string) => (id === 'failing' ? Promise.reject(new Error('failed')) : gate)),
    };
    const scheduler = new EmailSyncScheduler(service as never, 1_000);
    scheduler.start();
    await vi.waitFor(() => expect(service.sync).toHaveBeenCalledTimes(2));

    let stopped = false;
    const stopping = scheduler.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    releaseSync?.();
    await stopping;
    expect(stopped).toBe(true);
  });
});
