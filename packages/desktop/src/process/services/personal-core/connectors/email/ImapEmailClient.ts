import { createHash } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { resolveEmailProvider } from './providerPresets';
import type {
  EmailClientPort,
  EmailConnectionCredentials,
  EmailMailboxSession,
  EmailMessageListInput,
  EmailMessageMetadata,
  EmailParser,
  ImapClientFactory,
  ImapClientOptions,
  ImapFetchedMessage,
  ImapTransport,
  NormalizedEmail,
  ParsedEmail,
} from './types';

const MAX_RAW_EMAIL_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const defaultFactory: ImapClientFactory = (options) => new ImapFlow(options) as unknown as ImapTransport;

const defaultParser: EmailParser = async (source) => {
  const parsed = await simpleParser(source);
  return {
    subject: parsed.subject ?? '',
    fromLabel: parsed.from?.text ?? '',
    receivedAt: parsed.date?.getTime() ?? null,
    text: parsed.text ?? '',
    attachments: parsed.attachments.map((attachment, index) => ({
      name: attachment.filename || `attachment-${index + 1}`,
      mimeType: attachment.contentType || 'application/octet-stream',
      content: attachment.content,
    })),
  };
};

export class ImapEmailClient implements EmailClientPort {
  constructor(
    private readonly factory: ImapClientFactory = defaultFactory,
    private readonly parser: EmailParser = defaultParser
  ) {}

  async connect(credentials: EmailConnectionCredentials): Promise<EmailMailboxSession> {
    const preset = resolveEmailProvider(credentials.provider);
    const options: ImapClientOptions = {
      ...preset,
      auth: { user: credentials.emailAddress, pass: credentials.authorizationCode },
      logger: false,
      tls: { rejectUnauthorized: true },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 60_000,
    };
    const transport = this.factory(options);
    let lock: { release(): void } | null = null;
    try {
      await transport.connect();
      lock = await transport.getMailboxLock('INBOX', { readOnly: true });
      if (!transport.mailbox) throw new Error();
      return new ImapMailboxSession(transport, lock, this.parser);
    } catch {
      lock?.release();
      try {
        await transport.logout();
      } catch {
        // Connection errors are intentionally redacted below.
      }
      throw new Error('CONNECTOR_EMAIL_CONNECTION_FAILED');
    }
  }
}

class ImapMailboxSession implements EmailMailboxSession {
  private closed = false;

  constructor(
    private readonly transport: ImapTransport,
    private readonly lock: { release(): void },
    private readonly parser: EmailParser
  ) {}

  snapshot() {
    const mailbox = this.transport.mailbox;
    if (!mailbox) throw new Error('CONNECTOR_EMAIL_MAILBOX_UNAVAILABLE');
    return { uidValidity: mailbox.uidValidity.toString(), highestUid: Math.max(0, mailbox.uidNext - 1) };
  }

  async list(input: EmailMessageListInput): Promise<EmailMessageMetadata[]> {
    if (!Number.isInteger(input.afterUid) || input.afterUid < 0 || !Number.isInteger(input.limit) || input.limit < 1) {
      throw new Error('CONNECTOR_EMAIL_QUERY_INVALID');
    }
    const query: { uid: string; since?: Date } = { uid: `${input.afterUid + 1}:*` };
    if (input.since) query.since = input.since;
    const found = await this.transport.search(query, { uid: true });
    const uids = (found || [])
      .filter((uid) => Number.isInteger(uid) && uid > input.afterUid)
      .toSorted((left, right) => left - right)
      .slice(0, input.limit);
    const messages: EmailMessageMetadata[] = [];
    for (const uid of uids) {
      // Keep metadata reads sequential to bound traffic against consumer mail servers.
      // oxlint-disable-next-line no-await-in-loop
      const metadata = await this.fetchMetadata(uid);
      messages.push(metadata);
    }
    return messages;
  }

  async fetch(uid: number): Promise<NormalizedEmail> {
    const metadata = await this.fetchMetadata(uid);
    if (metadata.sizeBytes > MAX_RAW_EMAIL_BYTES) throw new Error('CONNECTOR_EMAIL_TOO_LARGE');
    const fetched = await this.transport.fetchOne(
      uid,
      { uid: true, size: true, internalDate: true, source: true },
      { uid: true }
    );
    if (!fetched || !fetched.source) throw new Error('CONNECTOR_EMAIL_FETCH_FAILED');
    if ((fetched.size ?? fetched.source.length) > MAX_RAW_EMAIL_BYTES || fetched.source.length > MAX_RAW_EMAIL_BYTES) {
      throw new Error('CONNECTOR_EMAIL_TOO_LARGE');
    }
    const parsed = await this.parser(fetched.source);
    return normalizeEmail(uid, metadata.receivedAt, fetched.source, parsed);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.lock.release();
    try {
      await this.transport.logout();
    } catch {
      throw new Error('CONNECTOR_EMAIL_CLOSE_FAILED');
    }
  }

  private async fetchMetadata(uid: number): Promise<EmailMessageMetadata> {
    const fetched = await this.transport.fetchOne(uid, { uid: true, size: true, internalDate: true }, { uid: true });
    assertFetchedMetadata(fetched);
    return { uid: fetched.uid, sizeBytes: fetched.size, receivedAt: fetched.internalDate.getTime() };
  }
}

function assertFetchedMetadata(
  fetched: ImapFetchedMessage | false
): asserts fetched is ImapFetchedMessage & { size: number; internalDate: Date } {
  if (!fetched || !Number.isFinite(fetched.size) || fetched.size! < 0 || !(fetched.internalDate instanceof Date)) {
    throw new Error('CONNECTOR_EMAIL_METADATA_INVALID');
  }
}

function normalizeEmail(uid: number, fallbackReceivedAt: number, source: Buffer, parsed: ParsedEmail): NormalizedEmail {
  const attachments = parsed.attachments.map((attachment) => {
    if (attachment.content.length > MAX_ATTACHMENT_BYTES) throw new Error('CONNECTOR_EMAIL_ATTACHMENT_TOO_LARGE');
    return {
      key: createHash('sha256').update(attachment.content).digest('hex'),
      name: attachment.name,
      mimeType: attachment.mimeType,
      content: attachment.content,
    };
  });
  return {
    uid,
    subject: parsed.subject,
    fromLabel: parsed.fromLabel,
    receivedAt: parsed.receivedAt ?? fallbackReceivedAt,
    text: parsed.text,
    contentHash: createHash('sha256').update(source).digest('hex'),
    attachments,
  };
}
