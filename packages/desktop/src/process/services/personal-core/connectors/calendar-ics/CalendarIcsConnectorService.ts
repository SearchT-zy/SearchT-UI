import { randomUUID, createHash } from 'node:crypto';
import type {
  CalendarIcsConnectorAccount,
  ConnectorAccount,
  ConnectorSetStateInput,
  ConnectorSyncResult,
  CalendarIcsConnectorCreateInput,
  CalendarIcsConnectorTestInput,
} from '@/common/types/searcht/connectors';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import type { CalendarIcsConnectorSecret } from '../ConnectorSecretStore';
import {
  ConnectorRepository,
  type CalendarIcsConnectorCursor,
  type StoredConnectorAccount,
} from '../ConnectorRepository';
import { resolveCalendarIcsConnection } from './providerPresets';
import { parseIcsCalendar } from './icsParser';
import { IcsCalendarIngestRepository } from './IcsCalendarIngestRepository';
import type { IcsCalendarClient } from './IcsCalendarClient';

type IcsSecretPort = {
  setCalendarIcs(id: string, value: CalendarIcsConnectorSecret): void;
  getCalendarIcs(id: string): CalendarIcsConnectorSecret | null;
  delete(id: string): void;
};

type IcsClientPort = Pick<IcsCalendarClient, 'fetchCalendar'>;

const PROVIDER_DISPLAY_NAMES: Record<CalendarIcsConnectorAccount['config']['provider'], string> = {
  feishu: 'Feishu Calendar',
  outlook: 'Outlook Calendar',
  dingtalk: 'DingTalk Calendar',
  wecom: 'WeCom Calendar',
  'custom-ics': 'Calendar subscription',
};

export class CalendarIcsConnectorService {
  private readonly repository: ConnectorRepository;
  private readonly ingest: IcsCalendarIngestRepository;
  private readonly syncLocks = new Map<string, Promise<ConnectorSyncResult>>();

  constructor(
    driver: ISqliteDriver,
    private readonly secrets: IcsSecretPort,
    private readonly remote: IcsClientPort,
    private readonly timezone: string = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  ) {
    this.repository = new ConnectorRepository(driver);
    this.ingest = new IcsCalendarIngestRepository(driver);
  }

  async test(input: CalendarIcsConnectorTestInput): Promise<void> {
    const connection = resolveCalendarIcsConnection(input);
    try {
      await this.remote.fetchCalendar(connection.url);
    } catch (error) {
      // Raw transport errors can contain server response details and must not cross IPC.
      // oxlint-disable-next-line preserve-caught-error
      throw new Error(icsErrorCode(error));
    }
  }

  async create(input: CalendarIcsConnectorCreateInput, now = Date.now()): Promise<ConnectorSyncResult> {
    if (input.kind !== 'calendar-ics' || input.initialSync !== 'import-existing') {
      throw new Error('CONNECTOR_KIND_UNSUPPORTED');
    }
    const connection = resolveCalendarIcsConnection(input);
    const displayName = input.displayName?.trim() || PROVIDER_DISPLAY_NAMES[input.provider];
    if (displayName.length > 200) throw new Error('CONNECTOR_DISPLAY_NAME_INVALID');
    if (this.repository.findCalendarIcs(input.provider)) throw new Error('CONNECTOR_ALREADY_EXISTS');

    let body: string;
    try {
      body = await this.remote.fetchCalendar(connection.url);
    } catch (error) {
      // oxlint-disable-next-line preserve-caught-error
      throw new Error(icsErrorCode(error));
    }

    const account = this.repository.insert({
      id: randomUUID(),
      kind: 'calendar-ics',
      displayName,
      state: 'active',
      config: { provider: input.provider, initialSync: 'import-existing' },
      cursor: { bodyFingerprint: null, eventIds: [] },
      lastSyncAt: null,
      lastSuccessAt: null,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    });
    try {
      this.secrets.setCalendarIcs(account.id, { url: connection.url });
    } catch (error) {
      this.repository.deletePermanently(account.id);
      throw error;
    }
    this.repository.insertAudit(
      randomUUID(),
      'connector_create',
      'success',
      { connectorId: account.id, provider: input.provider },
      now
    );
    const applied = this.applyFeed(requireKind(account), body, now);
    return {
      connector: publicAccount(requireKind(applied.account)),
      scanned: applied.scanned,
      imported: applied.imported,
      reused: applied.updated,
      skipped: applied.skipped,
      failed: 0,
    };
  }

  list(): ConnectorAccount[] {
    return this.repository
      .list()
      .filter(
        (account): account is Extract<StoredConnectorAccount, { kind: 'calendar-ics' }> =>
          account.kind === 'calendar-ics'
      )
      .map(publicAccount);
  }

  sync(id: string, now = Date.now()): Promise<ConnectorSyncResult> {
    const running = this.syncLocks.get(id);
    if (running) return running;
    const operation = this.performSync(id, now).finally(() => {
      if (this.syncLocks.get(id) === operation) this.syncLocks.delete(id);
    });
    this.syncLocks.set(id, operation);
    return operation;
  }

  setState(input: ConnectorSetStateInput, now = Date.now()): ConnectorAccount {
    const current = this.requireIcsAccount(input.id);
    const account = this.repository.setState(current.id, input.state, null, now);
    this.repository.insertAudit(
      randomUUID(),
      input.state === 'paused' ? 'connector_pause' : 'connector_resume',
      'success',
      { connectorId: input.id },
      now
    );
    return publicAccount(requireKind(account));
  }

  disconnect(id: string, now = Date.now()): void {
    const account = this.requireIcsAccount(id);
    this.repository.disconnect(id, now);
    this.secrets.delete(id);
    this.repository.insertAudit(
      randomUUID(),
      'connector_disconnect',
      'success',
      { connectorId: id, removedEvents: this.ingest.removeAll(now) },
      now
    );
  }

  private async performSync(id: string, now: number): Promise<ConnectorSyncResult> {
    const account = this.requireIcsAccount(id);
    if (account.state === 'paused') throw new Error('CONNECTOR_PAUSED');
    const secret = this.secrets.getCalendarIcs(id);
    if (!secret) {
      this.repository.recordFailure(id, 'CONNECTOR_ICS_CREDENTIAL_MISSING', now);
      this.repository.insertAudit(
        randomUUID(),
        'connector_sync',
        'failure',
        { connectorId: id, code: 'CONNECTOR_ICS_CREDENTIAL_MISSING' },
        now
      );
      throw new Error('CONNECTOR_ICS_CREDENTIAL_MISSING');
    }
    let body: string;
    try {
      body = await this.remote.fetchCalendar(secret.url);
    } catch (error) {
      const code = icsErrorCode(error);
      this.repository.recordFailure(id, code, now);
      this.repository.insertAudit(randomUUID(), 'connector_sync', 'failure', { connectorId: id, code }, now);
      throw new Error(code);
    }
    const applied = this.applyFeed(requireKind(account), body, now);
    return {
      connector: publicAccount(requireKind(applied.account)),
      scanned: applied.scanned,
      imported: applied.imported,
      reused: applied.updated,
      skipped: applied.skipped,
      failed: 0,
    };
  }

  private applyFeed(
    account: Extract<StoredConnectorAccount, { kind: 'calendar-ics' }>,
    body: string,
    now: number
  ): {
    account: StoredConnectorAccount;
    scanned: number;
    imported: number;
    updated: number;
    skipped: number;
  } {
    const fingerprint = createHash('sha256').update(body).digest('hex');
    const cursor = account.cursor as CalendarIcsConnectorCursor;
    if (cursor.bodyFingerprint === fingerprint) {
      return { account, scanned: cursor.eventIds.length, imported: 0, updated: 0, skipped: cursor.eventIds.length };
    }
    const parsed = parseIcsCalendar(body);
    const applied = this.ingest.applyEvents(parsed.events, this.timezone, now);
    const updated = this.repository.recordSuccess(
      account.id,
      { bodyFingerprint: fingerprint, eventIds: applied.eventIds },
      now
    );
    this.repository.insertAudit(
      randomUUID(),
      'connector_sync',
      'success',
      {
        connectorId: account.id,
        scanned: parsed.events.length + parsed.skipped,
        imported: applied.imported,
        updated: applied.updated,
        removed: applied.removed,
        skipped: parsed.skipped,
      },
      now
    );
    return {
      account: updated,
      scanned: parsed.events.length + parsed.skipped,
      imported: applied.imported,
      updated: applied.updated,
      skipped: parsed.skipped,
    };
  }

  private requireIcsAccount(id: string): Extract<StoredConnectorAccount, { kind: 'calendar-ics' }> {
    const account = this.repository.findById(id);
    if (!account) throw new Error('CONNECTOR_NOT_FOUND');
    if (account.kind !== 'calendar-ics') throw new Error('CONNECTOR_KIND_UNSUPPORTED');
    return account;
  }
}

function requireKind(account: StoredConnectorAccount): Extract<StoredConnectorAccount, { kind: 'calendar-ics' }> {
  if (account.kind !== 'calendar-ics') throw new Error('CONNECTOR_KIND_UNSUPPORTED');
  return account;
}

function publicAccount(account: Extract<StoredConnectorAccount, { kind: 'calendar-ics' }>): ConnectorAccount {
  return {
    id: account.id,
    kind: account.kind,
    displayName: account.displayName,
    state: account.state,
    config: account.config,
    lastSyncAt: account.lastSyncAt,
    lastSuccessAt: account.lastSuccessAt,
    lastErrorCode: account.lastErrorCode,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function icsErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) return error.message;
  return 'CONNECTOR_ICS_CONNECTION_FAILED';
}
