// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Message } from '@arco-design/web-react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TTeam } from '@/common/types/team/teamTypes';
import TeamGroupView from '@renderer/pages/team/group';

const timelineMocks = vi.hoisted(() => ({
  revalidate: vi.fn(),
}));

vi.mock('@renderer/pages/team/group/useGroupTimeline', () => ({
  useGroupTimeline: () => ({
    timeline: [],
    snapshot: { messages: [], deliveries: [] },
    activities: [],
    activity: { isLoading: false },
    isLoading: false,
    error: null,
    revalidate: timelineMocks.revalidate,
  }),
}));

vi.mock('@renderer/components/media/FileAttachButton', () => ({
  default: ({ openFileSelector }: { openFileSelector: () => void }) => (
    <button type='button' data-testid='group-attach' onClick={openFileSelector}>
      attach
    </button>
  ),
}));

const team: TTeam = {
  id: 'team-1',
  user_id: 'user-1',
  name: 'Launch group',
  workspace: 'C:\\workspace',
  workspace_mode: 'shared',
  leader_assistant_id: 'assistant-leader',
  assistants: [
    {
      slot_id: 'leader',
      conversation_id: 'conversation-leader',
      role: 'leader',
      assistant_backend: 'claude',
      assistant_name: 'Claude Code',
      status: 'idle',
    },
    {
      slot_id: 'codex',
      conversation_id: 'conversation-codex',
      role: 'teammate',
      assistant_backend: 'codex',
      assistant_name: 'Codex',
      status: 'active',
    },
    {
      slot_id: 'hermes',
      conversation_id: 'conversation-hermes',
      role: 'teammate',
      assistant_backend: 'hermes',
      assistant_name: 'Hermes',
      status: 'failed',
    },
  ],
  created_at: 1,
  updated_at: 1,
};

function renderView(
  options: {
    dispatch?: ReturnType<typeof vi.fn>;
    onOpenMember?: ReturnType<typeof vi.fn>;
    onOpenBoard?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const dispatch = options.dispatch ?? vi.fn(async () => ({ messages: [], deliveries: [] }));
  const onOpenMember = options.onOpenMember ?? vi.fn();
  const onOpenBoard = options.onOpenBoard ?? vi.fn();
  render(
    <TeamGroupView
      team={team}
      runtimeStatus={
        new Map([
          ['leader', { status: 'ready' as const }],
          ['codex', { status: 'ready' as const }],
          ['hermes', { status: 'failed' as const, error: 'Hermes is not signed in' }],
        ])
      }
      pendingCounts={new Map([['codex', 2]])}
      colorOf={(slotId) => (slotId === 'codex' ? 'var(--color-primary-6)' : 'var(--color-text-3)')}
      onOpenMember={onOpenMember}
      onOpenBoard={onOpenBoard}
      dispatch={dispatch}
    />
  );
  return { dispatch, onOpenMember, onOpenBoard };
}

describe('TeamGroupView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Message, 'warning').mockReturnValue(() => undefined);
    vi.spyOn(Message, 'error').mockReturnValue(() => undefined);
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1280 });
  });

  it('identifies the coordinator and every local member', () => {
    renderView();

    expect(screen.getByTestId('group-member-leader')).toHaveTextContent('Claude Code');
    expect(screen.getByTestId('group-member-leader')).toHaveTextContent(/coordinator/i);
    expect(screen.getByTestId('group-member-codex')).toHaveTextContent('Codex');
    expect(screen.getByTestId('group-member-hermes')).toHaveTextContent('Hermes');
  });

  it('turns an @ choice into a structured target and removes the trigger text', async () => {
    renderView();
    const composer = screen.getByTestId('group-composer-input');

    fireEvent.change(composer, { target: { value: 'Please @' } });
    fireEvent.click(await screen.findByTestId('group-mention-codex'));

    expect(screen.getByTestId('group-target-codex')).toHaveTextContent('Codex');
    expect(composer).toHaveValue('Please');
  });

  it('sends an unmentioned instruction through the coordinator', async () => {
    const { dispatch } = renderView();
    fireEvent.change(screen.getByTestId('group-composer-input'), { target: { value: 'Prepare the report' } });
    fireEvent.click(screen.getByTestId('group-send'));

    await waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 'team-1',
        content: 'Prepare the report',
        targetMode: 'coordinator',
        targetSlotIds: ['leader'],
      })
    );
  });

  it('requires a structured target in direct mode and supports @all', async () => {
    const { dispatch } = renderView();
    fireEvent.click(screen.getByTestId('group-mode-members'));
    fireEvent.change(screen.getByTestId('group-composer-input'), { target: { value: 'Compare proposals' } });
    expect(screen.getByTestId('group-send')).toBeDisabled();

    fireEvent.change(screen.getByTestId('group-composer-input'), { target: { value: 'Compare proposals @' } });
    fireEvent.click(await screen.findByTestId('group-mention-all'));
    expect(screen.getByTestId('group-target-count')).toHaveTextContent('3');
    fireEvent.click(screen.getByTestId('group-send'));

    await waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ targetMode: 'all', targetSlotIds: ['leader', 'codex'] })
    );
  });

  it('keeps unavailable members visible and opens pending permissions in their conversation', () => {
    const { onOpenMember } = renderView();
    const unavailable = screen.getByTestId('group-member-hermes');
    expect(unavailable).toHaveAttribute('data-unavailable', 'true');
    expect(unavailable).toHaveTextContent('Hermes is not signed in');

    fireEvent.click(screen.getByTestId('group-permissions-codex'));
    expect(onOpenMember).toHaveBeenCalledWith('codex');
  });

  it('uses a drawer for activity at 390px without horizontal overflow', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 390 });
    renderView();
    fireEvent(window, new Event('resize'));

    expect(screen.queryByTestId('group-activity-desktop')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('group-activity-open'));
    const drawer = await screen.findByTestId('group-activity-drawer');
    expect(within(drawer).getByTestId('group-activity-panel')).toBeInTheDocument();

    const root = screen.getByTestId('team-group-view');
    expect(root.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
    expect(root).toHaveClass('max-w-full');
  });
});
