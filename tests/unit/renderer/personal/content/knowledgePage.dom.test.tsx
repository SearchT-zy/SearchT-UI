// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeClient } from '@/common/types/searcht/knowledge';
import KnowledgePage from '@renderer/pages/knowledge';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function makeClient(): KnowledgeClient {
  return {
    search: vi.fn(async ({ query, sourceTypes }) => ({
      hits:
        query === 'capture' && (!sourceTypes || sourceTypes.includes('inbox-item'))
          ? [
              {
                source: {
                  id: 'source-inbox',
                  sourceType: 'inbox-item',
                  sourceId: 'inbox-1',
                  title: 'Captured source',
                  contentText: 'Captured source body',
                  contentHash: 'inbox-hash',
                  indexedAt: 2,
                  createdAt: 1,
                  updatedAt: 2,
                },
                snippet: 'Captured source body',
                score: 100,
              },
            ]
          : query === 'release' && (!sourceTypes || sourceTypes.includes('note'))
            ? [
                {
                  source: {
                    id: 'source-1',
                    sourceType: 'note',
                    sourceId: 'note-1',
                    title: 'Release plan',
                    contentText: 'Prepare the final checklist',
                    contentHash: 'hash',
                    indexedAt: 2,
                    createdAt: 1,
                    updatedAt: 2,
                  },
                  snippet: 'Prepare the final checklist',
                  score: 100,
                },
              ]
            : [],
      total: query === 'release' || query === 'capture' ? 1 : 0,
    })),
    getStatus: vi.fn(async () => ({ sourceCount: 4, noteCount: 3, inboxCount: 1, lastIndexedAt: 2 })),
    rebuild: vi.fn(async () => ({ indexedCount: 4, failedCount: 0, completedAt: 3 })),
    removeSource: vi.fn(async () => undefined),
    indexInbox: vi.fn(async () => {
      throw new Error('unused');
    }),
  };
}

describe('KnowledgePage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('searches local sources and shows provenance-aware results', async () => {
    const client = makeClient();
    render(
      <MemoryRouter>
        <KnowledgePage client={client} />
      </MemoryRouter>
    );

    await userEvent.type(
      await screen.findByRole('searchbox', { name: 'personal.knowledge.search.placeholder' }),
      'release'
    );

    await waitFor(() => expect(client.search).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'release' })));
    expect(await screen.findByText('Release plan')).toBeInTheDocument();
    expect(screen.getByText('Prepare the final checklist')).toBeInTheDocument();
    expect(screen.getByText('personal.knowledge.sourceTypes.note')).toBeInTheDocument();
  });

  it('waits for typing to settle before searching', async () => {
    const client = makeClient();
    render(
      <MemoryRouter>
        <KnowledgePage client={client} />
      </MemoryRouter>
    );

    const searchbox = await screen.findByRole('searchbox', {
      name: 'personal.knowledge.search.placeholder',
    });
    await waitFor(() => expect(client.search).toHaveBeenCalledTimes(1));
    await userEvent.type(searchbox, 'capture');

    expect(client.search).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Captured source')).toBeInTheDocument();
    expect(client.search).toHaveBeenCalledTimes(2);
  });

  it('shows a retry action when local knowledge cannot be loaded', async () => {
    const client = makeClient();
    vi.mocked(client.search).mockRejectedValueOnce(new Error('offline'));
    render(
      <MemoryRouter>
        <KnowledgePage client={client} />
      </MemoryRouter>
    );

    const error = await screen.findByRole('alert');
    expect(within(error).getByText('personal.knowledge.errors.load')).toBeInTheDocument();
    await userEvent.click(within(error).getByRole('button', { name: 'common.retry' }));

    await waitFor(() => expect(client.search).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows index status and refreshes both status and results after rebuild', async () => {
    const client = makeClient();
    render(
      <MemoryRouter>
        <KnowledgePage client={client} />
      </MemoryRouter>
    );

    expect(await screen.findByText('4')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'personal.knowledge.actions.rebuild' }));

    await waitFor(() => expect(client.rebuild).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(client.getStatus).toHaveBeenCalledTimes(2));
  });

  it('passes source filters to local search', async () => {
    const client = makeClient();
    render(
      <MemoryRouter>
        <KnowledgePage client={client} />
      </MemoryRouter>
    );

    await userEvent.click(await screen.findByText('personal.knowledge.filters.inbox'));

    await waitFor(() =>
      expect(client.search).toHaveBeenLastCalledWith(expect.objectContaining({ sourceTypes: ['inbox-item'] }))
    );
  });

  it('removes an Inbox source only after confirmation and refreshes the index', async () => {
    const client = makeClient();
    render(
      <MemoryRouter>
        <KnowledgePage client={client} />
      </MemoryRouter>
    );

    await userEvent.type(
      await screen.findByRole('searchbox', { name: 'personal.knowledge.search.placeholder' }),
      'capture'
    );
    const statusCallsBeforeRemoval = vi.mocked(client.getStatus).mock.calls.length;
    await userEvent.click(await screen.findByRole('button', { name: 'personal.knowledge.actions.removeNamed' }));

    expect(client.removeSource).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'personal.knowledge.remove.confirmAction' }));

    await waitFor(() => expect(client.removeSource).toHaveBeenCalledWith('source-inbox'));
    await waitFor(() => expect(client.getStatus).toHaveBeenCalledTimes(statusCallsBeforeRemoval + 1));
  });
});
