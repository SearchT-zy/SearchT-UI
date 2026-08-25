// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { InboxItem, InboxItemDetail } from '@/common/types/searcht/inbox';
import type { InboxDataClient } from '@renderer/pages/inbox/inboxClient';
import InboxPage from '@renderer/pages/inbox';
import { LayoutContext } from '@renderer/hooks/context/LayoutContext';

const translate = (key: string) => key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));

const pendingItem: InboxItem = {
  id: 'item-1',
  kind: 'text',
  state: 'pending',
  title: '产品访谈要点',
  textContent: '整理今天访谈中的三个关键问题。',
  url: null,
  originId: null,
  capturedAt: 2,
  organizedAt: null,
  archivedAt: null,
  createdAt: 2,
  updatedAt: 2,
  deletedAt: null,
};

const trashItem: InboxItem = { ...pendingItem, id: 'item-trash', title: '旧资料', deletedAt: 3 };
const organizedItem: InboxItem = {
  ...pendingItem,
  id: 'item-organized',
  state: 'organized',
  title: '已整理访谈要点',
  organizedAt: 3,
};

function detail(item: InboxItem): InboxItemDetail {
  return { item, asset: null, origin: null, sourceLinks: [] };
}

function makeClient(): InboxDataClient {
  return {
    list: vi.fn(async ({ view, search }) => {
      const items =
        view === 'trash'
          ? [trashItem]
          : view === 'organized'
            ? [organizedItem]
            : view === 'pending' && !search
              ? [pendingItem]
              : [];
      return { items, total: items.length, nextCursor: null };
    }),
    get: vi.fn(async (id) =>
      id === trashItem.id ? detail(trashItem) : id === organizedItem.id ? detail(organizedItem) : detail(pendingItem)
    ),
    captureText: vi.fn(async (input) => ({ ...pendingItem, id: 'captured', title: input.title ?? input.text })),
    captureLink: vi.fn(async () => pendingItem),
    importFiles: vi.fn(async () => ({ imported: [], failed: [] })),
    update: vi.fn(async (input) => ({ ...pendingItem, ...input })),
    archive: vi.fn(async (ids) => ({ affectedIds: ids, affectedCount: ids.length })),
    remove: vi.fn(async (ids) => ({ affectedIds: ids, affectedCount: ids.length })),
    restore: vi.fn(async (ids) => ({ affectedIds: ids, affectedCount: ids.length })),
    destroy: vi.fn(async (ids) => ({ affectedIds: ids, affectedCount: ids.length })),
    emptyTrash: vi.fn(async () => ({ affectedIds: [trashItem.id], affectedCount: 1 })),
    convertToTask: vi.fn(async () => ({
      item: { ...pendingItem, state: 'organized' },
      sourceLink: {
        id: 'link-1',
        sourceType: 'inbox-item',
        sourceId: pendingItem.id,
        targetType: 'task',
        targetId: 'task-1',
        createdAt: 4,
      },
      targetId: 'task-1',
      alreadyCompleted: false,
    })),
    convertToEvent: vi.fn(async () => ({
      item: { ...pendingItem, state: 'organized' },
      sourceLink: {
        id: 'link-2',
        sourceType: 'inbox-item',
        sourceId: pendingItem.id,
        targetType: 'calendar-event',
        targetId: 'event-1',
        createdAt: 4,
      },
      targetId: 'event-1',
      alreadyCompleted: false,
    })),
    convertToNote: vi.fn(async () => ({
      item: { ...pendingItem, state: 'organized' },
      sourceLink: {
        id: 'link-note',
        sourceType: 'inbox-item',
        sourceId: pendingItem.id,
        targetType: 'note',
        targetId: 'note-1',
        createdAt: 4,
      },
      targetId: 'note-1',
      alreadyCompleted: false,
    })),
    convertToKnowledge: vi.fn(async () => ({
      item: { ...pendingItem, state: 'organized' },
      sourceLink: {
        id: 'link-knowledge',
        sourceType: 'inbox-item',
        sourceId: pendingItem.id,
        targetType: 'knowledge-source',
        targetId: 'source-1',
        createdAt: 4,
      },
      targetId: 'source-1',
      alreadyCompleted: false,
    })),
    getPendingSummary: vi.fn(async () => ({ count: 1, items: [pendingItem] })),
    getPreview: vi.fn(async () => ({
      kind: 'missing' as const,
      mimeType: null,
      displayName: '',
      url: null,
      text: null,
      truncated: false,
      canReveal: false,
      canDownload: false,
    })),
    revealManagedFile: vi.fn(async () => undefined),
  };
}

const LocationProbe = () => {
  const location = useLocation();
  return <output aria-label='location'>{`${location.pathname}${location.search}`}</output>;
};

const renderInbox = (client: InboxDataClient, initialEntry = '/inbox') =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <InboxPage client={client} />
      <LocationProbe />
    </MemoryRouter>
  );

describe('InboxPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the inbox and shows the selected item in the detail pane', async () => {
    const client = makeClient();
    renderInbox(client);

    await userEvent.click(await screen.findByText('产品访谈要点'));

    expect(
      await within(screen.getByRole('region', { name: 'personal.inbox.detail.label' })).findByText(
        '整理今天访谈中的三个关键问题。'
      )
    ).toBeInTheDocument();
    expect(client.get).toHaveBeenCalledWith('item-1');
    expect(screen.getByRole('button', { name: 'personal.inbox.actions.toNote' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'personal.inbox.actions.toKnowledge' })).toBeEnabled();
  });

  it('opens an organized item referenced by the route query', async () => {
    const client = makeClient();
    renderInbox(client, '/inbox?item=item-organized');

    expect(await screen.findByText('已整理访谈要点')).toBeInTheDocument();
    expect(client.list).toHaveBeenCalledWith(expect.objectContaining({ view: 'organized' }));
    expect(client.get).toHaveBeenCalledWith('item-organized');
    expect(
      await within(screen.getByRole('region', { name: 'personal.inbox.detail.label' })).findByText(
        '整理今天访谈中的三个关键问题。'
      )
    ).toBeInTheDocument();
  });

  it('captures text without closing the drawer before a successful save', async () => {
    const client = makeClient();
    renderInbox(client);

    await userEvent.click(await screen.findByRole('button', { name: 'personal.inbox.capture.open' }));
    await userEvent.type(screen.getByLabelText('personal.inbox.fields.content'), '新的灵感');
    await userEvent.click(screen.getByRole('button', { name: 'personal.inbox.capture.saveText' }));

    await waitFor(() => expect(client.captureText).toHaveBeenCalledWith({ text: '新的灵感', title: undefined }));
    await waitFor(() => expect(screen.queryByLabelText('personal.inbox.fields.content')).not.toBeInTheDocument());
  });

  it('passes search terms and performs batch archive', async () => {
    const client = makeClient();
    renderInbox(client);
    await screen.findByText('产品访谈要点');

    await userEvent.type(screen.getByRole('searchbox', { name: 'personal.inbox.search' }), '访谈');
    await waitFor(() => expect(client.list).toHaveBeenLastCalledWith(expect.objectContaining({ search: '访谈' })));
    await userEvent.clear(screen.getByRole('searchbox', { name: 'personal.inbox.search' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'personal.inbox.selectNamed' }));
    await userEvent.click(screen.getByRole('button', { name: 'personal.inbox.actions.archiveSelected' }));

    await waitFor(() => expect(client.archive).toHaveBeenCalledWith(['item-1']));
  });

  it('restores and permanently deletes items from trash', async () => {
    const client = makeClient();
    renderInbox(client);

    await userEvent.click(await screen.findByText('personal.inbox.views.trash'));
    await userEvent.click(await screen.findByText('旧资料'));
    await userEvent.click(screen.getByRole('button', { name: 'personal.inbox.actions.restore' }));
    await waitFor(() => expect(client.restore).toHaveBeenCalledWith(['item-trash']));
    await userEvent.click(await screen.findByText('旧资料'));
    await userEvent.click(screen.getByRole('button', { name: 'personal.inbox.actions.destroy' }));

    await waitFor(() => expect(client.destroy).toHaveBeenCalledWith(['item-trash']));
  });

  it('opens task conversion and submits the current title', async () => {
    const client = makeClient();
    renderInbox(client);
    await userEvent.click(await screen.findByText('产品访谈要点'));

    await userEvent.click(screen.getByRole('button', { name: 'personal.inbox.actions.toTask' }));
    await userEvent.click(await screen.findByRole('button', { name: 'personal.inbox.convert.createTask' }));

    await waitFor(() =>
      expect(client.convertToTask).toHaveBeenCalledWith(
        expect.objectContaining({ sourceId: 'item-1', target: expect.objectContaining({ title: '产品访谈要点' }) })
      )
    );
  });

  it('converts the selected item to a note and opens the new note', async () => {
    const client = makeClient();
    renderInbox(client);
    await userEvent.click(await screen.findByText('产品访谈要点'));

    await userEvent.click(screen.getByRole('button', { name: 'personal.inbox.actions.toNote' }));

    await waitFor(() =>
      expect(client.convertToNote).toHaveBeenCalledWith(
        expect.objectContaining({ sourceId: 'item-1', operationId: expect.any(String) })
      )
    );
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'location' })).toHaveTextContent('/notes?note=note-1')
    );
  });

  it('adds the selected item to Knowledge and opens Knowledge', async () => {
    const client = makeClient();
    renderInbox(client);
    await userEvent.click(await screen.findByText('产品访谈要点'));

    await userEvent.click(screen.getByRole('button', { name: 'personal.inbox.actions.toKnowledge' }));

    await waitFor(() =>
      expect(client.convertToKnowledge).toHaveBeenCalledWith(
        expect.objectContaining({ sourceId: 'item-1', operationId: expect.any(String) })
      )
    );
    await waitFor(() => expect(screen.getByRole('status', { name: 'location' })).toHaveTextContent('/knowledge'));
  });

  it('opens item details in a dismissible drawer on mobile', async () => {
    const client = makeClient();
    render(
      <MemoryRouter initialEntries={['/inbox']}>
        <LayoutContext.Provider value={{ isMobile: true, siderCollapsed: true, setSiderCollapsed: vi.fn() }}>
          <InboxPage client={client} />
        </LayoutContext.Provider>
      </MemoryRouter>
    );

    await screen.findByText('产品访谈要点');
    expect(screen.queryByRole('region', { name: 'personal.inbox.detail.label' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('产品访谈要点'));

    const drawer = await waitFor(() => {
      const element = document.querySelector('.arco-drawer');
      expect(element).toBeInTheDocument();
      return element as HTMLElement;
    });
    expect(within(drawer).getByText('整理今天访谈中的三个关键问题。')).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: 'common.close' }));
    await waitFor(() => expect(document.querySelector('.arco-drawer')).not.toBeInTheDocument());
  });
});
