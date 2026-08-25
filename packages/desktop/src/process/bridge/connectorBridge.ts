import { ipcBridge } from '@/common';
import type {
  CalendarIcsConnectorCreateInput,
  ConnectorAccount,
  CalendarIcsConnectorTestInput,
  ConnectorCreateInput,
  ConnectorSetStateInput,
  ConnectorSyncResult,
  EmailConnectorCreateInput,
  EmailConnectorTestInput,
  LocalFolderConnectorCreateInput,
  S3ConnectorCreateInput,
  S3ConnectorTestInput,
  WebDavConnectorCreateInput,
  WebDavConnectorTestInput,
} from '@/common/types/searcht/connectors';
import {
  getCalendarIcsConnectorService,
  getEmailConnectorService,
  getLocalFolderConnectorService,
  getS3ConnectorService,
  getWebDavConnectorService,
} from '@process/services/personal-core';
import { assertEmailAddressMatchesProvider } from '@process/services/personal-core/connectors/email/providerPresets';
import { resolveWebDavConnection } from '@process/services/personal-core/connectors/webdav/providerPresets';
import { resolveS3Connection } from '@process/services/personal-core/connectors/s3/providerPresets';
import { resolveCalendarIcsConnection } from '@process/services/personal-core/connectors/calendar-ics/providerPresets';
import type { WebDavConnectorService } from '@process/services/personal-core/connectors/webdav/WebDavConnectorService';
import type { EmailConnectorService } from '@process/services/personal-core/connectors/email/EmailConnectorService';
import type { LocalFolderConnectorService } from '@process/services/personal-core/connectors/LocalFolderConnectorService';
import type { S3ConnectorService } from '@process/services/personal-core/connectors/s3/S3ConnectorService';
import type { CalendarIcsConnectorService } from '@process/services/personal-core/connectors/calendar-ics/CalendarIcsConnectorService';

type FolderConnectorServiceContract = Pick<
  LocalFolderConnectorService,
  'list' | 'create' | 'sync' | 'setState' | 'disconnect'
>;
type EmailConnectorServiceContract = Pick<
  EmailConnectorService,
  'list' | 'test' | 'create' | 'sync' | 'setState' | 'disconnect'
>;
type WebDavConnectorServiceContract = Pick<
  WebDavConnectorService,
  'list' | 'test' | 'create' | 'sync' | 'setState' | 'disconnect'
>;
type S3ConnectorServiceContract = Pick<
  S3ConnectorService,
  'list' | 'test' | 'create' | 'sync' | 'setState' | 'disconnect'
>;
type CalendarIcsConnectorServiceContract = Pick<
  CalendarIcsConnectorService,
  'list' | 'test' | 'create' | 'sync' | 'setState' | 'disconnect'
>;

export type ConnectorBridgeDependencies = {
  folderService: FolderConnectorServiceContract;
  emailService: EmailConnectorServiceContract;
  webDavService: WebDavConnectorServiceContract;
  s3Service?: S3ConnectorServiceContract;
  calendarIcsService?: CalendarIcsConnectorServiceContract;
};

export function initConnectorBridge(dependencies?: ConnectorBridgeDependencies) {
  const getFolderService = () => dependencies?.folderService ?? getLocalFolderConnectorService();
  const getEmailService = () => dependencies?.emailService ?? getEmailConnectorService();
  const getWebDavService = () => dependencies?.webDavService ?? getWebDavConnectorService();
  const getS3Service = () => dependencies?.s3Service ?? getS3ConnectorService();
  const getCalendarIcsService = () => dependencies?.calendarIcsService ?? getCalendarIcsConnectorService();
  // Secret-backed services require the OS keychain cipher which unit tests do
  // not provide; degrade to "no accounts" instead of breaking unrelated flows.
  const optionalList = (load: () => { list(): ConnectorAccount[] }): ConnectorAccount[] => {
    try {
      return load().list();
    } catch (error) {
      if (error instanceof Error && error.message === 'CONNECTOR_SECURE_STORAGE_UNAVAILABLE') return [];
      throw error;
    }
  };
  type AnyConnectorService =
    | FolderConnectorServiceContract
    | EmailConnectorServiceContract
    | WebDavConnectorServiceContract
    | S3ConnectorServiceContract
    | CalendarIcsConnectorServiceContract;
  const findService = (id: string): AnyConnectorService => {
    if (
      getFolderService()
        .list()
        .some((account) => account.id === id)
    )
      return getFolderService();
    if (
      getEmailService()
        .list()
        .some((account) => account.id === id)
    )
      return getEmailService();
    if (
      getWebDavService()
        .list()
        .some((account) => account.id === id)
    )
      return getWebDavService();
    if (optionalList(getS3Service).some((account) => account.id === id)) return getS3Service();
    if (optionalList(getCalendarIcsService).some((account) => account.id === id)) return getCalendarIcsService();
    throw new Error('CONNECTOR_NOT_FOUND');
  };
  const handlers = {
    list: async () => [
      ...getFolderService().list(),
      ...getEmailService().list(),
      ...getWebDavService().list(),
      ...optionalList(getS3Service),
      ...optionalList(getCalendarIcsService),
    ],
    create: async (input: ConnectorCreateInput) => {
      validateCreateInput(input);
      const connector = getFolderService().create(input);
      return getFolderService().sync(connector.id);
    },
    testEmail: async (input: EmailConnectorTestInput) => {
      validateEmailInput(input);
      return getEmailService().test(input);
    },
    createEmail: async (input: EmailConnectorCreateInput): Promise<ConnectorSyncResult> => {
      validateEmailCreateInput(input);
      return getEmailService().create(input);
    },
    testWebDav: async (input: WebDavConnectorTestInput) => {
      validateWebDavInput(input);
      return getWebDavService().test(input);
    },
    createWebDav: async (input: WebDavConnectorCreateInput): Promise<ConnectorSyncResult> => {
      validateWebDavCreateInput(input);
      return getWebDavService().create(input);
    },
    testS3: async (input: S3ConnectorTestInput) => {
      validateS3Input(input);
      return getS3Service().test(input);
    },
    createS3: async (input: S3ConnectorCreateInput): Promise<ConnectorSyncResult> => {
      validateS3CreateInput(input);
      return getS3Service().create(input);
    },
    testCalendarIcs: async (input: CalendarIcsConnectorTestInput) => {
      validateCalendarIcsInput(input);
      return getCalendarIcsService().test(input);
    },
    createCalendarIcs: async (input: CalendarIcsConnectorCreateInput): Promise<ConnectorSyncResult> => {
      validateCalendarIcsCreateInput(input);
      return getCalendarIcsService().create(input);
    },
    sync: async (id: string) => {
      validateId(id);
      return findService(id).sync(id);
    },
    setState: async (input: ConnectorSetStateInput) => {
      validateId(input?.id);
      if (input?.state !== 'active' && input?.state !== 'paused') throw new Error('CONNECTOR_INPUT_INVALID');
      return findService(input.id).setState(input);
    },
    disconnect: async (id: string) => {
      validateId(id);
      findService(id).disconnect(id);
    },
  };

  ipcBridge.connectors.list.provider(handlers.list);
  ipcBridge.connectors.create.provider(handlers.create);
  ipcBridge.connectors.testEmail.provider(handlers.testEmail);
  ipcBridge.connectors.createEmail.provider(handlers.createEmail);
  ipcBridge.connectors.testWebDav.provider(handlers.testWebDav);
  ipcBridge.connectors.createWebDav.provider(handlers.createWebDav);
  ipcBridge.connectors.testS3.provider(handlers.testS3);
  ipcBridge.connectors.createS3.provider(handlers.createS3);
  ipcBridge.connectors.testCalendarIcs.provider(handlers.testCalendarIcs);
  ipcBridge.connectors.createCalendarIcs.provider(handlers.createCalendarIcs);
  ipcBridge.connectors.sync.provider(({ id }) => handlers.sync(id));
  ipcBridge.connectors.setState.provider(handlers.setState);
  ipcBridge.connectors.disconnect.provider(({ id }) => handlers.disconnect(id));
  return handlers;
}

function validateWebDavInput(input: WebDavConnectorTestInput): void {
  try {
    resolveWebDavConnection(input);
  } catch {
    throw new Error('CONNECTOR_INPUT_INVALID');
  }
}

function validateWebDavCreateInput(input: WebDavConnectorCreateInput): void {
  if (
    !input ||
    input.kind !== 'webdav' ||
    (input.initialSync !== 'from-now' && input.initialSync !== 'import-existing') ||
    (input.displayName !== undefined &&
      (typeof input.displayName !== 'string' || input.displayName.trim().length > 200))
  ) {
    throw new Error('CONNECTOR_INPUT_INVALID');
  }
  validateWebDavInput(input);
}

function validateEmailInput(input: EmailConnectorTestInput): void {
  try {
    if (
      !input ||
      (input.provider !== 'qq-mail' && input.provider !== 'netease-163') ||
      typeof input.emailAddress !== 'string' ||
      typeof input.authorizationCode !== 'string' ||
      !input.authorizationCode.trim() ||
      input.authorizationCode.length > 4096
    ) {
      throw new Error();
    }
    assertEmailAddressMatchesProvider(input.provider, input.emailAddress);
  } catch {
    throw new Error('CONNECTOR_INPUT_INVALID');
  }
}

function validateEmailCreateInput(input: EmailConnectorCreateInput): void {
  if (
    !input ||
    input.kind !== 'email-imap' ||
    (input.initialSync !== 'from-now' && input.initialSync !== 'last-7-days')
  ) {
    throw new Error('CONNECTOR_INPUT_INVALID');
  }
  validateEmailInput(input);
}

function validateCreateInput(input: ConnectorCreateInput): asserts input is LocalFolderConnectorCreateInput {
  if (
    !input ||
    input.kind !== 'local-folder' ||
    typeof input.path !== 'string' ||
    input.path.trim().length === 0 ||
    input.path.length > 32_768 ||
    typeof input.includeSubfolders !== 'boolean' ||
    (input.displayName !== undefined && typeof input.displayName !== 'string')
  ) {
    throw new Error('CONNECTOR_INPUT_INVALID');
  }
}

function validateId(id: string): void {
  if (typeof id !== 'string' || id.trim().length === 0 || id.length > 200) {
    throw new Error('CONNECTOR_INPUT_INVALID');
  }
}

function validateS3Input(input: S3ConnectorTestInput): void {
  try {
    resolveS3Connection(input);
  } catch {
    throw new Error('CONNECTOR_INPUT_INVALID');
  }
}

function validateS3CreateInput(input: S3ConnectorCreateInput): void {
  if (
    !input ||
    input.kind !== 's3' ||
    (input.initialSync !== 'from-now' && input.initialSync !== 'import-existing') ||
    (input.displayName !== undefined &&
      (typeof input.displayName !== 'string' || input.displayName.trim().length > 200))
  ) {
    throw new Error('CONNECTOR_INPUT_INVALID');
  }
  validateS3Input(input);
}

function validateCalendarIcsInput(input: CalendarIcsConnectorTestInput): void {
  try {
    resolveCalendarIcsConnection(input);
  } catch {
    throw new Error('CONNECTOR_INPUT_INVALID');
  }
}

function validateCalendarIcsCreateInput(input: CalendarIcsConnectorCreateInput): void {
  if (
    !input ||
    input.kind !== 'calendar-ics' ||
    input.initialSync !== 'import-existing' ||
    (input.displayName !== undefined &&
      (typeof input.displayName !== 'string' || input.displayName.trim().length > 200))
  ) {
    throw new Error('CONNECTOR_INPUT_INVALID');
  }
  validateCalendarIcsInput(input);
}
