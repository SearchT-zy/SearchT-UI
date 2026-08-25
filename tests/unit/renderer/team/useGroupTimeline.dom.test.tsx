// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import React, { type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import type { TTeam } from '@/common/types/team/teamTypes';
import { useGroupTimeline } from '@renderer/pages/team/group/useGroupTimeline';

const mocks = vi.hoisted(() => {
  const handlers: Record<string, (event: never) => void> = {};
  const on = (name: string) =>
    vi.fn((handler: (event: never) => void) => {
      handlers[name] = handler;
      return vi.fn();
    });
  return {
    handlers,
    list: vi.fn(),
    appendEvent: vi.fn(),
    updateDeliveryByRun: vi.fn(),
    getConversationMessages: vi.fn(),
    revalidateActivity: vi.fn(),
    on,
  };
});

vi.mock('@renderer/pages/team/group/groupClient', () => ({
  groupClient: {
    list: mocks.list,
    appendEvent: mocks.appendEvent,
    updateDeliveryByRun: mocks.updateDeliveryByRun,
  },
}));

vi.mock('@renderer/pages/team/activity/useTeamActivityFeed', () => ({
  useTeamActivityFeed: () => ({
    messages: [],
    tasks: [],
    isLoading: false,
    isLoadingMore: false,
    hasMore: false,
    loadMore: vi.fn(),
    revalidate: mocks.revalidateActivity,
    error: null,
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      runAccepted: { on: mocks.on('runAccepted') },
      runStarted: { on: mocks.on('runStarted') },
      runUpdated: { on: mocks.on('runUpdated') },
      runCompleted: { on: mocks.on('runCompleted') },
      runCancelled: { on: mocks.on('runCancelled') },
      runFailed: { on: mocks.on('runFailed') },
      childTurnStarted: { on: mocks.on('childTurnStarted') },
      childTurnCompleted: { on: mocks.on('childTurnCompleted') },
      childTurnCancelled: { on: mocks.on('childTurnCancelled') },
      agentRemoved: { on: mocks.on('agentRemoved') },
      agentRenamed: { on: mocks.on('agentRenamed') },
    },
    conversation: {
      turnCompleted: { on: mocks.on('turnCompleted') },
      confirmation: { add: { on: mocks.on('confirmationAdd') } },
    },
    database: {
      getConversationMessages: { invoke: mocks.getConversationMessages },
    },
    realtime: { reconnected: { on: mocks.on('reconnected') } },
  },
}));

const team: TTeam = {
  id: 'team-1',
  user_id: 'user-1',
  name: 'Research',
  workspace: 'C:\\work',
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
      status: 'active',
    },
  ],
  created_at: 1,
  updated_at: 1,
};

function wrapper({ children }: PropsWithChildren) {
  return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>;
}

describe('useGroupTimeline', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue({ messages: [], deliveries: [] });
    mocks.appendEvent.mockImplementation(async (input) => ({ id: input.sourceEventId }));
    mocks.updateDeliveryByRun.mockResolvedValue([]);
    mocks.getConversationMessages.mockResolvedValue({
      items: [],
      oldest_cursor: null,
      newest_cursor: null,
      has_more_before: false,
      has_more_after: false,
    });
  });

  it('reconciles matching Team run events into delivery status', async () => {
    renderHook(() => useGroupTimeline(team), { wrapper });
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());

    await act(async () => {
      mocks.handlers.runStarted({ team_id: 'team-1', team_run_id: 'run-1', status: 'running' } as never);
    });
    await act(async () => {
      mocks.handlers.runFailed({ team_id: 'other-team', team_run_id: 'run-2', status: 'failed' } as never);
    });

    expect(mocks.updateDeliveryByRun).toHaveBeenCalledOnce();
    expect(mocks.updateDeliveryByRun).toHaveBeenCalledWith({
      teamId: 'team-1',
      teamRunId: 'run-1',
      status: 'running',
    });
  });

  it('stores textual results and approvals only for member conversations', async () => {
    renderHook(() => useGroupTimeline(team), { wrapper });
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());

    await act(async () => {
      mocks.handlers.turnCompleted({
        session_id: 'conversation-codex',
        turn_id: 'turn-1',
        last_message: { content: 'Analysis complete', created_at: 2_000 },
      } as never);
      mocks.handlers.turnCompleted({
        session_id: 'outside-conversation',
        turn_id: 'turn-2',
        last_message: { content: 'Ignore me', created_at: 3_000 },
      } as never);
      mocks.handlers.confirmationAdd({
        conversation_id: 'conversation-codex',
        id: 'confirmation-1',
        call_id: 'call-1',
        description: 'Allow command execution',
        options: [],
      } as never);
    });

    expect(mocks.appendEvent).toHaveBeenCalledTimes(2);
    expect(mocks.appendEvent).toHaveBeenCalledWith({
      teamId: 'team-1',
      sourceEventId: 'conversation-turn:conversation-codex:turn-1',
      senderKind: 'agent',
      senderSlotId: 'codex',
      kind: 'result',
      content: 'Analysis complete',
      conversationId: 'conversation-codex',
      createdAt: 2_000,
    });
    expect(mocks.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceEventId: 'confirmation:conversation-codex:call-1',
        kind: 'approval',
        content: 'Allow command execution',
      })
    );
  });

  it('recovers a Hermes result from persisted history when turn.completed has no last message', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    mocks.getConversationMessages.mockResolvedValue({
      items: [
        {
          id: 'hermes-result',
          conversation_id: 'conversation-hermes',
          type: 'text',
          content: { content: 'Hermes completed the research' },
          position: 'left',
          status: 'finish',
          hidden: false,
          created_at: 1_100,
        },
      ],
      oldest_cursor: 'hermes-result',
      newest_cursor: 'hermes-result',
      has_more_before: false,
      has_more_after: false,
    });
    renderHook(() => useGroupTimeline(team), { wrapper });
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());

    await act(async () => {
      mocks.handlers.childTurnStarted({
        team_id: 'team-1',
        team_run_id: 'run-hermes',
        slot_id: 'hermes',
        conversation_id: 'conversation-hermes',
        turn_id: 'turn-hermes',
        status: 'running',
      } as never);
      mocks.handlers.turnCompleted({
        session_id: 'conversation-hermes',
        turn_id: 'turn-hermes',
        last_message: { content: null, created_at: 1_100 },
      } as never);
      mocks.handlers.childTurnCompleted({
        team_id: 'team-1',
        team_run_id: 'run-hermes',
        slot_id: 'hermes',
        conversation_id: 'conversation-hermes',
        turn_id: 'turn-hermes',
        status: 'completed',
      } as never);
    });

    await waitFor(() =>
      expect(mocks.appendEvent).toHaveBeenCalledWith({
        teamId: 'team-1',
        sourceEventId: 'conversation-turn:conversation-hermes:turn-hermes',
        senderKind: 'agent',
        senderSlotId: 'hermes',
        kind: 'result',
        content: 'Hermes completed the research',
        conversationId: 'conversation-hermes',
        createdAt: 1_100,
      })
    );
    expect(mocks.getConversationMessages).toHaveBeenCalledWith({
      conversation_id: 'conversation-hermes',
      limit: 50,
      content_mode: 'full',
    });
  });

  it('does not recover an older Hermes answer for an empty completed turn', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000);
    mocks.getConversationMessages.mockResolvedValue({
      items: [
        {
          id: 'old-result',
          conversation_id: 'conversation-hermes',
          type: 'text',
          content: { content: 'Previous answer' },
          position: 'left',
          status: 'finish',
          hidden: false,
          created_at: 1_500,
        },
      ],
      oldest_cursor: 'old-result',
      newest_cursor: 'old-result',
      has_more_before: false,
      has_more_after: false,
    });
    renderHook(() => useGroupTimeline(team), { wrapper });
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());

    await act(async () => {
      mocks.handlers.childTurnStarted({
        team_id: 'team-1',
        team_run_id: 'run-hermes',
        slot_id: 'hermes',
        conversation_id: 'conversation-hermes',
        turn_id: 'turn-empty',
        status: 'running',
      } as never);
      mocks.handlers.childTurnCompleted({
        team_id: 'team-1',
        team_run_id: 'run-hermes',
        slot_id: 'hermes',
        conversation_id: 'conversation-hermes',
        turn_id: 'turn-empty',
        status: 'completed',
      } as never);
    });

    await waitFor(() => expect(mocks.getConversationMessages).toHaveBeenCalledOnce());
    expect(mocks.appendEvent).not.toHaveBeenCalled();
  });

  it('writes one result when native and child-turn completion events overlap', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(3_000);
    renderHook(() => useGroupTimeline(team), { wrapper });
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());

    await act(async () => {
      mocks.handlers.childTurnStarted({
        team_id: 'team-1',
        team_run_id: 'run-hermes',
        slot_id: 'hermes',
        conversation_id: 'conversation-hermes',
        turn_id: 'turn-overlap',
        status: 'running',
      } as never);
      mocks.handlers.turnCompleted({
        session_id: 'conversation-hermes',
        turn_id: 'turn-overlap',
        last_message: { content: 'Native result', created_at: 3_100 },
      } as never);
      mocks.handlers.childTurnCompleted({
        team_id: 'team-1',
        team_run_id: 'run-hermes',
        slot_id: 'hermes',
        conversation_id: 'conversation-hermes',
        turn_id: 'turn-overlap',
        status: 'completed',
      } as never);
    });

    await waitFor(() => expect(mocks.appendEvent).toHaveBeenCalledOnce());
    expect(mocks.getConversationMessages).not.toHaveBeenCalled();
  });

  it('refreshes both stores after reconnect and matching membership changes', async () => {
    renderHook(() => useGroupTimeline(team), { wrapper });
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));

    await act(async () => {
      mocks.handlers.agentRenamed({ team_id: 'team-1', slot_id: 'codex', name: 'Codex 2' } as never);
    });
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(mocks.revalidateActivity).toHaveBeenCalledOnce();

    await act(async () => {
      mocks.handlers.reconnected(undefined as never);
    });
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(3));
    expect(mocks.revalidateActivity).toHaveBeenCalledTimes(2);
  });
});
