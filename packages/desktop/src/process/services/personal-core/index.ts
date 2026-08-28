import { getDataPath } from '@process/utils';
import nodePath from 'node:path';
import { PersonalDatabase } from './PersonalDatabase';
import { CalendarRepository } from './CalendarRepository';
import { ReminderScheduler } from './ReminderScheduler';
import type { Reminder } from '@/common/types/searcht/calendar';
import { InboxFileStore } from './InboxFileStore';
import { InboxService } from './InboxService';
import { LocalFolderConnectorService } from './connectors/LocalFolderConnectorService';
import { LocalFolderSyncScheduler } from './connectors/LocalFolderSyncScheduler';
import { ConnectorSecretStore, type ConnectorSecretCipher } from './connectors/ConnectorSecretStore';
import { EmailConnectorService } from './connectors/email/EmailConnectorService';
import { EmailSyncScheduler } from './connectors/email/EmailSyncScheduler';
import { ImapEmailClient } from './connectors/email/ImapEmailClient';
import { WebDavConnectorService } from './connectors/webdav/WebDavConnectorService';
import { WebDavReadClient } from './connectors/webdav/WebDavReadClient';
import { WebDavSyncScheduler } from './connectors/webdav/WebDavSyncScheduler';
import { S3ConnectorService } from './connectors/s3/S3ConnectorService';
import { S3ReadClient } from './connectors/s3/S3ReadClient';
import { CalendarIcsConnectorService } from './connectors/calendar-ics/CalendarIcsConnectorService';
import { IcsCalendarClient } from './connectors/calendar-ics/IcsCalendarClient';
import { ConnectorPeriodicSyncScheduler } from './connectors/ConnectorPeriodicSyncScheduler';
import { CloudSyncService } from './cloudSync/CloudSyncService';
import { createS3SyncTransport, createWebDavSyncTransport } from './cloudSync/CloudSyncTransport';

let personalDatabase: PersonalDatabase | null = null;
let reminderScheduler: ReminderScheduler | null = null;
let connectorService: LocalFolderConnectorService | null = null;
let connectorScheduler: LocalFolderSyncScheduler | null = null;
let emailConnectorService: EmailConnectorService | null = null;
let emailConnectorScheduler: EmailSyncScheduler | null = null;
let webDavConnectorService: WebDavConnectorService | null = null;
let webDavConnectorScheduler: WebDavSyncScheduler | null = null;
let s3ConnectorService: S3ConnectorService | null = null;
let s3ConnectorScheduler: ConnectorPeriodicSyncScheduler | null = null;
let calendarIcsConnectorService: CalendarIcsConnectorService | null = null;
let calendarIcsConnectorScheduler: ConnectorPeriodicSyncScheduler | null = null;
let cloudSyncService: CloudSyncService | null = null;
let connectorSecretCipher: ConnectorSecretCipher | null = null;

export function initializePersonalCore(
  dataDirectory = getDataPath(),
  options?: { connectorSecretCipher?: ConnectorSecretCipher }
): PersonalDatabase {
  if (options?.connectorSecretCipher) connectorSecretCipher = options.connectorSecretCipher;
  personalDatabase ??= PersonalDatabase.open(dataDirectory);
  return personalDatabase;
}

export function getPersonalDatabase(): PersonalDatabase {
  if (!personalDatabase) throw new Error('Personal Core is not initialized');
  return personalDatabase;
}

export function closePersonalCore(): void {
  personalDatabase?.close();
  personalDatabase = null;
  connectorService = null;
  emailConnectorService = null;
  webDavConnectorService = null;
  s3ConnectorService = null;
  calendarIcsConnectorService = null;
  connectorSecretCipher = null;
}

export function startPersonalReminderScheduler(notify: (title: string, body: string) => Promise<void>): void {
  if (reminderScheduler) return;
  const repository = new CalendarRepository(getPersonalDatabase().driver);
  reminderScheduler = new ReminderScheduler(repository, async (reminder: Reminder) => {
    if (reminder.ownerType === 'event') {
      const event = repository.findEvent(reminder.ownerId);
      if (!event || event.deletedAt !== null) return;
      await notify(event.title, event.location || event.description || event.startLocalDate);
      repository.insertAudit(
        crypto.randomUUID(),
        'calendar_reminder_delivered',
        { reminderId: reminder.id, eventId: event.id },
        Date.now()
      );
      return;
    }
    const block = repository.findBlock(reminder.ownerId);
    if (!block || block.deletedAt !== null) return;
    await notify('SearchT', block.taskId);
    repository.insertAudit(
      crypto.randomUUID(),
      'schedule_block_reminder_delivered',
      { reminderId: reminder.id, blockId: block.id },
      Date.now()
    );
  });
  reminderScheduler.start();
}

export function stopPersonalReminderScheduler(): void {
  reminderScheduler?.stop();
  reminderScheduler = null;
}

export function getLocalFolderConnectorService(): LocalFolderConnectorService {
  if (connectorService) return connectorService;
  const database = getPersonalDatabase();
  const inbox = new InboxService(
    database.driver,
    new InboxFileStore(nodePath.join(nodePath.dirname(database.path), 'inbox'))
  );
  connectorService = new LocalFolderConnectorService(database.driver, inbox);
  return connectorService;
}

export function startLocalFolderSyncScheduler(): void {
  if (connectorScheduler) return;
  connectorScheduler = new LocalFolderSyncScheduler(getLocalFolderConnectorService());
  connectorScheduler.start();
}

export async function stopLocalFolderSyncScheduler(): Promise<void> {
  const scheduler = connectorScheduler;
  connectorScheduler = null;
  await scheduler?.stop();
}

export function getEmailConnectorService(): EmailConnectorService {
  if (emailConnectorService) return emailConnectorService;
  if (!connectorSecretCipher) throw new Error('CONNECTOR_SECURE_STORAGE_UNAVAILABLE');
  const database = getPersonalDatabase();
  const personalRoot = nodePath.dirname(database.path);
  const inbox = new InboxService(database.driver, new InboxFileStore(nodePath.join(personalRoot, 'inbox')));
  const secrets = new ConnectorSecretStore(
    nodePath.join(personalRoot, 'connector-secrets.json'),
    connectorSecretCipher
  );
  emailConnectorService = new EmailConnectorService(
    database.driver,
    inbox,
    secrets,
    new ImapEmailClient(),
    nodePath.join(personalRoot, '.email-ingest-tmp')
  );
  return emailConnectorService;
}

export function startEmailSyncScheduler(): void {
  if (emailConnectorScheduler) return;
  emailConnectorScheduler = new EmailSyncScheduler(getEmailConnectorService());
  emailConnectorScheduler.start();
}

export async function stopEmailSyncScheduler(): Promise<void> {
  const scheduler = emailConnectorScheduler;
  emailConnectorScheduler = null;
  await scheduler?.stop();
}

export function getWebDavConnectorService(): WebDavConnectorService {
  if (webDavConnectorService) return webDavConnectorService;
  if (!connectorSecretCipher) throw new Error('CONNECTOR_SECURE_STORAGE_UNAVAILABLE');
  const database = getPersonalDatabase();
  const personalRoot = nodePath.dirname(database.path);
  const inbox = new InboxService(database.driver, new InboxFileStore(nodePath.join(personalRoot, 'inbox')));
  const secrets = new ConnectorSecretStore(
    nodePath.join(personalRoot, 'connector-secrets.json'),
    connectorSecretCipher
  );
  webDavConnectorService = new WebDavConnectorService(
    database.driver,
    inbox,
    secrets,
    new WebDavReadClient(),
    nodePath.join(personalRoot, '.webdav-ingest-tmp')
  );
  return webDavConnectorService;
}

export function startWebDavSyncScheduler(): void {
  if (webDavConnectorScheduler) return;
  webDavConnectorScheduler = new WebDavSyncScheduler(getWebDavConnectorService());
  webDavConnectorScheduler.start();
}

export async function stopWebDavSyncScheduler(): Promise<void> {
  const scheduler = webDavConnectorScheduler;
  webDavConnectorScheduler = null;
  await scheduler?.stop();
}

export function getS3ConnectorService(): S3ConnectorService {
  if (s3ConnectorService) return s3ConnectorService;
  if (!connectorSecretCipher) throw new Error('CONNECTOR_SECURE_STORAGE_UNAVAILABLE');
  const database = getPersonalDatabase();
  const personalRoot = nodePath.dirname(database.path);
  const inbox = new InboxService(database.driver, new InboxFileStore(nodePath.join(personalRoot, 'inbox')));
  const secrets = new ConnectorSecretStore(
    nodePath.join(personalRoot, 'connector-secrets.json'),
    connectorSecretCipher
  );
  s3ConnectorService = new S3ConnectorService(
    database.driver,
    inbox,
    secrets,
    new S3ReadClient(),
    nodePath.join(personalRoot, '.s3-ingest-tmp')
  );
  return s3ConnectorService;
}

export function startS3SyncScheduler(): void {
  if (s3ConnectorScheduler) return;
  s3ConnectorScheduler = new ConnectorPeriodicSyncScheduler(getS3ConnectorService(), 's3');
  s3ConnectorScheduler.start();
}

export async function stopS3SyncScheduler(): Promise<void> {
  const scheduler = s3ConnectorScheduler;
  s3ConnectorScheduler = null;
  await scheduler?.stop();
}

export function getCalendarIcsConnectorService(): CalendarIcsConnectorService {
  if (calendarIcsConnectorService) return calendarIcsConnectorService;
  if (!connectorSecretCipher) throw new Error('CONNECTOR_SECURE_STORAGE_UNAVAILABLE');
  const database = getPersonalDatabase();
  const personalRoot = nodePath.dirname(database.path);
  const secrets = new ConnectorSecretStore(
    nodePath.join(personalRoot, 'connector-secrets.json'),
    connectorSecretCipher
  );
  calendarIcsConnectorService = new CalendarIcsConnectorService(database.driver, secrets, new IcsCalendarClient());
  return calendarIcsConnectorService;
}

export function startCalendarIcsSyncScheduler(): void {
  if (calendarIcsConnectorScheduler) return;
  calendarIcsConnectorScheduler = new ConnectorPeriodicSyncScheduler(getCalendarIcsConnectorService(), 'calendar-ics');
  calendarIcsConnectorScheduler.start();
}

export async function stopCalendarIcsSyncScheduler(): Promise<void> {
  const scheduler = calendarIcsConnectorScheduler;
  calendarIcsConnectorScheduler = null;
  await scheduler?.stop();
}

export function getCloudSyncService(): CloudSyncService {
  if (cloudSyncService) return cloudSyncService;
  if (!connectorSecretCipher) throw new Error('CONNECTOR_SECURE_STORAGE_UNAVAILABLE');
  const database = getPersonalDatabase();
  const personalRoot = nodePath.dirname(database.path);
  const secrets = new ConnectorSecretStore(
    nodePath.join(personalRoot, 'connector-secrets.json'),
    connectorSecretCipher
  );
  cloudSyncService = new CloudSyncService(
    database.driver,
    (config) =>
      config.mode === 'webdav'
        ? createWebDavSyncTransport({
            serverUrl: config.serverUrl,
            username: config.username,
            password: config.password,
            rootPath: config.rootPath,
          })
        : createS3SyncTransport({
            endpoint: config.endpoint,
            region: config.region,
            bucket: config.bucket,
            prefix: config.prefix,
            pathStyle: config.pathStyle,
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          }),
    {
      set: (id, value) => void secrets.setCloudSync(id, value),
      get: (id) => secrets.getCloudSync(id),
      delete: (id) => void secrets.delete(id),
    }
  );
  return cloudSyncService;
}

export { PersonalDatabase } from './PersonalDatabase';
