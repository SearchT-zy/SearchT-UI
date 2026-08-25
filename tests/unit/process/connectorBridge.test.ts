import { describe, expect, it, vi } from 'vitest';
import { initConnectorBridge } from '@process/bridge/connectorBridge';

describe('connector bridge', () => {
  it('creates a connection and immediately returns its first sync result', async () => {
    const account = { id: 'connector-1', state: 'active' };
    const syncResult = { connector: account, scanned: 1, imported: 1, reused: 0, skipped: 0, failed: 0 };
    const service = {
      list: vi.fn().mockReturnValue([account]),
      create: vi.fn().mockReturnValue(account),
      sync: vi.fn().mockResolvedValue(syncResult),
      setState: vi.fn().mockReturnValue({ ...account, state: 'paused' }),
      disconnect: vi.fn(),
    };
    const handlers = initConnectorBridge({
      folderService: service as never,
      emailService: emptyEmailService(),
      webDavService: emptyWebDavService(),
    });
    const input = { kind: 'local-folder' as const, path: 'C:\\Inbox', includeSubfolders: true };

    await expect(handlers.create(input)).resolves.toBe(syncResult);
    await expect(handlers.list()).resolves.toEqual([account]);
    expect(service.create).toHaveBeenCalledWith(input);
    expect(service.sync).toHaveBeenCalledWith('connector-1');
  });

  it('rejects invalid renderer input before invoking the filesystem service', async () => {
    const service = { create: vi.fn(), sync: vi.fn(), list: vi.fn(), setState: vi.fn(), disconnect: vi.fn() };
    const handlers = initConnectorBridge({
      folderService: service as never,
      emailService: emptyEmailService(),
      webDavService: emptyWebDavService(),
    });

    await expect(handlers.create({ kind: 'local-folder', path: '', includeSubfolders: false })).rejects.toThrow(
      'CONNECTOR_INPUT_INVALID'
    );
    await expect(handlers.sync('')).rejects.toThrow('CONNECTOR_INPUT_INVALID');
    await expect(handlers.setState({ id: 'connector-1', state: 'error' } as never)).rejects.toThrow(
      'CONNECTOR_INPUT_INVALID'
    );
    expect(service.create).not.toHaveBeenCalled();
  });

  it('validates and routes email testing and creation without returning authorization codes', async () => {
    const connector = {
      id: 'email-1',
      kind: 'email-imap',
      state: 'active',
      config: { provider: 'qq-mail', emailAddress: 'person@qq.com', mailbox: 'INBOX', initialSync: 'from-now' },
    };
    const result = { connector, scanned: 0, imported: 0, reused: 0, skipped: 0, failed: 0 };
    const emailService = {
      ...emptyEmailService(),
      test: vi.fn(async () => undefined),
      create: vi.fn(async () => result),
      list: vi.fn(() => [connector]),
    };
    const handlers = initConnectorBridge({
      folderService: emptyFolderService(),
      emailService: emailService as never,
      webDavService: emptyWebDavService(),
    });
    const credentials = {
      provider: 'qq-mail' as const,
      emailAddress: 'person@qq.com',
      authorizationCode: 'private-code',
    };

    await expect(handlers.testEmail(credentials)).resolves.toBeUndefined();
    await expect(handlers.createEmail({ kind: 'email-imap', ...credentials, initialSync: 'from-now' })).resolves.toBe(
      result
    );
    await expect(handlers.list()).resolves.toEqual([connector]);
    expect(JSON.stringify(await handlers.list())).not.toContain('private-code');

    await expect(handlers.testEmail({ ...credentials, emailAddress: 'person@163.com' })).rejects.toThrow(
      'CONNECTOR_INPUT_INVALID'
    );
    expect(emailService.test).toHaveBeenCalledTimes(1);
  });

  it('routes generic actions by connector kind', async () => {
    const folder = { id: 'folder-1', kind: 'local-folder', state: 'active' };
    const email = { id: 'email-1', kind: 'email-imap', state: 'active' };
    const folderService = { ...emptyFolderService(), list: vi.fn(() => [folder]) };
    const emailService = { ...emptyEmailService(), list: vi.fn(() => [email]) };
    const handlers = initConnectorBridge({
      folderService: folderService as never,
      emailService: emailService as never,
      webDavService: emptyWebDavService(),
    });

    await handlers.sync('email-1');
    await handlers.setState({ id: 'folder-1', state: 'paused' });
    await handlers.disconnect('email-1');

    expect(emailService.sync).toHaveBeenCalledWith('email-1');
    expect(folderService.setState).toHaveBeenCalledWith({ id: 'folder-1', state: 'paused' });
    expect(emailService.disconnect).toHaveBeenCalledWith('email-1');
  });

  it('validates, redacts, and routes S3 and calendar subscription connections', async () => {
    const s3Connector = {
      id: 's3-1',
      kind: 's3',
      state: 'active',
      config: { provider: 'custom-s3', bucket: 'bucket', prefix: '', pathStyle: true, initialSync: 'from-now' },
    };
    const icsConnector = {
      id: 'ics-1',
      kind: 'calendar-ics',
      state: 'active',
      config: { provider: 'feishu', initialSync: 'import-existing' },
    };
    const s3Result = { connector: s3Connector, scanned: 0, imported: 0, reused: 0, skipped: 0, failed: 0 };
    const icsResult = { connector: icsConnector, scanned: 1, imported: 1, reused: 0, skipped: 0, failed: 0 };
    const s3Service = {
      ...emptyFolderService(),
      test: vi.fn(async () => undefined),
      create: vi.fn(async () => s3Result),
      list: vi.fn(() => [s3Connector]),
    };
    const icsService = {
      ...emptyFolderService(),
      test: vi.fn(async () => undefined),
      create: vi.fn(async () => icsResult),
      list: vi.fn(() => [icsConnector]),
    };
    const handlers = initConnectorBridge({
      folderService: emptyFolderService(),
      emailService: emptyEmailService(),
      webDavService: emptyWebDavService(),
      s3Service: s3Service as never,
      calendarIcsService: icsService as never,
    });
    const s3Credentials = {
      provider: 'custom-s3' as const,
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      bucket: 'bucket',
      accessKeyId: 'unit-test-access-key-id',
      secretAccessKey: process.env.SEARCHT_UNIT_TEST_S3_SECRET_ACCESS_KEY ?? 'unit-test-secret-access-key',
    };
    const icsCredentials = { provider: 'feishu' as const, url: 'https://calendar.example.com/feed.ics' };

    await expect(handlers.testS3(s3Credentials)).resolves.toBeUndefined();
    await expect(handlers.createS3({ kind: 's3', ...s3Credentials, initialSync: 'from-now' })).resolves.toBe(s3Result);
    await expect(handlers.testCalendarIcs(icsCredentials)).resolves.toBeUndefined();
    await expect(
      handlers.createCalendarIcs({ kind: 'calendar-ics', ...icsCredentials, initialSync: 'import-existing' })
    ).resolves.toBe(icsResult);
    await handlers.sync('s3-1');
    await handlers.setState({ id: 'ics-1', state: 'paused' });
    expect(s3Service.sync).toHaveBeenCalledWith('s3-1');
    expect(icsService.setState).toHaveBeenCalledWith({ id: 'ics-1', state: 'paused' });
    expect(JSON.stringify(await handlers.list())).not.toMatch(/unit-test-secret-access-key|feed\.ics/);

    await Promise.all([
      expect(handlers.testS3({ ...s3Credentials, endpoint: 'http://s3.example.com' })).rejects.toThrow(
        'CONNECTOR_INPUT_INVALID'
      ),
      expect(handlers.testS3({ ...s3Credentials, bucket: 'a' })).rejects.toThrow('CONNECTOR_INPUT_INVALID'),
      expect(handlers.testCalendarIcs({ ...icsCredentials, url: 'not a url' })).rejects.toThrow(
        'CONNECTOR_INPUT_INVALID'
      ),
      expect(handlers.testCalendarIcs({ provider: 'google', url: icsCredentials.url } as never)).rejects.toThrow(
        'CONNECTOR_INPUT_INVALID'
      ),
    ]);
    expect(s3Service.test).toHaveBeenCalledTimes(1);
    expect(icsService.test).toHaveBeenCalledTimes(1);
  });

  it('validates, redacts, and routes WebDAV connections and generic actions', async () => {
    const connector = {
      id: 'webdav-1',
      kind: 'webdav',
      state: 'active',
      config: { provider: 'custom-webdav', rootPath: '/documents', initialSync: 'from-now' },
    };
    const result = { connector, scanned: 0, imported: 0, reused: 0, skipped: 0, failed: 0 };
    const webDavService = {
      ...emptyWebDavService(),
      test: vi.fn(async () => undefined),
      create: vi.fn(async () => result),
      list: vi.fn(() => [connector]),
    };
    const handlers = initConnectorBridge({
      folderService: emptyFolderService(),
      emailService: emptyEmailService(),
      webDavService: webDavService as never,
    });
    const credentials = {
      provider: 'custom-webdav' as const,
      serverUrl: 'https://dav.example.com/',
      username: 'person',
      password: 'private-password',
      rootPath: '/documents',
    };

    await expect(handlers.testWebDav(credentials)).resolves.toBeUndefined();
    await expect(handlers.createWebDav({ kind: 'webdav', ...credentials, initialSync: 'from-now' })).resolves.toBe(
      result
    );
    await handlers.sync('webdav-1');
    expect(webDavService.sync).toHaveBeenCalledWith('webdav-1');
    expect(JSON.stringify(await handlers.list())).not.toMatch(/dav\.example|person|private-password/i);

    await Promise.all(
      [
        { ...credentials, serverUrl: 'http://dav.example.com/' },
        { ...credentials, serverUrl: 'https://person:secret@dav.example.com/' },
        { ...credentials, rootPath: '/../private' },
        { ...credentials, password: ' ' },
      ].map((invalid) => expect(handlers.testWebDav(invalid)).rejects.toThrow('CONNECTOR_INPUT_INVALID'))
    );
    expect(webDavService.test).toHaveBeenCalledTimes(1);
  });
});

function emptyFolderService() {
  return {
    list: vi.fn(() => []),
    create: vi.fn(),
    sync: vi.fn(async () => undefined),
    setState: vi.fn(),
    disconnect: vi.fn(),
  };
}

function emptyEmailService() {
  return {
    list: vi.fn(() => []),
    test: vi.fn(async () => undefined),
    create: vi.fn(),
    sync: vi.fn(async () => undefined),
    setState: vi.fn(),
    disconnect: vi.fn(),
  };
}

function emptyWebDavService() {
  return {
    list: vi.fn(() => []),
    test: vi.fn(async () => undefined),
    create: vi.fn(),
    sync: vi.fn(async () => undefined),
    setState: vi.fn(),
    disconnect: vi.fn(),
  };
}
