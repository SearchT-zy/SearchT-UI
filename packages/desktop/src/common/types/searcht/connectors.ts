export type ConnectorKind = 'local-folder' | 'email-imap' | 'webdav' | 's3' | 'calendar-ics';

export type ConnectorState = 'active' | 'paused' | 'error';

export type EmailProvider = 'qq-mail' | 'netease-163';

export type EmailInitialSync = 'from-now' | 'last-7-days';

export type WebDavProvider = 'jianguoyun' | 'custom-webdav';

export type WebDavInitialSync = 'from-now' | 'import-existing';

export type S3Provider = 'aws-s3' | 'cloudflare-r2' | 'custom-s3';

export type S3InitialSync = 'from-now' | 'import-existing';

export type CalendarIcsProvider = 'feishu' | 'outlook' | 'dingtalk' | 'wecom' | 'custom-ics';

export type LocalFolderConnectorConfig = {
  path: string;
  includeSubfolders: boolean;
};

export type EmailConnectorConfig = {
  provider: EmailProvider;
  emailAddress: string;
  mailbox: 'INBOX';
  initialSync: EmailInitialSync;
};

export type WebDavConnectorConfig = {
  provider: WebDavProvider;
  rootPath: string;
  initialSync: WebDavInitialSync;
};

export type S3ConnectorConfig = {
  provider: S3Provider;
  bucket: string;
  prefix: string;
  pathStyle: boolean;
  initialSync: S3InitialSync;
};

export type CalendarIcsConnectorConfig = {
  provider: CalendarIcsProvider;
  initialSync: 'import-existing';
};

type ConnectorAccountBase = {
  id: string;
  displayName: string;
  state: ConnectorState;
  lastSyncAt: number | null;
  lastSuccessAt: number | null;
  lastErrorCode: string | null;
  createdAt: number;
  updatedAt: number;
};

export type LocalFolderConnectorAccount = ConnectorAccountBase & {
  kind: 'local-folder';
  config: LocalFolderConnectorConfig;
};

export type EmailConnectorAccount = ConnectorAccountBase & {
  kind: 'email-imap';
  config: EmailConnectorConfig;
};

export type WebDavConnectorAccount = ConnectorAccountBase & {
  kind: 'webdav';
  config: WebDavConnectorConfig;
};

export type S3ConnectorAccount = ConnectorAccountBase & {
  kind: 's3';
  config: S3ConnectorConfig;
};

export type CalendarIcsConnectorAccount = ConnectorAccountBase & {
  kind: 'calendar-ics';
  config: CalendarIcsConnectorConfig;
};

export type ConnectorAccount =
  | LocalFolderConnectorAccount
  | EmailConnectorAccount
  | WebDavConnectorAccount
  | S3ConnectorAccount
  | CalendarIcsConnectorAccount;

export type LocalFolderConnectorCreateInput = {
  kind: 'local-folder';
  displayName?: string;
  path: string;
  includeSubfolders: boolean;
};

export type EmailConnectorCreateInput = {
  kind: 'email-imap';
  provider: EmailProvider;
  emailAddress: string;
  authorizationCode: string;
  initialSync: EmailInitialSync;
};

export type EmailConnectorTestInput = Omit<EmailConnectorCreateInput, 'kind' | 'initialSync'>;

export type WebDavConnectorTestInput = {
  provider: WebDavProvider;
  serverUrl?: string;
  username: string;
  password: string;
  rootPath: string;
};

export type WebDavConnectorCreateInput = WebDavConnectorTestInput & {
  kind: 'webdav';
  displayName?: string;
  initialSync: WebDavInitialSync;
};

export type S3ConnectorTestInput = {
  provider: S3Provider;
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix?: string;
  pathStyle?: boolean;
};

export type S3ConnectorCreateInput = S3ConnectorTestInput & {
  kind: 's3';
  displayName?: string;
  initialSync: S3InitialSync;
};

export type CalendarIcsConnectorTestInput = {
  provider: CalendarIcsProvider;
  url: string;
};

export type CalendarIcsConnectorCreateInput = CalendarIcsConnectorTestInput & {
  kind: 'calendar-ics';
  displayName?: string;
  initialSync: 'import-existing';
};

export type ConnectorCreateInput =
  | LocalFolderConnectorCreateInput
  | EmailConnectorCreateInput
  | WebDavConnectorCreateInput
  | S3ConnectorCreateInput
  | CalendarIcsConnectorCreateInput;

export type ConnectorSetStateInput = {
  id: string;
  state: Extract<ConnectorState, 'active' | 'paused'>;
};

export type ConnectorSyncResult = {
  connector: ConnectorAccount;
  scanned: number;
  imported: number;
  reused: number;
  skipped: number;
  failed: number;
};
