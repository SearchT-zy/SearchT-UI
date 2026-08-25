import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  ConnectorAccount,
  ConnectorSetStateInput,
  ConnectorSyncResult,
  EmailConnectorCreateInput,
  EmailConnectorTestInput,
} from '@/common/types/searcht/connectors';
import type { InboxFileImportInput, InboxImportResult, InboxItem } from '@/common/types/searcht/inbox';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import type { EmailConnectorSecret } from '../ConnectorSecretStore';
import { ConnectorRepository, type EmailConnectorCursor, type StoredConnectorAccount } from '../ConnectorRepository';
import { EmailIngestRepository, type EmailIngestRecord } from './EmailIngestRepository';
import { assertEmailAddressMatchesProvider, normalizeEmailAddress } from './providerPresets';
import type { EmailClientPort, NormalizedEmail } from './types';

const FIRST_SYNC_WINDOW_MS = 7 * 86_400_000;
const SYNC_MESSAGE_LIMIT = 50;

type EmailInboxPort = {
  captureText(input: { text: string; title?: string }, now?: number): InboxItem;
  importFiles(input: InboxFileImportInput, now?: number): Promise<InboxImportResult>;
};

type EmailSecretPort = {
  setEmail(id: string, value: EmailConnectorSecret): void;
  getEmail(id: string): EmailConnectorSecret | null;
  delete(id: string): void;
};

export class EmailConnectorService {
  private readonly repository: ConnectorRepository;
  private readonly ingest: EmailIngestRepository;
  private readonly syncLocks = new Map<string, Promise<ConnectorSyncResult>>();

  constructor(
    driver: ISqliteDriver,
    private readonly inbox: EmailInboxPort,
    private readonly secrets: EmailSecretPort,
    private readonly mail: EmailClientPort,
    private readonly temporaryRoot: string
  ) {
    this.repository = new ConnectorRepository(driver);
    this.ingest = new EmailIngestRepository(driver);
  }

  async test(input: EmailConnectorTestInput): Promise<void> {
    const normalized = normalizeCredentials(input);
    await this.testCredentials(normalized);
  }

  async create(input: EmailConnectorCreateInput, now = Date.now()): Promise<ConnectorSyncResult> {
    if (input.kind !== 'email-imap') throw new Error('CONNECTOR_KIND_UNSUPPORTED');
    const credentials = normalizeCredentials(input);
    if (input.initialSync !== 'from-now' && input.initialSync !== 'last-7-days') {
      throw new Error('CONNECTOR_EMAIL_INITIAL_SYNC_INVALID');
    }
    if (this.repository.findEmailByAddress(credentials.emailAddress)) throw new Error('CONNECTOR_ALREADY_EXISTS');
    const snapshot = await this.testCredentials(credentials);
    const account = this.repository.insert({
      id: randomUUID(),
      kind: 'email-imap',
      displayName: credentials.emailAddress,
      state: 'active',
      config: {
        provider: input.provider,
        emailAddress: credentials.emailAddress,
        mailbox: 'INBOX',
        initialSync: input.initialSync,
      },
      cursor: {
        uidValidity: snapshot.uidValidity,
        lastUid: input.initialSync === 'from-now' ? snapshot.highestUid : null,
      },
      lastSyncAt: input.initialSync === 'from-now' ? now : null,
      lastSuccessAt: input.initialSync === 'from-now' ? now : null,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    });
    try {
      this.secrets.setEmail(account.id, credentials);
    } catch (error) {
      this.repository.deletePermanently(account.id);
      throw error;
    }
    this.repository.insertAudit(randomUUID(), 'connector_create', 'success', { connectorId: account.id }, now);
    if (input.initialSync === 'last-7-days') return this.sync(account.id, now);
    return emptyResult(publicAccount(account));
  }

  list(): ConnectorAccount[] {
    return this.repository
      .list()
      .filter(
        (account): account is Extract<StoredConnectorAccount, { kind: 'email-imap' }> => account.kind === 'email-imap'
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
    const current = this.requireEmailAccount(input.id);
    const account = this.repository.setState(current.id, input.state, null, now);
    this.repository.insertAudit(
      randomUUID(),
      input.state === 'paused' ? 'connector_pause' : 'connector_resume',
      'success',
      { connectorId: input.id },
      now
    );
    return publicAccount(account);
  }

  disconnect(id: string, now = Date.now()): void {
    this.requireEmailAccount(id);
    this.repository.disconnect(id, now);
    this.secrets.delete(id);
    this.repository.insertAudit(randomUUID(), 'connector_disconnect', 'success', { connectorId: id }, now);
  }

  private async testCredentials(
    credentials: EmailConnectorSecret & { provider: EmailConnectorCreateInput['provider'] }
  ) {
    const session = await this.mail.connect({ ...credentials, provider: credentials.provider });
    try {
      return session.snapshot();
    } finally {
      await session.close();
    }
  }

  private async performSync(id: string, now: number): Promise<ConnectorSyncResult> {
    const account = this.requireEmailAccount(id);
    if (account.state === 'paused') throw new Error('CONNECTOR_PAUSED');
    const secret = this.secrets.getEmail(id);
    if (!secret) return this.failSync(account, 'CONNECTOR_EMAIL_CREDENTIAL_MISSING', now);
    let session;
    try {
      session = await this.mail.connect({ provider: account.config.provider, ...secret });
    } catch (error) {
      return this.failSync(account, connectorErrorCode(error), now);
    }
    try {
      const snapshot = session.snapshot();
      if (account.cursor.uidValidity && account.cursor.uidValidity !== snapshot.uidValidity) {
        return this.failSync(account, 'CONNECTOR_EMAIL_MAILBOX_RESET', now);
      }
      const firstSync = account.cursor.lastUid === null;
      const cursor: EmailConnectorCursor = {
        uidValidity: snapshot.uidValidity,
        lastUid: account.cursor.lastUid ?? 0,
      };
      const messages = await session.list({
        afterUid: cursor.lastUid,
        since: firstSync && account.config.initialSync === 'last-7-days' ? new Date(now - FIRST_SYNC_WINDOW_MS) : null,
        limit: SYNC_MESSAGE_LIMIT,
      });
      let imported = 0;
      let skipped = 0;
      let failed = 0;
      let errorCode: string | null = null;
      for (const metadata of messages) {
        const externalId = `${account.config.mailbox}:${snapshot.uidValidity}:${metadata.uid}`;
        const existing = this.ingest.find(id, externalId);
        if (existing?.state === 'complete') {
          skipped += 1;
          cursor.lastUid = metadata.uid;
          continue;
        }
        try {
          // oxlint-disable-next-line no-await-in-loop
          const email = await session.fetch(metadata.uid);
          // oxlint-disable-next-line no-await-in-loop
          await this.ingestEmail(account, externalId, email, existing, now);
          imported += 1;
          cursor.lastUid = metadata.uid;
        } catch (error) {
          failed += 1;
          errorCode = connectorErrorCode(error);
          break;
        }
      }
      if (firstSync && failed === 0 && messages.length < SYNC_MESSAGE_LIMIT) cursor.lastUid = snapshot.highestUid;
      const updated =
        failed === 0
          ? this.repository.recordSuccess(id, cursor, now)
          : this.repository.recordPartialFailure(id, cursor, errorCode!, now);
      const result = {
        connector: publicAccount(updated),
        scanned: messages.length,
        imported,
        reused: 0,
        skipped,
        failed,
      };
      this.repository.insertAudit(
        randomUUID(),
        'connector_sync',
        failed === 0 ? 'success' : 'failure',
        { connectorId: id, scanned: messages.length, imported, skipped, failed, code: errorCode },
        now
      );
      return result;
    } catch (error) {
      return this.failSync(account, connectorErrorCode(error), now);
    } finally {
      try {
        await session.close();
      } catch {
        // Sync state is based on completed reads; closing errors contain no actionable user detail.
      }
    }
  }

  private async ingestEmail(
    account: Extract<StoredConnectorAccount, { kind: 'email-imap' }>,
    externalId: string,
    email: NormalizedEmail,
    existing: EmailIngestRecord | null,
    now: number
  ): Promise<void> {
    let record = existing ?? this.ingest.begin(account.id, externalId, email.contentHash, now);
    if (record.contentHash !== email.contentHash) throw new Error('CONNECTOR_EMAIL_CONTENT_CHANGED');
    if (record.inboxItemIds.length === 0) {
      const body = this.inbox.captureText(
        {
          title: email.subject.trim() || 'No subject',
          text: `From: ${email.fromLabel}\nReceived: ${new Date(email.receivedAt).toISOString()}\n\n${email.text}`,
        },
        now
      );
      record = this.ingest.appendInboxItem(account.id, externalId, body.id, now);
    }
    const importedAttachmentCount = record.inboxItemIds.length - 1;
    if (importedAttachmentCount > email.attachments.length) throw new Error('CONNECTOR_EMAIL_INGEST_RECORD_INVALID');
    if (importedAttachmentCount < email.attachments.length) {
      mkdirSync(this.temporaryRoot, { recursive: true, mode: 0o700 });
      const temporaryDirectory = mkdtempSync(path.join(this.temporaryRoot, 'message-'));
      try {
        for (let index = importedAttachmentCount; index < email.attachments.length; index += 1) {
          const attachment = email.attachments[index]!;
          const name = safeAttachmentName(attachment.name, index);
          const temporaryPath = path.join(temporaryDirectory, `${index}-${name}`);
          writeFileSync(temporaryPath, attachment.content, { mode: 0o600 });
          // oxlint-disable-next-line no-await-in-loop
          const result = await this.inbox.importFiles(
            {
              files: [
                {
                  kind: 'path',
                  name: attachment.name || name,
                  path: temporaryPath,
                  sizeBytes: attachment.content.length,
                  mimeType: attachment.mimeType,
                },
              ],
            },
            now
          );
          const imported = result.imported[0];
          if (!imported) throw new Error(result.failed[0]?.code ?? 'INBOX_IMPORT_FAILED');
          record = this.ingest.appendInboxItem(account.id, externalId, imported.detail.item.id, now);
        }
      } finally {
        rmSync(temporaryDirectory, { recursive: true, force: true });
      }
    }
    this.ingest.complete(account.id, externalId, now);
  }

  private requireEmailAccount(id: string): Extract<StoredConnectorAccount, { kind: 'email-imap' }> {
    const account = this.repository.findById(id);
    if (!account) throw new Error('CONNECTOR_NOT_FOUND');
    if (account.kind !== 'email-imap') throw new Error('CONNECTOR_KIND_UNSUPPORTED');
    return account;
  }

  private failSync(account: StoredConnectorAccount, code: string, now: number): never {
    this.repository.recordFailure(account.id, code, now);
    this.repository.insertAudit(randomUUID(), 'connector_sync', 'failure', { connectorId: account.id, code }, now);
    throw new Error(code);
  }
}

function normalizeCredentials(input: EmailConnectorTestInput | EmailConnectorCreateInput) {
  if (input.provider !== 'qq-mail' && input.provider !== 'netease-163') {
    throw new Error('CONNECTOR_EMAIL_PROVIDER_UNSUPPORTED');
  }
  const emailAddress = normalizeEmailAddress(input.emailAddress);
  assertEmailAddressMatchesProvider(input.provider, emailAddress);
  const authorizationCode = input.authorizationCode.trim();
  if (!authorizationCode || authorizationCode.length > 4096) throw new Error('CONNECTOR_EMAIL_AUTHORIZATION_REQUIRED');
  return { provider: input.provider, emailAddress, authorizationCode };
}

function publicAccount(account: StoredConnectorAccount): ConnectorAccount {
  const base = {
    id: account.id,
    displayName: account.displayName,
    state: account.state,
    lastSyncAt: account.lastSyncAt,
    lastSuccessAt: account.lastSuccessAt,
    lastErrorCode: account.lastErrorCode,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
  if (account.kind === 'local-folder') return { ...base, kind: account.kind, config: account.config };
  if (account.kind === 'email-imap') return { ...base, kind: account.kind, config: account.config };
  return { ...base, kind: account.kind, config: account.config } as ConnectorAccount;
}

function emptyResult(connector: ConnectorAccount): ConnectorSyncResult {
  return { connector, scanned: 0, imported: 0, reused: 0, skipped: 0, failed: 0 };
}

function connectorErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) return error.message;
  return 'CONNECTOR_EMAIL_SYNC_FAILED';
}

function safeAttachmentName(value: string, index: number): string {
  const invalidCharacters = '<>:"/\\|?*';
  const name = [...path.basename(value)]
    .map((character) => (character.charCodeAt(0) < 32 || invalidCharacters.includes(character) ? '_' : character))
    .join('')
    .trim();
  return name || `attachment-${index + 1}`;
}
