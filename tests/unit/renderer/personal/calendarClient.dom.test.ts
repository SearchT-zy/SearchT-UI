// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function client() {
  vi.resetModules();
  delete (window as Window & { electronAPI?: unknown }).electronAPI;
  return (await import('@renderer/pages/personal/calendarClient')).calendarClient;
}

describe('browser calendar client', () => {
  beforeEach(() => localStorage.clear());

  it('backs up corrupted storage before returning empty data', async () => {
    localStorage.setItem('searcht.calendar.v1', '{bad');
    await expect((await client()).list({ startLocalDate: '2026-08-01', endLocalDate: '2026-09-01' })).resolves.toEqual(
      []
    );
    expect(Object.keys(localStorage).some((key) => key.startsWith('searcht.calendar.v1.corrupt.'))).toBe(true);
  });

  it('creates, sorts, trashes, and restores events', async () => {
    const calendar = await client();
    const later = await calendar.create({
      title: 'Later',
      allDay: false,
      startsAt: '2026-08-13T03:00:00.000Z',
      endsAt: '2026-08-13T04:00:00.000Z',
      startLocalDate: '2026-08-13',
      endLocalDate: '2026-08-14',
      timezone: 'Asia/Shanghai',
    });
    const allDay = await calendar.create({
      title: 'All day',
      allDay: true,
      startLocalDate: '2026-08-13',
      endLocalDate: '2026-08-14',
      timezone: 'Asia/Shanghai',
    });
    await expect(calendar.list({ startLocalDate: '2026-08-13', endLocalDate: '2026-08-14' })).resolves.toEqual([
      expect.objectContaining({ id: allDay.id }),
      expect.objectContaining({ id: later.id }),
    ]);
    await calendar.remove(later.id, 'single');
    await expect(
      calendar.list({ startLocalDate: '2026-01-01', endLocalDate: '2027-01-01', trash: true })
    ).resolves.toEqual([expect.objectContaining({ id: later.id })]);
    await expect(calendar.restore(later.id)).resolves.toEqual(expect.objectContaining({ deletedAt: null }));
  });

  it('keeps time blocks independent and projects them into Today', async () => {
    const calendar = await client();
    const block = await calendar.createBlock({
      taskId: 'task-1',
      startsAt: '2026-08-13T01:00:00.000Z',
      endsAt: '2026-08-13T02:00:00.000Z',
      localDate: '2026-08-13',
      timezone: 'Asia/Shanghai',
    });
    await expect(calendar.getToday('2026-08-13')).resolves.toEqual({
      events: [],
      blocks: [expect.objectContaining({ id: block.id, taskId: 'task-1' })],
    });
  });

  it('materializes recurring events in WebUI storage', async () => {
    const calendar = await client();
    await calendar.create({
      title: 'Daily review',
      allDay: true,
      startLocalDate: '2026-08-13',
      endLocalDate: '2026-08-14',
      timezone: 'Asia/Shanghai',
      recurrence: { rule: { frequency: 'daily', interval: 1 }, end: { kind: 'count', occurrences: 3 } },
    });
    await expect(calendar.list({ startLocalDate: '2026-08-13', endLocalDate: '2026-08-17' })).resolves.toHaveLength(3);
  });
});
