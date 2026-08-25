// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxItem } from '@/common/types/searcht/inbox';
import type { Task } from '@/common/types/searcht/tasks';
import TodayPage from '@renderer/pages/personal/TodayPage';

const inbox = vi.hoisted(() => ({ getPendingSummary: vi.fn() }));
const tasks = vi.hoisted(() => ({ list: vi.fn(), complete: vi.fn() }));
const calendar = vi.hoisted(() => ({ getToday: vi.fn() }));

vi.mock('@renderer/pages/inbox/inboxClient', () => ({ inboxClient: inbox }));
vi.mock('@renderer/pages/personal/taskClient', () => ({ taskClient: tasks }));
vi.mock('@renderer/pages/personal/calendarClient', () => ({ calendarClient: calendar }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { count?: number }) => `${key}${options?.count ?? ''}` }),
}));

const inboxItem = (id: string): InboxItem => ({
  id,
  kind: 'text',
  state: 'pending',
  title: `Inbox ${id}`,
  textContent: id,
  url: null,
  originId: null,
  capturedAt: 10,
  organizedAt: null,
  archivedAt: null,
  createdAt: 10,
  updatedAt: 10,
  deletedAt: null,
});

const task: Task = {
  id: 'task-1',
  title: 'Task remains visible',
  notes: '',
  priority: 'none',
  dueAt: null,
  dueLocalDate: '2026-08-14',
  estimatedMinutes: null,
  status: 'open',
  completedAt: null,
  seriesId: null,
  occurrenceKey: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <TodayPage />
    </MemoryRouter>
  );

describe('Today inbox projection', () => {
  beforeEach(() => {
    inbox.getPendingSummary.mockReset();
    tasks.list.mockReset();
    tasks.complete.mockReset();
    calendar.getToday.mockReset();
    tasks.list.mockResolvedValue([]);
    calendar.getToday.mockResolvedValue({ events: [], blocks: [] });
  });

  it('shows the pending count, three newest titles, and an Inbox link', async () => {
    inbox.getPendingSummary.mockResolvedValue({
      count: 8,
      items: [inboxItem('1'), inboxItem('2'), inboxItem('3'), inboxItem('4')],
    });

    renderPage();

    expect(await screen.findByText('personal.inbox.views.pending: 8')).toBeInTheDocument();
    expect(inbox.getPendingSummary).toHaveBeenCalledWith(3);
    expect(screen.getByText('Inbox 1')).toBeInTheDocument();
    expect(screen.getByText('Inbox 2')).toBeInTheDocument();
    expect(screen.getByText('Inbox 3')).toBeInTheDocument();
    expect(screen.queryByText('Inbox 4')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'personal.tasks.viewAll personal.inbox.title' })).toHaveAttribute(
      'href',
      '/inbox'
    );
  });

  it('shows the Inbox empty state when nothing is pending', async () => {
    inbox.getPendingSummary.mockResolvedValue({ count: 0, items: [] });

    renderPage();

    expect(await screen.findByText('personal.inbox.empty')).toBeInTheDocument();
  });

  it('retries only the Inbox band after a load failure', async () => {
    inbox.getPendingSummary
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ count: 1, items: [inboxItem('recovered')] });
    tasks.list.mockResolvedValue([task]);
    calendar.getToday.mockResolvedValue({
      events: [{ id: 'event-1', title: 'Calendar remains visible', allDay: true, startsAt: null }],
      blocks: [],
    });

    renderPage();

    expect(await screen.findByText('personal.inbox.errors.load')).toBeInTheDocument();
    expect(screen.getAllByText('Task remains visible')).not.toHaveLength(0);
    expect(screen.getByText('Calendar remains visible')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'common.retry' }));

    expect(await screen.findByText('Inbox recovered')).toBeInTheDocument();
    await waitFor(() => expect(inbox.getPendingSummary).toHaveBeenCalledTimes(2));
    // Initial mount: task band + focus band fetches; the Inbox retry must not
    // re-fetch tasks or calendar.
    expect(tasks.list).toHaveBeenCalledTimes(3);
    expect(calendar.getToday).toHaveBeenCalledTimes(2);
  });
});
