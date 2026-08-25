import { describe, expect, it } from 'vitest';
import { parseIcsCalendar } from '@process/services/personal-core/connectors/calendar-ics/icsParser';
import {
  createRemoteUrlPolicy,
  resolveCalendarIcsConnection,
} from '@process/services/personal-core/connectors/calendar-ics/providerPresets';

describe('ICS parser', () => {
  it('parses timed, all-day, UTC and recurring events with unfolded lines', () => {
    const content = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:evt-1@example.com',
      'SUMMARY:Weekly review',
      'DESCRIPTION:Line one\\nLine two, with comma',
      'LOCATION:Room 3F',
      'DTSTART:20260901T090000',
      'DTEND:20260901T100000',
      'RRULE:FREQ=WEEKLY',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:evt-2@example.com',
      'SUMMARY:All day off',
      'DTSTART;VALUE=DATE:20260910',
      'DTEND;VALUE=DATE:20260911',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:evt-3@example.com',
      'SUMMARY:UTC meeting',
      'DTSTART:20260915T010000Z',
      'DTEND:20260915T020000Z',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'SUMMARY:missing uid',
      'DTSTART:20260915T010000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const result = parseIcsCalendar(content);

    expect(result.events).toHaveLength(3);
    expect(result.skipped).toBe(1);
    const [recurring, allDay, utc] = result.events;
    expect(recurring).toMatchObject({
      uid: 'evt-1@example.com',
      summary: 'Weekly review',
      description: 'Line one\nLine two, with comma\n(recurring series; imported as the first occurrence)',
      location: 'Room 3F',
      allDay: false,
      recurring: true,
      startLocalDate: '2026-09-01',
    });
    expect(allDay).toMatchObject({
      allDay: true,
      startsAt: null,
      startLocalDate: '2026-09-10',
      endLocalDate: '2026-09-11',
    });
    expect(utc).toMatchObject({ allDay: false, startsAt: '2026-09-15T01:00:00.000Z' });
  });
});

describe('calendar ICS URL policy', () => {
  const publicLookup = async (hostname: string): Promise<string[]> => {
    if (hostname === 'calendar.example.com') return ['203.0.113.10'];
    throw new Error('unexpected hostname');
  };

  it('accepts public https subscription URLs and rewrites webcal', async () => {
    const policy = createRemoteUrlPolicy(publicLookup);
    const url = await policy.assertFetchable('webcal://calendar.example.com/feed.ics?token=abc');
    expect(url.protocol).toBe('https:');
    expect(url.search).toBe('?token=abc');
  });

  it('rejects non-http schemes, credentials, and private or unresolvable hosts', async () => {
    const policy = createRemoteUrlPolicy(publicLookup);
    await expect(policy.assertFetchable('file://calendar.example.com/feed.ics')).rejects.toThrow(
      'CONNECTOR_ICS_URL_INVALID'
    );
    await expect(policy.assertFetchable('https://user:pass@calendar.example.com/feed.ics')).rejects.toThrow(
      'CONNECTOR_ICS_URL_INVALID'
    );
    const privateLookup = async (): Promise<string[]> => ['192.168.1.5'];
    await expect(
      createRemoteUrlPolicy(privateLookup).assertFetchable('https://calendar.example.com/feed.ics')
    ).rejects.toThrow('CONNECTOR_ICS_URL_INVALID');
    const literalPolicy = createRemoteUrlPolicy(publicLookup);
    await expect(literalPolicy.assertFetchable('https://127.0.0.1/feed.ics')).rejects.toThrow(
      'CONNECTOR_ICS_URL_INVALID'
    );
  });

  it('validates provider and url shape for connection inputs', () => {
    expect(resolveCalendarIcsConnection({ provider: 'feishu', url: 'https://calendar.feishu.cn/s/abc' })).toMatchObject(
      { provider: 'feishu' }
    );
    expect(() => resolveCalendarIcsConnection({ provider: 'google', url: 'https://x' })).toThrow(
      'CONNECTOR_ICS_PROVIDER_UNSUPPORTED'
    );
    expect(() => resolveCalendarIcsConnection({ provider: 'feishu', url: '   ' })).toThrow('CONNECTOR_ICS_URL_INVALID');
  });
});
