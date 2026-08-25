import { ipcBridge } from '@/common';
import type {
  CalendarIcsConnectorCreateInput,
  CalendarIcsConnectorTestInput,
  ConnectorAccount,
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

export type ConnectorSettingsClient = {
  list(): Promise<ConnectorAccount[]>;
  create(input: LocalFolderConnectorCreateInput): Promise<ConnectorSyncResult>;
  testEmail(input: EmailConnectorTestInput): Promise<void>;
  createEmail(input: EmailConnectorCreateInput): Promise<ConnectorSyncResult>;
  testWebDav(input: WebDavConnectorTestInput): Promise<void>;
  createWebDav(input: WebDavConnectorCreateInput): Promise<ConnectorSyncResult>;
  testS3(input: S3ConnectorTestInput): Promise<void>;
  createS3(input: S3ConnectorCreateInput): Promise<ConnectorSyncResult>;
  testCalendarIcs(input: CalendarIcsConnectorTestInput): Promise<void>;
  createCalendarIcs(input: CalendarIcsConnectorCreateInput): Promise<ConnectorSyncResult>;
  sync(id: string): Promise<ConnectorSyncResult>;
  setState(input: ConnectorSetStateInput): Promise<ConnectorAccount>;
  disconnect(id: string): Promise<void>;
};

export const connectorSettingsClient: ConnectorSettingsClient = {
  list: () => ipcBridge.connectors.list.invoke(),
  create: (input) => ipcBridge.connectors.create.invoke(input),
  testEmail: (input) => ipcBridge.connectors.testEmail.invoke(input),
  createEmail: (input) => ipcBridge.connectors.createEmail.invoke(input),
  testWebDav: (input) => ipcBridge.connectors.testWebDav.invoke(input),
  createWebDav: (input) => ipcBridge.connectors.createWebDav.invoke(input),
  testS3: (input) => ipcBridge.connectors.testS3.invoke(input),
  createS3: (input) => ipcBridge.connectors.createS3.invoke(input),
  testCalendarIcs: (input) => ipcBridge.connectors.testCalendarIcs.invoke(input),
  createCalendarIcs: (input) => ipcBridge.connectors.createCalendarIcs.invoke(input),
  sync: (id) => ipcBridge.connectors.sync.invoke({ id }),
  setState: (input) => ipcBridge.connectors.setState.invoke(input),
  disconnect: (id) => ipcBridge.connectors.disconnect.invoke({ id }),
};
