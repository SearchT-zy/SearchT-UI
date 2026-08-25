import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CalendarService } from '@process/services/personal-core/CalendarService';
import { PersonalDatabase } from '@process/services/personal-core/PersonalDatabase';

let directory: string;
let database: PersonalDatabase;
let service: CalendarService;

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'searcht-calendar-service-'));
  database = PersonalDatabase.open(directory);
  service = new CalendarService(database.driver);
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('CalendarService', () => {
  it('creates and restores an all-day event with half-open dates', () => {
    const created = service.createEvent(
      {
        title: '  Product day  ',
        allDay: true,
        startLocalDate: '2026-08-13',
        endLocalDate: '2026-08-14',
        timezone: 'Asia/Shanghai',
      },
      100
    );
    expect(created).toEqual(expect.objectContaining({ title: 'Product day', startsAt: null, endsAt: null }));
    service.removeEvent(created.id, 'single', 200);
    expect(service.listEvents({ startLocalDate: '2026-01-01', endLocalDate: '2027-01-01', trash: true })).toHaveLength(
      1
    );
    expect(service.restoreEvent(created.id, 300).deletedAt).toBeNull();
  });

  it('rejects an empty title and a reversed timed range', () => {
    expect(() =>
      service.createEvent({
        title: ' ',
        allDay: true,
        startLocalDate: '2026-08-13',
        endLocalDate: '2026-08-14',
        timezone: 'Asia/Shanghai',
      })
    ).toThrow('Event title is required');
    expect(() =>
      service.createEvent({
        title: 'Broken',
        allDay: false,
        startsAt: '2026-08-13T02:00:00.000Z',
        endsAt: '2026-08-13T01:00:00.000Z',
        startLocalDate: '2026-08-13',
        endLocalDate: '2026-08-14',
        timezone: 'Asia/Shanghai',
      })
    ).toThrow('Event end must be after start');
  });

  it('splits this and future while preserving historical event content', () => {
    const first = service.createEvent(
      {
        title: 'Weekly review',
        allDay: false,
        startsAt: '2026-08-03T01:00:00.000Z',
        endsAt: '2026-08-03T02:00:00.000Z',
        startLocalDate: '2026-08-03',
        endLocalDate: '2026-08-04',
        timezone: 'Asia/Shanghai',
        recurrence: {
          rule: { frequency: 'weekly', interval: 1, weekdays: [1] },
          end: { kind: 'count', occurrences: 3 },
        },
      },
      100
    );
    const instances = service.listEvents({ startLocalDate: '2026-08-01', endLocalDate: '2026-09-01' });
    expect(instances).toHaveLength(3);
    const current = instances[1]!;
    const updated = service.updateEvent({ id: current.id, title: 'Deep review' }, 'this-and-future', 200);

    expect(service.getEvent(first.id)?.title).toBe('Weekly review');
    expect(updated.title).toBe('Deep review');
    expect(updated.seriesId).not.toBe(first.seriesId);
    const audit = database.driver
      .prepare("SELECT detail_json FROM personal_audit_log WHERE action = 'calendar_series_split'")
      .get() as { detail_json: string };
    expect(audit.detail_json).not.toContain('Deep review');
  });

  it('creates an independent task time block without changing the task', () => {
    database.driver.exec(
      "INSERT INTO tasks (id, title, notes, priority, status, created_at, updated_at) VALUES ('task-1', 'Write brief', '', 'none', 'open', 1, 1)"
    );
    const block = service.createBlock({
      taskId: 'task-1',
      startsAt: '2026-08-13T01:00:00.000Z',
      endsAt: '2026-08-13T02:00:00.000Z',
      localDate: '2026-08-13',
      timezone: 'Asia/Shanghai',
    });
    expect(block.taskId).toBe('task-1');
    expect(database.driver.prepare('SELECT status FROM tasks WHERE id = ?').get('task-1')).toEqual({ status: 'open' });
  });
});
