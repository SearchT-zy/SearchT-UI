import { describe, expect, it, vi } from 'vitest';
import { ImapEmailClient } from '@process/services/personal-core/connectors/email/ImapEmailClient';
import type {
  ImapClientFactory,
  ImapTransport,
  ParsedEmail,
} from '@process/services/personal-core/connectors/email/types';

const MB = 1024 * 1024;

function makeTransport(overrides: Partial<ImapTransport> = {}) {
  const release = vi.fn();
  const transport: ImapTransport & {
    messageFlagsAdd: ReturnType<typeof vi.fn>;
    messageMove: ReturnType<typeof vi.fn>;
    messageDelete: ReturnType<typeof vi.fn>;
  } = {
    connect: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    getMailboxLock: vi.fn(async () => ({ release })),
    mailbox: { uidValidity: 42n, uidNext: 8 },
    search: vi.fn(async () => [7]),
    fetchOne: vi.fn(async (_uid, query) =>
      query.source
        ? { uid: 7, size: 128, internalDate: new Date('2026-08-21T01:00:00Z'), source: Buffer.from('raw') }
        : { uid: 7, size: 128, internalDate: new Date('2026-08-21T01:00:00Z') }
    ),
    messageFlagsAdd: vi.fn(),
    messageMove: vi.fn(),
    messageDelete: vi.fn(),
    ...overrides,
  };
  return { transport, release };
}

function makeClient(transport: ImapTransport, parsed: Partial<ParsedEmail> = {}) {
  const factory = vi.fn<ImapClientFactory>(() => transport);
  const parser = vi.fn(
    async (): Promise<ParsedEmail> => ({
      subject: 'Subject',
      fromLabel: 'Sender <sender@example.com>',
      receivedAt: 1_776_729_600_000,
      text: 'Body',
      attachments: [],
      ...parsed,
    })
  );
  return { client: new ImapEmailClient(factory, parser), factory, parser };
}

describe('ImapEmailClient', () => {
  it('opens INBOX read-only and fetches normalized messages without mutating server state', async () => {
    const { transport, release } = makeTransport();
    const { client, factory } = makeClient(transport);

    const session = await client.connect({
      provider: 'qq-mail',
      emailAddress: 'person@qq.com',
      authorizationCode: 'authorization-code',
    });
    const snapshot = session.snapshot();
    const messages = await session.list({ afterUid: 6, since: null, limit: 50 });
    const email = await session.fetch(7);
    await session.close();

    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'imap.qq.com',
        port: 993,
        secure: true,
        auth: { user: 'person@qq.com', pass: 'authorization-code' },
        logger: false,
        tls: { rejectUnauthorized: true },
      })
    );
    expect(transport.getMailboxLock).toHaveBeenCalledWith('INBOX', { readOnly: true });
    expect(snapshot).toEqual({ uidValidity: '42', highestUid: 7 });
    expect(messages).toEqual([{ uid: 7, sizeBytes: 128, receivedAt: 1_787_274_000_000 }]);
    expect(email).toMatchObject({ uid: 7, subject: 'Subject', text: 'Body', attachments: [] });
    expect(release).toHaveBeenCalledOnce();
    expect(transport.messageFlagsAdd).not.toHaveBeenCalled();
    expect(transport.messageMove).not.toHaveBeenCalled();
    expect(transport.messageDelete).not.toHaveBeenCalled();
  });

  it('rejects raw messages above 25 MB before downloading source', async () => {
    const { transport } = makeTransport({
      fetchOne: vi.fn(async (_uid, query) =>
        query.source
          ? { uid: 7, size: 26 * MB, internalDate: new Date(), source: Buffer.from('must-not-download') }
          : { uid: 7, size: 26 * MB, internalDate: new Date() }
      ),
    });
    const { client, parser } = makeClient(transport);
    const session = await client.connect({
      provider: 'qq-mail',
      emailAddress: 'person@qq.com',
      authorizationCode: 'authorization-code',
    });

    await expect(session.fetch(7)).rejects.toThrow('CONNECTOR_EMAIL_TOO_LARGE');
    expect(parser).not.toHaveBeenCalled();
    expect(transport.fetchOne).toHaveBeenCalledOnce();
    await session.close();
  });

  it('rejects parsed attachments above 20 MB', async () => {
    const { transport } = makeTransport();
    const { client } = makeClient(transport, {
      attachments: [{ name: 'large.bin', mimeType: 'application/octet-stream', content: Buffer.alloc(20 * MB + 1) }],
    });
    const session = await client.connect({
      provider: 'netease-163',
      emailAddress: 'person@163.com',
      authorizationCode: 'authorization-code',
    });

    await expect(session.fetch(7)).rejects.toThrow('CONNECTOR_EMAIL_ATTACHMENT_TOO_LARGE');
    await session.close();
  });
});
