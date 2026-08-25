import type { ConnectorAccount } from '@/common/types/searcht/connectors';

type ConnectorSyncService = {
  list(): ConnectorAccount[];
  sync(id: string): Promise<unknown>;
};

const DEFAULT_SYNC_INTERVAL_MS = 600_000;

/** Shared periodic read-only sync loop used by WebDAV, S3, and calendar subscriptions. */
export class ConnectorPeriodicSyncScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private activePoll: Promise<void> | null = null;

  constructor(
    private readonly service: ConnectorSyncService,
    private readonly kind: ConnectorAccount['kind'],
    private readonly intervalMs = DEFAULT_SYNC_INTERVAL_MS
  ) {}

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.activePoll;
  }

  poll(): Promise<void> {
    if (this.activePoll) return this.activePoll;
    const operation = this.performPoll().finally(() => {
      if (this.activePoll === operation) this.activePoll = null;
    });
    this.activePoll = operation;
    return operation;
  }

  private async performPoll(): Promise<void> {
    const connected = this.service.list().filter((account) => account.kind === this.kind && account.state !== 'paused');
    await Promise.allSettled(connected.map((account) => this.service.sync(account.id)));
  }
}
