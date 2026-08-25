import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CalendarEvent, Reminder } from '@/common/types/searcht/calendar';
import { CalendarRepository } from '@process/services/personal-core/CalendarRepository';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';

let directory: string;
let database: PersonalDatabase;
let repository: CalendarRepository;

const event = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'event-1',
  title: 'Planning',
  description: '',
  location: '',
  allDay: false,
  startsAt: '2026-08-13T01:00:00.000Z',
  endsAt: '2026-08-13T02:00:00.000Z',
  startLocalDate: '2026-08-13',
  endLocalDate: '2026-08-14',
  timezone: 'Asia/Shanghai',
  seriesId: null,
  occurrenceKey: null,
  reminderMinutes: 15,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  ...overrides,
});

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-calendar-repository-'));
  database = PersonalDatabase.open(directory);
  repository = new CalendarRepository(database.driver);
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('CalendarRepository', () => {
  it('lists overlapping events in chronological order without trash', () => {
    repository.insertEvent(event({ id: 'later', startsAt: '2026-08-13T03:00:00.000Z' }));
    repository.insertEvent(event({ id: 'all-day', allDay: true, startsAt: null, endsAt: null }));
    repository.insertEvent(event({ id: 'trash', deletedAt: 4 }));

    expect(
      repository.listEvents({ startLocalDate: '2026-08-13', endLocalDate: '2026-08-14' }).map((item) => item.id)
    ).toEqual(['all-day', 'later']);
  });

  it('shows only deleted events in trash queries', () => {
    repository.insertEvent(event({ id: 'active' }));
    repository.insertEvent(event({ id: 'trash', deletedAt: 4 }));
    expect(
      repository
        .listEvents({ startLocalDate: '2026-01-01', endLocalDate: '2027-01-01', trash: true })
        .map((item) => item.id)
    ).toEqual(['trash']);
  });

  it('claims a due reminder only once', () => {
    const reminder: Reminder = {
      id: 'reminder-1',
      ownerType: 'event',
      ownerId: 'event-1',
      scheduledAt: 100,
      status: 'pending',
      attempts: 0,
      claimedAt: null,
      deliveredAt: null,
      cancelledAt: null,
      lastError: null,
      createdAt: 1,
      updatedAt: 1,
    };
    repository.insertEvent(event());
    repository.upsertReminder(reminder);

    expect(repository.claimDueReminders(200, 0).map((item) => item.id)).toEqual(['reminder-1']);
    expect(repository.claimDueReminders(200, 0)).toEqual([]);
  });
});
