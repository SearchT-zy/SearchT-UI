import { lookup as dnsLookup } from 'node:dns/promises';
import { createRemoteUrlPolicy, type RemoteUrlPolicy } from './providerPresets';

const MAX_BODY_BYTES = 5 * 1024 * 1024;

export type IcsFetchResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
};

export type IcsFetch = (url: string) => Promise<IcsFetchResponse>;

const defaultLookup = async (hostname: string): Promise<string[]> => {
  const results = await dnsLookup(hostname, { all: true });
  return results.map((result) => result.address);
};

const defaultFetch: IcsFetch = async (url) => {
  const response = await fetch(url, { method: 'GET', redirect: 'error' });
  return { ok: response.ok, status: response.status, text: () => response.text() };
};

export class IcsCalendarClient {
  private readonly policy: RemoteUrlPolicy;

  constructor(
    private readonly fetchImpl: IcsFetch = defaultFetch,
    policy?: RemoteUrlPolicy
  ) {
    this.policy = policy ?? createRemoteUrlPolicy(defaultLookup);
  }

  async fetchCalendar(url: string): Promise<string> {
    const target = await this.policy.assertFetchable(url);
    const response = await this.fetchImpl(target.toString());
    if (!response.ok) throw new Error(`CONNECTOR_ICS_HTTP_${response.status}`);
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) throw new Error('CONNECTOR_ICS_BODY_TOO_LARGE');
    if (!body.includes('BEGIN:VCALENDAR')) throw new Error('CONNECTOR_ICS_BODY_INVALID');
    return body;
  }
}
