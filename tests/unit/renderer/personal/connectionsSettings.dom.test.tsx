// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorAccount } from '@/common/types/searcht/connectors';

vi.mock('@renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const copy: Record<string, string> = {
  'personal.connectors.title': '连接',
  'personal.connectors.description': '让SearchT自动接收指定文件夹中新建或更新的文件。',
  'personal.connectors.desktopOnly': '本地文件夹连接仅在SearchT桌面版中可用。',
  'personal.connectors.addFolder': '添加文件夹',
  'personal.connectors.addEmail': 'Connect email',
  'personal.connectors.addWebDav': 'Connect cloud drive',
  'personal.connectors.desktopOnlyAll': 'Connections are managed in the SearchT desktop app.',
  'personal.connectors.emptyAllTitle': 'No connections yet',
  'personal.connectors.emptyAllDescription': 'Connect email or a local folder.',
  'personal.connectors.email.sectionTitle': 'Email',
  'personal.connectors.email.sectionDescription': 'Import new email and attachments into Inbox.',
  'personal.connectors.folder.sectionTitle': 'Local folders',
  'personal.connectors.folder.sectionDescription': 'Watch folders on this computer.',
  'personal.connectors.webdav.sectionTitle': 'Cloud drives',
  'personal.connectors.webdav.sectionDescription': 'Read files from Jianguoyun or WebDAV.',
  'personal.connectors.webdav.dialogTitle': 'Connect cloud drive',
  'personal.connectors.webdav.providerLabel': 'Cloud service',
  'personal.connectors.webdav.provider.jianguoyun': 'Jianguoyun',
  'personal.connectors.webdav.provider.custom': 'Custom WebDAV',
  'personal.connectors.webdav.serverUrlLabel': 'HTTPS server address',
  'personal.connectors.webdav.usernameLabel': 'Account or username',
  'personal.connectors.webdav.passwordLabel': 'App password',
  'personal.connectors.webdav.passwordHint': 'Use an app password instead of your sign-in password.',
  'personal.connectors.webdav.rootPathLabel': 'Folder path',
  'personal.connectors.webdav.rootPathHint': 'Leave as / to receive files from the whole drive.',
  'personal.connectors.webdav.displayNameLabel': 'Connection name',
  'personal.connectors.webdav.initialSyncLabel': 'First sync',
  'personal.connectors.webdav.initialSync.fromNow': 'Only new and changed files',
  'personal.connectors.webdav.initialSync.importExisting': 'Import existing files',
  'personal.connectors.webdav.test': 'Test connection',
  'personal.connectors.webdav.connect': 'Connect',
  'personal.connectors.webdav.testSuccess': 'Connection succeeded',
  'personal.connectors.webdav.connectionFailed': 'Could not connect. Check the address and credentials.',
  'personal.connectors.webdav.credentialMissing': 'Credentials are missing. Reconnect this drive.',
  'personal.connectors.webdav.disconnectTitle': 'Disconnect this cloud drive?',
  'personal.connectors.webdav.disconnectDescription': 'Imported files stay in Inbox. Remote files are not changed.',
  'personal.connectors.email.dialogTitle': 'Connect email',
  'personal.connectors.email.providerLabel': 'Mail provider',
  'personal.connectors.email.provider.qqMail': 'QQ Mail',
  'personal.connectors.email.provider.netease163': '163 Mail',
  'personal.connectors.email.addressLabel': 'Email address',
  'personal.connectors.email.authorizationCodeLabel': 'Authorization code',
  'personal.connectors.email.authorizationCodeHint': 'Use the authorization code created in your mail settings.',
  'personal.connectors.email.initialSyncLabel': 'First sync',
  'personal.connectors.email.initialSync.fromNow': 'Only new email',
  'personal.connectors.email.initialSync.last7Days': 'Last 7 days',
  'personal.connectors.email.test': 'Test connection',
  'personal.connectors.email.connect': 'Connect',
  'personal.connectors.email.testSuccess': 'Connection succeeded',
  'personal.connectors.email.connectionFailed': 'Could not connect. Check the address and authorization code.',
  'personal.connectors.email.mailboxReset': 'The mailbox changed. Reconnect this account.',
  'personal.connectors.email.credentialMissing': 'Authorization is missing. Reconnect this account.',
  'personal.connectors.includeSubfolders': '包含子文件夹',
  'personal.connectors.includeSubfoldersHint': '添加时也接收子文件夹中的文件',
  'personal.connectors.emptyTitle': '还没有连接文件夹',
  'personal.connectors.emptyDescription': '添加后，新文件和有变化的文件会自动进入收件箱。',
  'personal.connectors.status.active': '正常',
  'personal.connectors.status.paused': '已暂停',
  'personal.connectors.status.error': '需处理',
  'personal.connectors.lastSync': '最近同步',
  'personal.connectors.neverSynced': '尚未同步',
  'personal.connectors.syncResult': '已扫描 {{scanned}}，导入 {{imported}}，跳过 {{skipped}}',
  'personal.connectors.actions.sync': '立即同步',
  'personal.connectors.actions.pause': '暂停',
  'personal.connectors.actions.resume': '恢复',
  'personal.connectors.actions.disconnect': '断开连接',
  'personal.connectors.disconnectTitle': '断开这个文件夹？',
  'personal.connectors.disconnectDescription': '已进入收件箱的文件会保留。',
  'personal.connectors.disconnectConfirm': '断开',
  'personal.connectors.loadFailed': '无法读取连接',
  'personal.connectors.actionFailed': '操作没有完成',
  'personal.connectors.folderUnavailable': '找不到这个文件夹，请确认它仍然可用。',
  'common.cancel': '取消',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      let value = copy[key] ?? key;
      for (const [name, replacement] of Object.entries(values ?? {})) {
        value = value.replace(`{{${name}}}`, String(replacement));
      }
      return value;
    },
  }),
}));

import ConnectionsSettings, { type ConnectorSettingsClient } from '@renderer/pages/settings/ConnectionsSettings';

const activeAccount: ConnectorAccount = {
  id: 'connector-1',
  kind: 'local-folder',
  displayName: '资料入口',
  state: 'active',
  config: { path: 'C:\\Users\\me\\Inbox', includeSubfolders: true },
  lastSyncAt: 100,
  lastSuccessAt: 100,
  lastErrorCode: null,
  createdAt: 10,
  updatedAt: 100,
};

const emailAccount: ConnectorAccount = {
  id: 'email-1',
  kind: 'email-imap',
  displayName: 'person@qq.com',
  state: 'active',
  config: {
    provider: 'qq-mail',
    emailAddress: 'person@qq.com',
    mailbox: 'INBOX',
    initialSync: 'from-now',
  },
  lastSyncAt: null,
  lastSuccessAt: null,
  lastErrorCode: null,
  createdAt: 10,
  updatedAt: 10,
};

const webDavAccount: ConnectorAccount = {
  id: 'webdav-1',
  kind: 'webdav',
  displayName: 'Work drive',
  state: 'active',
  config: { provider: 'jianguoyun', rootPath: '/documents', initialSync: 'from-now' },
  lastSyncAt: null,
  lastSuccessAt: null,
  lastErrorCode: null,
  createdAt: 10,
  updatedAt: 10,
};

function makeClient(
  accounts: ConnectorAccount[] = []
): ConnectorSettingsClient & Record<string, ReturnType<typeof vi.fn>> {
  return {
    list: vi.fn(async () => accounts),
    create: vi.fn(async () => ({
      connector: activeAccount,
      scanned: 2,
      imported: 1,
      reused: 0,
      skipped: 1,
      failed: 0,
    })),
    testEmail: vi.fn(async () => undefined),
    createEmail: vi.fn(async () => ({
      connector: emailAccount,
      scanned: 0,
      imported: 0,
      reused: 0,
      skipped: 0,
      failed: 0,
    })),
    testWebDav: vi.fn(async () => undefined),
    createWebDav: vi.fn(async () => ({
      connector: webDavAccount,
      scanned: 0,
      imported: 0,
      reused: 0,
      skipped: 0,
      failed: 0,
    })),
    sync: vi.fn(async () => ({
      connector: activeAccount,
      scanned: 3,
      imported: 1,
      reused: 0,
      skipped: 2,
      failed: 0,
    })),
    setState: vi.fn(async ({ state }) => ({ ...activeAccount, state })),
    disconnect: vi.fn(async () => undefined),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ConnectionsSettings', () => {
  it('explains that local folder connections require the desktop app in WebUI', () => {
    render(<ConnectionsSettings desktop={false} client={makeClient()} />);

    expect(screen.getByText('Connections are managed in the SearchT desktop app.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加文件夹' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Authorization code')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect cloud drive' })).not.toBeInTheDocument();
  });

  it('creates a Jianguoyun connection without asking for a server address', async () => {
    const client = makeClient();
    render(<ConnectionsSettings desktop client={client} />);

    await screen.findByText('No connections yet');
    await userEvent.click(screen.getByRole('button', { name: 'Connect cloud drive' }));
    expect(screen.queryByLabelText('HTTPS server address')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Account or username'), 'person@example.com');
    await userEvent.type(screen.getByLabelText('App password'), 'app-password');
    await userEvent.clear(screen.getByLabelText('Folder path'));
    await userEvent.type(screen.getByLabelText('Folder path'), '/documents');
    await userEvent.click(screen.getByRole('button', { name: 'Connect', exact: true }));

    await waitFor(() =>
      expect(client.createWebDav).toHaveBeenCalledWith({
        kind: 'webdav',
        provider: 'jianguoyun',
        username: 'person@example.com',
        password: 'app-password',
        rootPath: '/documents',
        initialSync: 'from-now',
      })
    );
    expect(await screen.findByText('Work drive')).toBeInTheDocument();
  });

  it('shows the server field for custom WebDAV and clears a rejected password', async () => {
    const client = makeClient();
    client.testWebDav.mockRejectedValueOnce(new Error('CONNECTOR_WEBDAV_CONNECTION_FAILED'));
    render(<ConnectionsSettings desktop client={client} />);

    await screen.findByText('No connections yet');
    await userEvent.click(screen.getByRole('button', { name: 'Connect cloud drive' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Custom WebDAV' }));
    await userEvent.type(screen.getByLabelText('HTTPS server address'), 'https://dav.example.com/');
    await userEvent.type(screen.getByLabelText('Account or username'), 'person');
    const password = screen.getByLabelText('App password');
    await userEvent.type(password, 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    await waitFor(() => expect(password).toHaveValue(''));
    expect(client.testWebDav).toHaveBeenCalledWith({
      provider: 'custom-webdav',
      serverUrl: 'https://dav.example.com/',
      username: 'person',
      password: 'wrong-password',
      rootPath: '/',
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not connect');
    expect(screen.getByRole('dialog')).toHaveClass('searcht-webdav-dialog');
  });

  it('creates a QQ Mail connection from the desktop dialog', async () => {
    const client = makeClient();
    render(<ConnectionsSettings desktop client={client} />);

    await screen.findByText('No connections yet');
    await userEvent.click(screen.getByRole('button', { name: 'Connect email' }));
    await userEvent.type(screen.getByLabelText('Email address'), 'person@qq.com');
    await userEvent.type(screen.getByLabelText('Authorization code'), 'mail-code');
    await userEvent.click(screen.getByRole('button', { name: 'Connect', exact: true }));

    await waitFor(() =>
      expect(client.createEmail).toHaveBeenCalledWith({
        kind: 'email-imap',
        provider: 'qq-mail',
        emailAddress: 'person@qq.com',
        authorizationCode: 'mail-code',
        initialSync: 'from-now',
      })
    );
    expect(await screen.findAllByText('person@qq.com')).toHaveLength(2);
  });

  it('clears the authorization code after a failed connection attempt', async () => {
    const client = makeClient();
    client.createEmail.mockRejectedValueOnce(new Error('CONNECTOR_EMAIL_CONNECTION_FAILED'));
    render(<ConnectionsSettings desktop client={client} />);

    await screen.findByText('No connections yet');
    await userEvent.click(screen.getByRole('button', { name: 'Connect email' }));
    await userEvent.type(screen.getByLabelText('Email address'), 'person@qq.com');
    const code = screen.getByLabelText('Authorization code');
    await userEvent.type(code, 'wrong-code');
    await userEvent.click(screen.getByRole('button', { name: 'Connect', exact: true }));

    await waitFor(() => expect(code).toHaveValue(''));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not connect');
  });

  it('groups email and local-folder accounts under recognizable sections', async () => {
    render(<ConnectionsSettings desktop client={makeClient([emailAccount, activeAccount])} />);

    expect(await screen.findByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Local folders')).toBeInTheDocument();
    expect(screen.getAllByText('person@qq.com')).toHaveLength(2);
    expect(screen.getByText('C:\\Users\\me\\Inbox')).toBeInTheDocument();
  });

  it('groups cloud-drive accounts and uses retention copy when disconnecting', async () => {
    render(<ConnectionsSettings desktop client={makeClient([webDavAccount])} />);

    expect(await screen.findByText('Cloud drives')).toBeInTheDocument();
    expect(screen.getByText('/documents')).toBeInTheDocument();
    const row = screen.getByTestId('connector-row-webdav-1');
    await userEvent.click(within(row).getAllByRole('button').at(-1)!);
    const dialog = await screen.findByRole('dialog', { name: 'Disconnect this cloud drive?' });
    expect(within(dialog).getByText('Imported files stay in Inbox. Remote files are not changed.')).toBeInTheDocument();
  });

  it('shows an empty state and adds the selected folder with the chosen scan option', async () => {
    const client = makeClient();
    const pickFolder = vi.fn(async () => 'C:\\Users\\me\\Inbox');
    render(<ConnectionsSettings desktop client={client} pickFolder={pickFolder} />);

    expect(await screen.findByText('No connections yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: '包含子文件夹' }));
    await userEvent.click(screen.getByRole('button', { name: '添加文件夹' }));

    await waitFor(() =>
      expect(client.create).toHaveBeenCalledWith({
        kind: 'local-folder',
        path: 'C:\\Users\\me\\Inbox',
        includeSubfolders: false,
      })
    );
    expect(await screen.findByText('资料入口')).toBeInTheDocument();
    expect(screen.getByText('已扫描 2，导入 1，跳过 1')).toBeInTheDocument();
  });

  it('syncs and pauses an active connection, then allows it to resume', async () => {
    const client = makeClient([activeAccount]);
    render(<ConnectionsSettings desktop client={client} />);

    const row = await screen.findByTestId('connector-row-connector-1');
    await userEvent.click(within(row).getByRole('button', { name: '立即同步' }));
    await waitFor(() => expect(client.sync).toHaveBeenCalledWith('connector-1'));
    await userEvent.click(within(row).getByRole('button', { name: '暂停' }));
    await waitFor(() => expect(client.setState).toHaveBeenCalledWith({ id: 'connector-1', state: 'paused' }));

    await userEvent.click(within(row).getByRole('button', { name: '恢复' }));
    expect(client.setState).toHaveBeenLastCalledWith({ id: 'connector-1', state: 'active' });
  });

  it('confirms disconnect and removes the connection without offering Inbox deletion', async () => {
    const client = makeClient([activeAccount]);
    render(<ConnectionsSettings desktop client={client} />);

    await userEvent.click(await screen.findByRole('button', { name: '断开连接' }));
    const dialog = await screen.findByRole('dialog', { name: '断开这个文件夹？' });
    expect(within(dialog).getByText('已进入收件箱的文件会保留。')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '断开' }));

    await waitFor(() => expect(client.disconnect).toHaveBeenCalledWith('connector-1'));
    expect(screen.queryByText('资料入口')).not.toBeInTheDocument();
  });
});
