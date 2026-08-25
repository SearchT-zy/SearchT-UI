import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ConnectorSecretStore,
  type ConnectorSecretCipher,
  type ConnectorSecretFileSystem,
} from '@process/services/personal-core/connectors/ConnectorSecretStore';

const directories: string[] = [];

function makeStore(
  cipher: ConnectorSecretCipher = fakeCipher(),
  fileSystem?: ConnectorSecretFileSystem
): { store: ConnectorSecretStore; filePath: string } {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-connector-secrets-'));
  directories.push(directory);
  const filePath = path.join(directory, 'connector-secrets.json');
  return { store: new ConnectorSecretStore(filePath, cipher, fileSystem), filePath };
}

function fakeCipher(available = true): ConnectorSecretCipher {
  return {
    isAvailable: () => available,
    encrypt: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decrypt: (value) => value.toString('utf8').replace(/^encrypted:/, ''),
  };
}

const realFileSystem: ConnectorSecretFileSystem = {
  exists: existsSync,
  mkdir: (directory) => mkdirSync(directory, { recursive: true }),
  read: (filePath) => readFileSync(filePath, 'utf8'),
  write: (filePath, content) => writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o600 }),
  rename: renameSync,
  remove: (filePath) => rmSync(filePath, { force: true }),
};

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('ConnectorSecretStore', () => {
  it('persists only ciphertext and round-trips email credentials', () => {
    const { store, filePath } = makeStore();

    store.setEmail('connector-1', { emailAddress: 'person@qq.com', authorizationCode: 'private-code' });

    const persisted = readFileSync(filePath, 'utf8');
    expect(persisted).not.toContain('private-code');
    expect(persisted).not.toContain('person@qq.com');
    expect(store.getEmail('connector-1')).toEqual({
      emailAddress: 'person@qq.com',
      authorizationCode: 'private-code',
    });
  });

  it('persists only ciphertext and round-trips WebDAV credentials', () => {
    const { store, filePath } = makeStore();

    store.setWebDav('connector-webdav', {
      serverUrl: 'https://dav.example.com/private/',
      username: 'private-user',
      password: 'private-password',
    });

    const persisted = readFileSync(filePath, 'utf8');
    expect(persisted).not.toContain('dav.example.com');
    expect(persisted).not.toContain('private-user');
    expect(persisted).not.toContain('private-password');
    expect(store.getWebDav('connector-webdav')).toEqual({
      serverUrl: 'https://dav.example.com/private/',
      username: 'private-user',
      password: 'private-password',
    });
  });

  it('refuses writes when encryption is unavailable', () => {
    const { store, filePath } = makeStore(fakeCipher(false));

    expect(() =>
      store.setEmail('connector-1', { emailAddress: 'person@qq.com', authorizationCode: 'private-code' })
    ).toThrow('CONNECTOR_SECURE_STORAGE_UNAVAILABLE');
    expect(existsSync(filePath)).toBe(false);
  });

  it('removes one connector credential without removing other entries', () => {
    const { store } = makeStore();
    store.setEmail('connector-1', { emailAddress: 'first@qq.com', authorizationCode: 'first-code' });
    store.setEmail('connector-2', { emailAddress: 'second@163.com', authorizationCode: 'second-code' });

    store.delete('connector-1');

    expect(store.getEmail('connector-1')).toBeNull();
    expect(store.getEmail('connector-2')).toEqual({
      emailAddress: 'second@163.com',
      authorizationCode: 'second-code',
    });
  });

  it('does not replace the current file when an atomic rename fails', () => {
    const { store, filePath } = makeStore(fakeCipher(), {
      ...realFileSystem,
      rename: () => {
        throw new Error('disk failure');
      },
    });
    writeFileSync(filePath, JSON.stringify({ version: 1, entries: {} }), 'utf8');
    const original = readFileSync(filePath, 'utf8');

    expect(() =>
      store.setEmail('connector-1', { emailAddress: 'person@qq.com', authorizationCode: 'private-code' })
    ).toThrow('CONNECTOR_SECRET_WRITE_FAILED');
    expect(readFileSync(filePath, 'utf8')).toBe(original);
    expect(readFileSync(filePath, 'utf8')).not.toContain('private-code');
  });
});
