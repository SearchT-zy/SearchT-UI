import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EmailConnectorCreateInput } from '@/common/types/searcht/connectors';
import { InboxFileStore } from '@process/services/personal-core/InboxFileStore';
import { InboxService } from '@process/services/personal-core/InboxService';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import type { EmailConnectorSecret } from '@process/services/personal-core/connectors/ConnectorSecretStore';
import { EmailConnectorService } from '@process/services/personal-core/connectors/email/EmailConnectorService';
import type {
  EmailClientPort,
  EmailConnectionCredentials,
  EmailMailboxSession,
  EmailMessageMetadata,
  NormalizedEmail,
} from '@process/services/personal-core/connectors/email/types';

const NOW = Date.parse('2026-08-21T12:00:00Z');
let directory: string;
let database: PersonalDatabase;
let inbox: InboxService;
let mail: FakeMailClient;
let secrets: FakeSecretStore;
let service: EmailConnectorService;

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-email-connector-'));
  database = PersonalDatabase.open(directory);
  inbox = new InboxService(database.driver, new InboxFileStore(path.join(directory, 'personal-core', 'inbox')));
  mail = new FakeMailClient();
  secrets = new FakeSecretStore();
  service = new EmailConnectorService(database.driver, inbox, secrets, mail, path.join(directory, 'email-temp'));
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

function createInput(initialSync: EmailConnectorCreateInput['initialSync'] = 'from-now'): EmailConnectorCreateInput {
  return {
    kind: 'email-imap',
    provider: 'qq-mail',
    emailAddress: 'Person@QQ.com ',
    authorizationCode: ' authorization-code ',
    initialSync,
  };
}

function message(uid: number, receivedAt = NOW, attachments = 0): NormalizedEmail {
  return {
    uid,
    subject: `Message ${uid}`,
    fromLabel: 'Sender <sender@example.com>',
    receivedAt,
    text: `Body ${uid}`,
    contentHash: `hash-${uid}`,
    attachments: Array.from({ length: attachments }, (_, index) => ({
      key: `${uid}-${index}`,
      name: `attachment-${index}.txt`,
      mimeType: 'text/plain',
      content: Buffer.from(`attachment ${index}`),
    })),
  };
}

describe('EmailConnectorService', () => {
  it('tests normalized credentials before persisting a new account', async () => {
    const events: string[] = [];
    mail.events = events;
    secrets.events = events;

    const result = await service.create(createInput(), NOW);

    expect(events.slice(0, 2)).toEqual(['connect:person@qq.com:authorization-code', 'secret:set']);
    expect(result.connector).toMatchObject({
      kind: 'email-imap',
      displayName: 'person@qq.com',
      config: { provider: 'qq-mail', emailAddress: 'person@qq.com', mailbox: 'INBOX', initialSync: 'from-now' },
    });
    expect(JSON.stringify(result.connector)).not.toContain('authorization-code');
  });

  it('does not persist an account or secret when authentication fails', async () => {
    mail.connectError = new Error('server exposed detail');

    await expect(service.create(createInput(), NOW)).rejects.toThrow('CONNECTOR_EMAIL_CONNECTION_FAILED');

    expect(database.driver.prepare('SELECT COUNT(*) AS count FROM connector_accounts').get()).toEqual({ count: 0 });
    expect(secrets.entries.size).toBe(0);
  });

  it('uses the current highest UID without importing history for from-now', async () => {
    mail.setMessages([message(1), message(2)]);

    const result = await service.create(createInput('from-now'), NOW);

    expect(result).toMatchObject({ scanned: 0, imported: 0, reused: 0, skipped: 0, failed: 0 });
    expect(mail.listCalls).toBe(0);
    expect(inbox.list({ view: 'pending' }).total).toBe(0);
    const cursor = database.driver.prepare('SELECT cursor_json FROM connector_accounts').get() as {
      cursor_json: string;
    };
    expect(JSON.parse(cursor.cursor_json)).toEqual({ uidValidity: '42', lastUid: 2 });
  });

  it('imports only messages from the last seven days on first sync', async () => {
    mail.setMessages([message(1, NOW - 8 * 86_400_000), message(2, NOW - 2 * 86_400_000)]);

    const result = await service.create(createInput('last-7-days'), NOW);

    expect(result).toMatchObject({ scanned: 1, imported: 1, failed: 0 });
    expect(inbox.list({ view: 'pending' }).items.map((item) => item.title)).toEqual(['Message 2']);
  });

  it('imports a body and attachments once across repeated syncs', async () => {
    const created = await service.create(createInput(), NOW);
    mail.setMessages([message(1, NOW, 2)]);

    const first = await service.sync(created.connector.id, NOW + 1);
    database.driver
      .prepare('UPDATE connector_accounts SET cursor_json = ? WHERE id = ?')
      .run(JSON.stringify({ uidValidity: '42', lastUid: 0 }), created.connector.id);
    const repeated = await service.sync(created.connector.id, NOW + 2);

    expect(first).toMatchObject({ scanned: 1, imported: 1, failed: 0 });
    expect(repeated).toMatchObject({ scanned: 1, imported: 0, skipped: 1, failed: 0 });
    expect(inbox.list({ view: 'pending' }).total).toBe(3);
  });

  it('resumes after an attachment failure without duplicating the body', async () => {
    const created = await service.create(createInput(), NOW);
    mail.setMessages([message(1, NOW, 1)]);
    let failAttachment = true;
    const unreliableInbox = {
      captureText: inbox.captureText.bind(inbox),
      importFiles: async (...args: Parameters<InboxService['importFiles']>) => {
        if (failAttachment) {
          failAttachment = false;
          return { imported: [], failed: [{ name: 'attachment-0.txt', code: 'INBOX_IMPORT_FAILED' }] };
        }
        return inbox.importFiles(...args);
      },
    };
    const resumable = new EmailConnectorService(
      database.driver,
      unreliableInbox,
      secrets,
      mail,
      path.join(directory, 'email-temp')
    );

    const failed = await resumable.sync(created.connector.id, NOW + 1);
    const retried = await resumable.sync(created.connector.id, NOW + 2);

    expect(failed).toMatchObject({ imported: 0, failed: 1 });
    expect(retried).toMatchObject({ imported: 1, failed: 0 });
    expect(inbox.list({ view: 'pending' }).total).toBe(2);
    expect(database.driver.prepare('SELECT state FROM connector_ingest_records').get()).toEqual({ state: 'complete' });
  });

  it('marks UIDVALIDITY changes as needing attention without importing history', async () => {
    const created = await service.create(createInput(), NOW);
    mail.uidValidity = '99';
    mail.setMessages([message(1)]);

    await expect(service.sync(created.connector.id, NOW + 1)).rejects.toThrow('CONNECTOR_EMAIL_MAILBOX_RESET');

    expect(service.list()[0]).toMatchObject({ state: 'error', lastErrorCode: 'CONNECTOR_EMAIL_MAILBOX_RESET' });
    expect(inbox.list({ view: 'pending' }).total).toBe(0);
  });

  it('keeps imported Inbox items and deletes the secret when disconnected', async () => {
    const created = await service.create(createInput(), NOW);
    mail.setMessages([message(1)]);
    await service.sync(created.connector.id, NOW + 1);

    service.disconnect(created.connector.id, NOW + 2);

    expect(service.list()).toEqual([]);
    expect(secrets.entries.has(created.connector.id)).toBe(false);
    expect(inbox.list({ view: 'pending' }).total).toBe(1);
  });

  it('shares one in-flight sync between overlapping requests', async () => {
    const created = await service.create(createInput(), NOW);
    mail.setMessages([message(1)]);
    mail.fetchGate = new Promise<void>((resolve) => {
      mail.releaseFetch = resolve;
    });

    const first = service.sync(created.connector.id, NOW + 1);
    const second = service.sync(created.connector.id, NOW + 2);
    mail.releaseFetch?.();

    expect(second).toBe(first);
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(inbox.list({ view: 'pending' }).total).toBe(1);
  });
});

class FakeSecretStore {
  readonly entries = new Map<string, EmailConnectorSecret>();
  events: string[] = [];

  setEmail(id: string, value: EmailConnectorSecret): void {
    this.events.push('secret:set');
    this.entries.set(id, value);
  }

  getEmail(id: string): EmailConnectorSecret | null {
    return this.entries.get(id) ?? null;
  }

  delete(id: string): void {
    this.entries.delete(id);
  }
}

class FakeMailClient implements EmailClientPort {
  uidValidity = '42';
  connectError: Error | null = null;
  events: string[] = [];
  listCalls = 0;
  fetchGate: Promise<void> | null = null;
  releaseFetch: (() => void) | null = null;
  private messages: NormalizedEmail[] = [];

  setMessages(messages: NormalizedEmail[]): void {
    this.messages = messages;
  }

  async connect(credentials: EmailConnectionCredentials): Promise<EmailMailboxSession> {
    this.events.push(`connect:${credentials.emailAddress}:${credentials.authorizationCode}`);
    if (this.connectError) throw new Error('CONNECTOR_EMAIL_CONNECTION_FAILED');
    return {
      snapshot: () => ({
        uidValidity: this.uidValidity,
        highestUid: Math.max(0, ...this.messages.map((value) => value.uid)),
      }),
      list: async ({ afterUid, since, limit }) => {
        this.listCalls += 1;
        return this.messages
          .filter((value) => value.uid > afterUid && (!since || value.receivedAt >= since.getTime()))
          .slice(0, limit)
          .map(
            (value): EmailMessageMetadata => ({
              uid: value.uid,
              sizeBytes: 100,
              receivedAt: value.receivedAt,
            })
          );
      },
      fetch: async (uid) => {
        await this.fetchGate;
        const found = this.messages.find((value) => value.uid === uid);
        if (!found) throw new Error('CONNECTOR_EMAIL_FETCH_FAILED');
        return found;
      },
      close: async () => {},
    };
  }
}
