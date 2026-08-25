import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

/**
 * Encrypted bundle format for SearchT-UI cloud sync:
 *   ZXSYNC1 | salt(16) | iv(12) | tag(16) | ciphertext
 *
 * The AES-256-GCM master key is derived from the user passphrase with scrypt
 * and a per-sync-root salt. Each bundle is sealed with a per-bundle key
 * derived from the master key plus a fresh random salt, so the passphrase
 * never leaves the device and the remote only stores the bytes above plus a
 * salted verifier used to check the passphrase on another device.
 */

const MAGIC = Buffer.from('ZXSYNC1', 'utf8');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const SCRYPT_N = 16_384;

export function deriveMasterKey(passphrase: string, masterSalt: Buffer): Buffer {
  const normalized = passphrase.normalize('NFKC');
  if (!normalized || normalized.length > 1_024) throw new Error('CLOUD_SYNC_PASSPHRASE_INVALID');
  if (masterSalt.length !== SALT_BYTES) throw new Error('CLOUD_SYNC_SALT_INVALID');
  return scryptSync(normalized, masterSalt, KEY_BYTES, { N: SCRYPT_N, r: 8, p: 1 });
}

export function makeVerifier(masterKey: Buffer): Buffer {
  return createHash('sha256')
    .update(Buffer.concat([masterKey, Buffer.from('searcht-sync-verify', 'utf8')]))
    .digest();
}

export function masterKeyMatches(masterKey: Buffer, verifier: Buffer): boolean {
  const expected = makeVerifier(masterKey);
  return expected.length === verifier.length && timingSafeEqual(expected, verifier);
}

function bundleKey(masterKey: Buffer, salt: Buffer): Buffer {
  return createHash('sha256')
    .update(Buffer.concat([masterKey, salt]))
    .digest();
}

export function encryptBundle(plaintext: Buffer, masterKey: Buffer): Buffer {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', bundleKey(masterKey, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, salt, iv, tag, ciphertext]);
}

export function decryptBundle(bundle: Buffer, masterKey: Buffer): Buffer {
  const headerLength = MAGIC.length + SALT_BYTES + IV_BYTES + TAG_BYTES;
  if (bundle.length <= headerLength) throw new Error('CLOUD_SYNC_BUNDLE_INVALID');
  if (!bundle.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('CLOUD_SYNC_BUNDLE_INVALID');
  let offset = MAGIC.length;
  const salt = bundle.subarray(offset, offset + SALT_BYTES);
  offset += SALT_BYTES;
  const iv = bundle.subarray(offset, offset + IV_BYTES);
  offset += IV_BYTES;
  const tag = bundle.subarray(offset, offset + TAG_BYTES);
  offset += TAG_BYTES;
  const ciphertext = bundle.subarray(offset);
  const decipher = createDecipheriv('aes-256-gcm', bundleKey(masterKey, salt), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error('CLOUD_SYNC_DECRYPT_FAILED');
  }
}

export function newMasterSalt(): Buffer {
  return randomBytes(SALT_BYTES);
}

export function bundleFingerprint(bundle: Buffer): string {
  return createHash('sha256').update(bundle).digest('hex');
}
