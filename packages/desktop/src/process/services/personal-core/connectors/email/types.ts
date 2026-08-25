import type { EmailProvider } from '@/common/types/searcht/connectors';

export type EmailConnectionCredentials = {
  provider: EmailProvider;
  emailAddress: string;
  authorizationCode: string;
};

export type EmailMailboxSnapshot = {
  uidValidity: string;
  highestUid: number;
};

export type EmailMessageMetadata = {
  uid: number;
  sizeBytes: number;
  receivedAt: number;
};

export type NormalizedEmailAttachment = {
  key: string;
  name: string;
  mimeType: string;
  content: Buffer;
};

export type NormalizedEmail = {
  uid: number;
  subject: string;
  fromLabel: string;
  receivedAt: number;
  text: string;
  contentHash: string;
  attachments: NormalizedEmailAttachment[];
};

export type EmailMessageListInput = {
  afterUid: number;
  since: Date | null;
  limit: number;
};

export type EmailMailboxSession = {
  snapshot(): EmailMailboxSnapshot;
  list(input: EmailMessageListInput): Promise<EmailMessageMetadata[]>;
  fetch(uid: number): Promise<NormalizedEmail>;
  close(): Promise<void>;
};

export type EmailClientPort = {
  connect(credentials: EmailConnectionCredentials): Promise<EmailMailboxSession>;
};

export type ImapClientOptions = {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
  logger: false;
  tls: { rejectUnauthorized: true };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
};

export type ImapFetchQuery = {
  uid?: boolean;
  size?: boolean;
  internalDate?: boolean;
  source?: boolean;
};

export type ImapFetchedMessage = {
  uid: number;
  size?: number;
  internalDate?: Date;
  source?: Buffer;
};

export type ImapTransport = {
  connect(): Promise<void>;
  logout(): Promise<void>;
  getMailboxLock(path: string, options: { readOnly: true }): Promise<{ release(): void }>;
  mailbox: false | { uidValidity: bigint; uidNext: number };
  search(query: { uid: string; since?: Date }, options: { uid: true }): Promise<number[] | false>;
  fetchOne(uid: number, query: ImapFetchQuery, options: { uid: true }): Promise<ImapFetchedMessage | false>;
};

export type ImapClientFactory = (options: ImapClientOptions) => ImapTransport;

export type ParsedEmail = {
  subject: string;
  fromLabel: string;
  receivedAt: number | null;
  text: string;
  attachments: Array<{ name: string; mimeType: string; content: Buffer }>;
};

export type EmailParser = (source: Buffer) => Promise<ParsedEmail>;
