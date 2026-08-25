import { describe, expect, it } from 'vitest';
import {
  bundleFingerprint,
  decryptBundle,
  deriveMasterKey,
  encryptBundle,
  makeVerifier,
  masterKeyMatches,
  newMasterSalt,
} from '@process/services/personal-core/cloudSync/CloudSyncCrypto';

describe('cloud sync crypto', () => {
  it('round-trips plaintext through the encrypted bundle format', () => {
    const masterKey = deriveMasterKey('correct horse battery', newMasterSalt());
    const plaintext = Buffer.from('SearchT-UI cloud sync payload', 'utf8');

    const bundle = encryptBundle(plaintext, masterKey);

    expect(bundle.subarray(0, 7).toString('utf8')).toBe('ZXSYNC1');
    expect(bundle.toString('utf8')).not.toContain('SearchT-UI');
    expect(decryptBundle(bundle, masterKey).toString('utf8')).toBe('SearchT-UI cloud sync payload');
  });

  it('rejects tampered ciphertext and wrong keys', () => {
    const masterKey = deriveMasterKey('correct horse battery', newMasterSalt());
    const bundle = encryptBundle(Buffer.from('secret'), masterKey);

    const tampered = Buffer.from(bundle);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decryptBundle(tampered, masterKey)).toThrow('CLOUD_SYNC_DECRYPT_FAILED');

    const otherKey = deriveMasterKey('a different passphrase', newMasterSalt());
    expect(() => decryptBundle(bundle, otherKey)).toThrow('CLOUD_SYNC_DECRYPT_FAILED');
    expect(() => decryptBundle(Buffer.from('short'), masterKey)).toThrow('CLOUD_SYNC_BUNDLE_INVALID');
  });

  it('derives the same key from the same passphrase and salt and verifies it', () => {
    const salt = newMasterSalt();
    const key = deriveMasterKey('correct horse battery', salt);
    expect(deriveMasterKey('correct horse battery', salt).equals(key)).toBe(true);
    expect(deriveMasterKey('another passphrase!', salt).equals(key)).toBe(false);
    expect(masterKeyMatches(key, makeVerifier(key))).toBe(true);
    expect(masterKeyMatches(key, makeVerifier(deriveMasterKey('another passphrase!', salt)))).toBe(false);
    expect(bundleFingerprint(Buffer.from('a'))).not.toBe(bundleFingerprint(Buffer.from('b')));
  });
});
