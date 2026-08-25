// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note, NoteClient, NoteDetail } from '@/common/types/searcht/notes';
import { LayoutContext } from '@renderer/hooks/context/LayoutContext';
import NotesPage from '@renderer/pages/notes';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const activeNote: Note = {
  id: 'note-1',
  title: '产品计划',
  body: '第一版内容',
  revisionNumber: 2,
  archivedAt: null,
  createdAt: 1,
  updatedAt: 2,
  deletedAt: null,
};
const trashNote: Note = { ...activeNote, id: 'trash-1', title: '旧笔记', deletedAt: 3 };

function detail(note: Note): NoteDetail {
  return {
    note,
    sourceReferences:
      note.id === 'note-1' ? [{ id: 'link-1', sourceType: 'inbox-item', sourceId: 'item-1', createdAt: 1 }] : [],
  };
}

function makeClient(): NoteClient {
  return {
    list: vi.fn(async ({ view, search }) => {
      const notes = view === 'trash' ? [trashNote] : view === 'active' && !search ? [activeNote] : [];
      return { notes, total: notes.length, nextCursor: null };
    }),
    get: vi.fn(async (id) => detail(id === 'trash-1' ? trashNote : activeNote)),
    create: vi.fn(async (input) =>
      detail({ ...activeNote, id: 'created', title: input.title, body: input.body ?? '' })
    ),
    update: vi.fn(async (input) => detail({ ...activeNote, ...input, revisionNumber: 3 })),
    archive: vi.fn(async (ids) => ({ affectedIds: ids, affectedCount: ids.length })),
    unarchive: vi.fn(async (ids) => ({ affectedIds: ids, affectedCount: ids.length })),
    remove: vi.fn(async (ids) => ({ affectedIds: ids, affectedCount: ids.length })),
    restore: vi.fn(async (ids) => ({ affectedIds: ids, affectedCount: ids.length })),
    destroy: vi.fn(async (ids) => ({ affectedIds: ids, affectedCount: ids.length })),
    emptyTrash: vi.fn(async () => ({ affectedIds: ['trash-1'], affectedCount: 1 })),
    listRevisions: vi.fn(async () => ({
      revisions: [
        { id: 'revision-2', noteId: 'note-1', revisionNumber: 2, title: '产品计划', body: '第一版内容', createdAt: 2 },
        { id: 'revision-1', noteId: 'note-1', revisionNumber: 1, title: '产品计划', body: '初稿', createdAt: 1 },
      ],
      nextCursor: null,
    })),
    restoreRevision: vi.fn(async () => detail({ ...activeNote, body: '初稿', revisionNumber: 3 })),
  };
}

const renderNotes = (client: NoteClient, initialEntry = '/notes') =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <NotesPage client={client} />
    </MemoryRouter>
  );

describe('NotesPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads a note, edits it, and saves the current editor content', async () => {
    const client = makeClient();
    renderNotes(client);

    await userEvent.click(await screen.findByText('产品计划'));
    const title = screen.getByLabelText('personal.notes.fields.title');
    const body = screen.getByLabelText('personal.notes.fields.body');
    await userEvent.clear(title);
    await userEvent.type(title, '新版计划');
    await userEvent.clear(body);
    await userEvent.type(body, '更新后的内容');
    await userEvent.click(screen.getByRole('button', { name: 'personal.notes.actions.save' }));

    await waitFor(() =>
      expect(client.update).toHaveBeenCalledWith({ id: 'note-1', title: '新版计划', body: '更新后的内容' })
    );
    expect(screen.getByText('personal.notes.provenance.inbox')).toBeInTheDocument();
  });

  it('creates a localized untitled note and opens it in the editor', async () => {
    const client = makeClient();
    renderNotes(client);

    await userEvent.click(await screen.findByRole('button', { name: 'personal.notes.actions.create' }));

    await waitFor(() => expect(client.create).toHaveBeenCalledWith({ title: 'personal.notes.untitled', body: '' }));
    expect(await screen.findByDisplayValue('personal.notes.untitled')).toBeInTheDocument();
  });

  it('shows revision history and restores a selected revision', async () => {
    const client = makeClient();
    renderNotes(client);
    await userEvent.click(await screen.findByText('产品计划'));

    await userEvent.click(screen.getByRole('button', { name: 'personal.notes.actions.history' }));
    const drawer = await screen.findByRole('dialog');
    await userEvent.click(within(drawer).getAllByRole('button', { name: 'personal.notes.revisions.restore' })[1]!);

    await waitFor(() =>
      expect(client.restoreRevision).toHaveBeenCalledWith({ noteId: 'note-1', revisionId: 'revision-1' })
    );
  });

  it('restores a note from trash and requires confirmation before permanent deletion', async () => {
    const client = makeClient();
    renderNotes(client);

    await userEvent.click(await screen.findByText('personal.notes.views.trash'));
    await userEvent.click(await screen.findByText('旧笔记'));
    await userEvent.click(screen.getByRole('button', { name: 'personal.notes.actions.restore' }));
    await waitFor(() => expect(client.restore).toHaveBeenCalledWith(['trash-1']));
  });

  it('requires confirmation before emptying the note trash', async () => {
    const client = makeClient();
    renderNotes(client);

    await userEvent.click(await screen.findByText('personal.notes.views.trash'));
    await userEvent.click(await screen.findByRole('button', { name: 'personal.notes.actions.emptyTrash' }));

    expect(client.emptyTrash).not.toHaveBeenCalled();
    const confirmation = await screen.findByRole('dialog');
    await userEvent.click(within(confirmation).getByRole('button', { name: 'personal.notes.trash.confirmEmpty' }));

    await waitFor(() => expect(client.emptyTrash).toHaveBeenCalledTimes(1));
  });

  it('requires confirmation before permanently deleting a note', async () => {
    const client = makeClient();
    renderNotes(client);

    await userEvent.click(await screen.findByText('personal.notes.views.trash'));
    await userEvent.click(await screen.findByText('旧笔记'));
    await userEvent.click(screen.getByRole('button', { name: 'personal.notes.actions.destroy' }));

    expect(client.destroy).not.toHaveBeenCalled();
    const confirmation = await screen.findByRole('dialog');
    await userEvent.click(within(confirmation).getByRole('button', { name: 'personal.notes.actions.destroy' }));

    await waitFor(() => expect(client.destroy).toHaveBeenCalledWith(['trash-1']));
  });

  it('shows a retry action when the note list fails to load', async () => {
    const client = makeClient();
    vi.mocked(client.list)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ notes: [activeNote], total: 1, nextCursor: null });
    renderNotes(client);

    const error = await screen.findByRole('alert');
    expect(within(error).getByText('personal.notes.errors.load')).toBeInTheDocument();
    await userEvent.click(within(error).getByRole('button', { name: 'common.retry' }));

    expect(await screen.findByText('产品计划')).toBeInTheDocument();
    expect(client.list).toHaveBeenCalledTimes(2);
  });

  it('opens the note requested by the route query', async () => {
    const client = makeClient();
    renderNotes(client, '/notes?note=note-1');

    await waitFor(() => expect(client.get).toHaveBeenCalledWith('note-1'));
    expect(await screen.findByLabelText('personal.notes.fields.body')).toHaveValue('第一版内容');
  });

  it('switches to the matching lifecycle view for a linked trash note', async () => {
    const client = makeClient();
    renderNotes(client, '/notes?note=trash-1');

    await waitFor(() => expect(client.get).toHaveBeenCalledWith('trash-1'));
    await waitFor(() => expect(client.list).toHaveBeenLastCalledWith(expect.objectContaining({ view: 'trash' })));
  });

  it('opens the editor in a bounded mobile drawer', async () => {
    const client = makeClient();
    render(
      <MemoryRouter initialEntries={['/notes']}>
        <LayoutContext.Provider value={{ isMobile: true, siderCollapsed: true, setSiderCollapsed: vi.fn() }}>
          <NotesPage client={client} />
        </LayoutContext.Provider>
      </MemoryRouter>
    );

    await userEvent.click(await screen.findByText('产品计划'));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByLabelText('personal.notes.fields.body')).toHaveValue('第一版内容');
  });
});
