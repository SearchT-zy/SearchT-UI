import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';
import { CalendarIcsConnectorService } from '@process/services/personal-core/connectors/calendar-ics/CalendarIcsConnectorService';

let directory: string;
let database: PersonalDatabase;
let fetchMock: ReturnType<typeof vi.fn>;
let secretsStore: Map<string, unknown>;
let service: CalendarIcsConnectorService;

const feed = (uid: string, summary: string): string =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `SUMMARY:${summary}`,
    'DTSTART:20260901T090000',
    'DTEND:20260901T100000',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-ics-connector-'));
  database = PersonalDatabase.open(directory);
  fetchMock = vi.fn(async () => feed('evt-1', 'Standup'));
  secretsStore = new Map();
  const secrets = {
    setCalendarIcs: (id: string, value: unknown) => void secretsStore.set(id, value),
    getCalendarIcs: (id: string) => (secretsStore.get(id) as never) ?? null,
    delete: (id: string) => void secretsStore.delete(id),
  };
  service = new CalendarIcsConnectorService(database.driver, secrets, { fetchCalendar: fetchMock }, 'Asia/Shanghai');
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

const createInput = {
  kind: 'calendar-ics' as const,
  provider: 'feishu' as const,
  url: 'https://calendar.example.com/feed.ics',
  initialSync: 'import-existing' as const,
};

function importedEventIds(): string[] {
  return (
    database.driver
      .prepare("SELECT id FROM calendar_events WHERE id LIKE 'ics-%' AND deleted_at IS NULL")
      .all() as Array<{
      id: string;
    }>
  ).map((row) => row.id);
}

describe('CalendarIcsConnectorService', () => {
  it('creates a subscription and projects feed events into the calendar', async () => {
    const result = await service.create(createInput, 1_000);

    expect(result).toMatchObject({ scanned: 1, imported: 1 });
    expect(importedEventIds()).toHaveLength(1);
    const event = database.driver.prepare('SELECT title, start_local_date, timezone FROM calendar_events').get() as {
      title: string;
      start_local_date: string;
      timezone: string;
    };
    expect(event).toMatchObject({ title: 'Standup', start_local_date: '2026-09-01', timezone: 'Asia/Shanghai' });
    expect(service.list()[0]).toMatchObject({ kind: 'calendar-ics', state: 'active' });
  });

  it('skips work entirely when the feed body is unchanged', async () => {
    const created = await service.create(createInput, 1_000);

    const second = await service.sync(created.connector.id, 2_000);

    expect(second).toMatchObject({ imported: 0, skipped: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('updates changed events and soft-deletes removed ones', async () => {
    const created = await service.create(createInput, 1_000);
    fetchMock.mockResolvedValue(feed('evt-2', 'Renamed'));

    const result = await service.sync(created.connector.id, 2_000);

    expect(result).toMatchObject({ imported: 1 });
    expect(importedEventIds()).toHaveLength(1);
    const removed = database.driver
      .prepare("SELECT deleted_at FROM calendar_events WHERE id LIKE 'ics-%' AND deleted_at IS NOT NULL")
      .all() as Array<{ deleted_at: number }>;
    expect(removed).toHaveLength(1);
  });

  it('rejects a second subscription for the same provider and cleans up on disconnect', async () => {
    await service.create(createInput, 1_000);
    await expect(service.create(createInput, 2_000)).rejects.toThrow('CONNECTOR_ALREADY_EXISTS');

    const account = service.list()[0];
    service.disconnect(account.id, 3_000);
    expect(service.list()).toHaveLength(0);
    expect(importedEventIds()).toHaveLength(0);
    expect(secretsStore.size).toBe(0);
  });

  it('records fetch failures with a stable error code', async () => {
    const created = await service.create(createInput, 1_000);
    fetchMock.mockRejectedValue(new Error('CONNECTOR_ICS_HTTP_502'));

    await expect(service.sync(created.connector.id, 2_000)).rejects.toThrow('CONNECTOR_ICS_HTTP_502');
    expect(service.list()[0]).toMatchObject({ state: 'error', lastErrorCode: 'CONNECTOR_ICS_HTTP_502' });
  });
});
