import { isIP } from 'node:net';

/**
 * Pure address classification. Loopback, private, shared, link-local,
 * multicast, and reserved ranges are all treated as non-remote.
 */
export function isPrivateAddress(address: string): boolean {
  if (address.includes(':')) {
    const normalized = address.toLowerCase();
    return (
      normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    );
  }
  const match = address.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (!match) return false;
  const first = Number(match[1]);
  const second = Number(match[2]);
  if (first > 255 || second > 255) return false;
  if (first === 0 || first === 10 || first === 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  return first >= 224;
}

export function hostnameIsPrivateLiteral(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal')
  ) {
    return true;
  }
  return isIP(normalized) !== 0 && isPrivateAddress(normalized);
}

export function addressesArePublic(addresses: string[]): boolean {
  return addresses.length > 0 && !addresses.some((address) => isPrivateAddress(address));
}
