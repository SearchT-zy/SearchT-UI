import type { CalendarIcsConnectorTestInput, CalendarIcsProvider } from '@/common/types/searcht/connectors';
import { addressesArePublic, hostnameIsPrivateLiteral } from './addressGuard';

const MAX_URL_LENGTH = 2048;

export type RemoteAddressLookup = (hostname: string) => Promise<string[]>;

export type RemoteUrlPolicy = {
  assertFetchable(rawUrl: string): Promise<URL>;
};

/**
 * Only http/https is allowed and the resolved host must not be a loopback,
 * private, or reserved address. Subscription URLs may carry a token in the
 * query string, so the query is preserved while credentials are rejected.
 */
export function createRemoteUrlPolicy(lookup: RemoteAddressLookup): RemoteUrlPolicy {
  return {
    async assertFetchable(rawUrl: string): Promise<URL> {
      if (typeof rawUrl !== 'string' || !rawUrl.trim() || rawUrl.length > MAX_URL_LENGTH) {
        throw new Error('CONNECTOR_ICS_URL_INVALID');
      }
      let parsed: URL;
      try {
        parsed = new URL(rawUrl.trim().replace(/^webcal:\/\//i, 'https://'));
      } catch {
        throw new Error('CONNECTOR_ICS_URL_INVALID');
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('CONNECTOR_ICS_URL_INVALID');
      }
      if (parsed.username || parsed.password || parsed.hash) throw new Error('CONNECTOR_ICS_URL_INVALID');
      const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
      if (!hostname) throw new Error('CONNECTOR_ICS_URL_INVALID');
      if (hostnameIsPrivateLiteral(hostname)) throw new Error('CONNECTOR_ICS_URL_INVALID');
      let addresses: string[];
      try {
        addresses = await lookup(hostname);
      } catch {
        throw new Error('CONNECTOR_ICS_URL_INVALID');
      }
      if (!addressesArePublic(addresses)) throw new Error('CONNECTOR_ICS_URL_INVALID');
      return parsed;
    },
  };
}

export function resolveCalendarIcsConnection(input: CalendarIcsConnectorTestInput): {
  provider: CalendarIcsProvider;
  url: string;
} {
  if (!input || !['feishu', 'outlook', 'dingtalk', 'wecom', 'custom-ics'].includes(input.provider)) {
    throw new Error('CONNECTOR_ICS_PROVIDER_UNSUPPORTED');
  }
  if (
    typeof input.url !== 'string' ||
    !input.url.trim() ||
    input.url.length > MAX_URL_LENGTH ||
    input.url.includes('\u0000')
  ) {
    throw new Error('CONNECTOR_ICS_URL_INVALID');
  }
  const trimmed = input.url.trim();
  try {
    const parsed = new URL(trimmed.replace(/^webcal:\/\//i, 'https://'));
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error();
  } catch {
    throw new Error('CONNECTOR_ICS_URL_INVALID');
  }
  return { provider: input.provider, url: trimmed };
}
