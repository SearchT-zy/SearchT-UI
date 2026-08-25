import { describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '@/common/types/searcht/calendar';
import { initCalendarBridge } from '@process/bridge/calendarBridge';

const event: CalendarEvent = {
  id: 'event-1',
  title: 'Planning',
  description: '',
  location: '',
  allDay: true,
  startsAt: null,
  endsAt: null,
  startLocalDate: '2026-08-13',
  endLocalDate: '2026-08-14',
  timezone: 'Asia/Shanghai',
  seriesId: null,
  occurrenceKey: null,
  reminderMinutes: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};

function service() {
  return {
    listEvents: vi.fn(() => [event]),
    getEvent: vi.fn(() => event),
    createEvent: vi.fn(() => event),
    updateEvent: vi.fn(() => event),
    removeEvent: vi.fn(),
    restoreEvent: vi.fn(() => event),
    destroyEvent: vi.fn(),
    emptyTrash: vi.fn(() => 2),
    listBlocks: vi.fn(() => []),
    createBlock: vi.fn(),
    updateBlock: vi.fn(),
    removeBlock: vi.fn(),
    restoreBlock: vi.fn(),
    destroyBlock: vi.fn(),
    getToday: vi.fn(() => ({ events: [event], blocks: [] })),
  };
}

describe('calendarBridge', () => {
  it('forwards calendar operations through narrow handlers', async () => {
    const calendar = service();
    const handlers = initCalendarBridge({ service: calendar });
    const query = { startLocalDate: '2026-08-01', endLocalDate: '2026-09-01' };
    await expect(handlers.list(query)).resolves.toEqual([event]);
    await expect(handlers.update({ id: event.id, title: 'Review' }, 'this-and-future')).resolves.toEqual(event);
    await expect(handlers.emptyTrash()).resolves.toEqual({ removed: 2 });
    expect(calendar.updateEvent).toHaveBeenCalledWith({ id: event.id, title: 'Review' }, 'this-and-future');
  });

  it('propagates service errors', async () => {
    const calendar = service();
    calendar.createEvent.mockImplementation(() => {
      throw new Error('Event title is required');
    });
    const handlers = initCalendarBridge({ service: calendar });
    await expect(
      handlers.create({
        title: ' ',
        allDay: true,
        startLocalDate: '2026-08-13',
        endLocalDate: '2026-08-14',
        timezone: 'Asia/Shanghai',
      })
    ).rejects.toThrow('Event title is required');
  });
});
