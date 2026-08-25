// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task, TaskListQuery } from '@/common/types/searcht/tasks';
import TodayPage from '@renderer/pages/personal/TodayPage';

const client = vi.hoisted(() => ({
  list: vi.fn(),
  complete: vi.fn(),
}));
const calendar = vi.hoisted(() => ({ getToday: vi.fn() }));
const inbox = vi.hoisted(() => ({ getPendingSummary: vi.fn() }));

vi.mock('@renderer/pages/personal/taskClient', () => ({ taskClient: client }));
vi.mock('@renderer/pages/personal/calendarClient', () => ({ calendarClient: calendar }));
vi.mock('@renderer/pages/inbox/inboxClient', () => ({ inboxClient: inbox }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const task = (id: string, dueLocalDate: string): Task => ({
  id,
  title: `Task ${id}`,
  notes: '',
  priority: 'none',
  dueAt: null,
  dueLocalDate,
  estimatedMinutes: null,
  status: 'open',
  completedAt: null,
  seriesId: null,
  occurrenceKey: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <TodayPage />
    </MemoryRouter>
  );

describe('Today task projection', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-13T08:00:00.000Z'));
    client.list.mockReset();
    client.complete.mockReset();
    calendar.getToday.mockReset();
    calendar.getToday.mockResolvedValue({ events: [], blocks: [] });
    inbox.getPendingSummary.mockReset();
    inbox.getPendingSummary.mockResolvedValue({ count: 0, items: [] });
  });

  afterEach(() => vi.useRealTimers());

  it('shows overdue tasks before today tasks and limits the band to eight', async () => {
    const overdue = Array.from({ length: 5 }, (_, index) => task(`overdue-${index + 1}`, '2026-08-12'));
    const today = Array.from({ length: 5 }, (_, index) => task(`today-${index + 1}`, '2026-08-13'));
    client.list.mockImplementation(async (query: TaskListQuery) =>
      query.view === 'today' ? today : [...today, ...overdue]
    );

    renderPage();

    expect(await screen.findByText('Task overdue-1')).toBeInTheDocument();
    expect(screen.getByText('Task today-3')).toBeInTheDocument();
    expect(screen.queryByText('Task today-4')).not.toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(8);
    expect(screen.getAllByText('personal.tasks.overdue')).toHaveLength(5);
  });

  it('queries tasks using the local calendar date instead of the UTC date', async () => {
    vi.setSystemTime(new Date(2026, 7, 13, 0, 30));
    client.list.mockResolvedValue([]);

    renderPage();

    await waitFor(() =>
      expect(client.list).toHaveBeenCalledWith(expect.objectContaining({ todayLocalDate: '2026-08-13' }))
    );
  });

  it('completes a task and refreshes the task band', async () => {
    const today = task('today', '2026-08-13');
    client.list.mockImplementation(async (query: TaskListQuery) => (query.view === 'today' ? [today] : [today]));
    client.complete.mockResolvedValue({ task: { ...today, status: 'completed' } });
    renderPage();

    await userEvent.click(await screen.findByRole('checkbox'));

    await waitFor(() => expect(client.complete).toHaveBeenCalledWith('today'));
    // Focus band adds one list call on mount; completing refreshes the band.
    await waitFor(() => expect(client.list).toHaveBeenCalledTimes(5));
  });

  it('keeps a load error local and retries with localized controls', async () => {
    client.list.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'));
    client.list.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('personal.tasks.loadError')).toBeInTheDocument();
    expect(screen.getByText('personal.today.focus')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'common.retry' }));

    await waitFor(() => expect(screen.getByText('personal.tasks.todayEmpty')).toBeInTheDocument());
  });

  it('shows the localized empty state when no tasks need attention', async () => {
    client.list.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('personal.tasks.todayEmpty')).toBeInTheDocument();
  });

  it('shows today calendar events and schedule blocks', async () => {
    client.list.mockResolvedValue([]);
    calendar.getToday.mockResolvedValue({
      events: [{ id: 'event-1', title: '产品复盘', allDay: true, startsAt: null }],
      blocks: [{ id: 'block-1', taskId: 'task-1', startsAt: '2026-08-13T09:00:00.000Z' }],
    });
    renderPage();
    expect(await screen.findByText('产品复盘')).toBeInTheDocument();
    expect(screen.getByText('task-1')).toBeInTheDocument();
  });
});
