// @vitest-environment jsdom
import React, { type PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import type { TTeam } from '@/common/types/team/teamTypes';
import { useTeamList } from '@renderer/pages/team/hooks/useTeamList';

const mocks = vi.hoisted(() => {
  const handlers: Record<string, (event: never) => void> = {};
  const on = (name: string) =>
    vi.fn((handler: (event: never) => void) => {
      handlers[name] = handler;
      return vi.fn();
    });
  return {
    handlers,
    on,
    list: vi.fn(),
    removeCore: vi.fn(),
    removeCollaboration: vi.fn(),
    cleanup: vi.fn(),
  };
});

vi.mock('@renderer/hooks/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@renderer/pages/team/group/groupClient', () => ({
  groupClient: { removeTeam: mocks.removeCollaboration },
}));
vi.mock('@renderer/pages/team/utils/removeTeamAssistantWithCronCleanup', () => ({
  removeTeamWithCronCleanup: mocks.cleanup,
}));
vi.mock('@renderer/pages/team/utils/teamStorage', () => ({ pruneOrphanTeamStorage: vi.fn() }));
vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      list: { invoke: mocks.list },
      remove: { invoke: mocks.removeCore },
      listChanged: { on: mocks.on('listChanged') },
      created: { on: mocks.on('created') },
      removed: { on: mocks.on('removed') },
      renamed: { on: mocks.on('renamed') },
    },
    cron: { removeJob: { invoke: vi.fn() } },
  },
}));

const team: TTeam = {
  id: 'team-1',
  user_id: 'user-1',
  name: 'Group',
  workspace: '',
  workspace_mode: 'shared',
  leader_assistant_id: 'assistant-1',
  assistants: [],
  created_at: 1,
  updated_at: 1,
};

function wrapper({ children }: PropsWithChildren) {
  return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>;
}

describe('useTeamList collaboration cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([team]);
    mocks.removeCore.mockResolvedValue(undefined);
    mocks.removeCollaboration.mockResolvedValue(undefined);
    mocks.cleanup.mockImplementation(async ({ team: value, removeTeam }) => removeTeam({ id: value.id }));
  });

  it('removes local collaboration only after authoritative Team deletion succeeds', async () => {
    const order: string[] = [];
    mocks.removeCore.mockImplementation(async () => {
      order.push('core');
    });
    mocks.removeCollaboration.mockImplementation(async () => {
      order.push('collaboration');
    });
    const { result } = renderHook(useTeamList, { wrapper });
    await waitFor(() => expect(result.current.teams).toHaveLength(1));

    await act(() => result.current.removeTeam('team-1'));

    expect(order).toEqual(['core', 'collaboration']);
    expect(mocks.removeCollaboration).toHaveBeenCalledWith('team-1');
  });

  it('does not report Team deletion failure when local cleanup fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.removeCollaboration.mockRejectedValue(new Error('indexed db unavailable'));
    const { result } = renderHook(useTeamList, { wrapper });
    await waitFor(() => expect(result.current.teams).toHaveLength(1));

    await expect(act(() => result.current.removeTeam('team-1'))).resolves.toBeUndefined();
    expect(mocks.removeCore).toHaveBeenCalledWith({ id: 'team-1' });
    expect(warn).toHaveBeenCalledWith(
      '[Renderer:teamList] collaboration_cleanup_failed',
      expect.objectContaining({ teamId: 'team-1' })
    );
  });

  it('cleans local collaboration for authoritative remote deletion events', async () => {
    renderHook(useTeamList, { wrapper });
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());

    await act(async () => {
      mocks.handlers.removed({ team_id: 'team-remote' } as never);
    });

    expect(mocks.removeCollaboration).toHaveBeenCalledWith('team-remote');
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  });
});
