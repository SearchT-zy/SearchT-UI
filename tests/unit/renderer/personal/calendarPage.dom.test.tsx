// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarClient } from '@renderer/pages/personal/calendarClient';
import CalendarPage from '@renderer/pages/calendar';
import CalendarEditorDrawer from '@renderer/pages/calendar/CalendarEditorDrawer';
import ScheduleBlockDrawer from '@renderer/pages/calendar/ScheduleBlockDrawer';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const event = {
  id: 'event-1',
  title: '项目复盘',
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
} as const;
const client: CalendarClient = {
  list: vi.fn(async () => [event]),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  destroy: vi.fn(),
  emptyTrash: vi.fn(),
  listBlocks: vi.fn(async () => []),
  createBlock: vi.fn(),
  updateBlock: vi.fn(),
  removeBlock: vi.fn(),
  restoreBlock: vi.fn(),
  destroyBlock: vi.fn(),
  getToday: vi.fn(),
  getNotificationCapability: vi.fn(async () => ({ available: true, permission: 'granted', backgroundReliable: false })),
};

describe('CalendarPage', () => {
  it('shows a month grid and selected-day events', async () => {
    render(<CalendarPage client={client} initialDate='2026-08-13' />);
    await waitFor(() => expect(screen.getAllByRole('gridcell')).toHaveLength(42));
    expect(screen.getByText('项目复盘')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('gridcell', { name: /2026-08-14/ })).getByRole('button'));
    await waitFor(() => expect(screen.getByText('2026-08-14')).toBeInTheDocument());
  });

  it('exposes trash and task time-block workflows', async () => {
    render(<CalendarPage client={client} initialDate='2026-08-13' />);
    await waitFor(() => expect(screen.getAllByRole('gridcell')).toHaveLength(42));
    expect(screen.getByRole('button', { name: 'personal.calendar.createBlock' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('personal.tasks.views.trash'));
    await waitFor(() => expect(client.list).toHaveBeenCalledWith(expect.objectContaining({ trash: true })));
  });

  it('keeps editor drawers within a narrow viewport', () => {
    const { unmount } = render(
      <CalendarEditorDrawer
        visible
        date='2026-08-13'
        event={null}
        saving={false}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(document.querySelector('.arco-drawer')?.getAttribute('style')).toContain('max-width: 100vw');
    unmount();

    render(<ScheduleBlockDrawer visible date='2026-08-13' saving={false} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(document.querySelector('.arco-drawer')?.getAttribute('style')).toContain('max-width: 100vw');
  });
});
