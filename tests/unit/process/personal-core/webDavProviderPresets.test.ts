import { describe, expect, it } from 'vitest';
import {
  JIANGUOYUN_WEBDAV_URL,
  normalizeWebDavRootPath,
  resolveWebDavConnection,
} from '@process/services/personal-core/connectors/webdav/providerPresets';

describe('WebDAV provider presets', () => {
  it('uses the official Jianguoyun endpoint without exposing a server field', () => {
    expect(
      resolveWebDavConnection({
        provider: 'jianguoyun',
        username: 'person@example.com',
        password: 'app-password',
        rootPath: '工作/收件箱',
      })
    ).toEqual({
      provider: 'jianguoyun',
      serverUrl: JIANGUOYUN_WEBDAV_URL,
      username: 'person@example.com',
      password: 'app-password',
      rootPath: '/工作/收件箱',
    });
  });

  it.each([
    'http://dav.example.com/',
    'ftp://dav.example.com/',
    'https://user:password@dav.example.com/',
    'https://dav.example.com/#secret',
  ])('rejects unsafe custom server URLs: %s', (serverUrl) => {
    expect(() =>
      resolveWebDavConnection({
        provider: 'custom-webdav',
        serverUrl,
        username: 'person',
        password: 'secret',
        rootPath: '/',
      })
    ).toThrow('CONNECTOR_WEBDAV_URL_INVALID');
  });

  it('normalizes a safe HTTPS URL and root path', () => {
    expect(
      resolveWebDavConnection({
        provider: 'custom-webdav',
        serverUrl: 'https://dav.example.com/base',
        username: ' person ',
        password: ' secret ',
        rootPath: '\\folder\\nested/',
      })
    ).toEqual({
      provider: 'custom-webdav',
      serverUrl: 'https://dav.example.com/base/',
      username: 'person',
      password: 'secret',
      rootPath: '/folder/nested',
    });
  });

  it.each(['/../secret', '/folder/../../secret', '/folder/./secret', '/folder\u0000name'])(
    'rejects unsafe root paths: %s',
    (rootPath) => expect(() => normalizeWebDavRootPath(rootPath)).toThrow('CONNECTOR_WEBDAV_ROOT_INVALID')
  );
});
