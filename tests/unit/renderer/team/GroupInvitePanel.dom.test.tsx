// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Message } from '@arco-design/web-react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollaborationInviteCode, CollaborationMember } from '@/common/types/searcht/collaboration';
import GroupInvitePanel from '@renderer/pages/team/group/components/GroupInvitePanel';

const clientMocks = vi.hoisted(() => ({
  listMembers: vi.fn(),
  createInviteCode: vi.fn(),
  listInviteCodes: vi.fn(),
  revokeInviteCode: vi.fn(),
  joinByInviteCode: vi.fn(),
  removeMember: vi.fn(),
}));

vi.mock('@renderer/pages/team/group/groupClient', () => ({
  groupClient: clientMocks,
}));

const member: CollaborationMember = {
  id: 'member-1',
  teamId: 'team-1',
  displayName: 'Alice',
  role: 'member',
  joinedVia: 'invite-code',
  joinedAt: 1_000,
};

const invite: CollaborationInviteCode = {
  id: 'invite-1',
  teamId: 'team-1',
  code: 'ZX-ABCDE-FGHIJ',
  maxUses: 10,
  useCount: 1,
  expiresAt: null,
  revokedAt: null,
  createdAt: 500,
};

function renderPanel(options: { navigate?: (path: string) => void } = {}) {
  const navigate = options.navigate ?? vi.fn();
  render(
    <MemoryRouter>
      <GroupInvitePanel teamId='team-1' onChanged={vi.fn()} navigate={navigate} />
    </MemoryRouter>
  );
  return { navigate };
}

describe('GroupInvitePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Message, 'success').mockReturnValue(() => undefined);
    vi.spyOn(Message, 'error').mockReturnValue(() => undefined);
    clientMocks.listMembers.mockResolvedValue([member]);
    clientMocks.listInviteCodes.mockResolvedValue([invite]);
  });

  it('lists joined members and active invite codes', async () => {
    renderPanel();

    expect(await screen.findByTestId('group-invite-member-member-1')).toHaveTextContent('Alice');
    expect(screen.getByTestId('group-invite-code-ZX-ABCDE-FGHIJ')).toHaveTextContent('ZX-ABCDE-FGHIJ');
    expect(screen.getByTestId('group-invite-code-ZX-ABCDE-FGHIJ')).toHaveTextContent('1/10 used');
  });

  it('creates a new invite code and reloads the list', async () => {
    renderPanel();
    await screen.findByTestId('group-invite-create');

    fireEvent.click(screen.getByTestId('group-invite-create'));

    await waitFor(() => expect(clientMocks.createInviteCode).toHaveBeenCalledWith({ teamId: 'team-1' }));
    await waitFor(() => expect(clientMocks.listInviteCodes).toHaveBeenCalledTimes(2));
  });

  it('revokes an active invite code', async () => {
    renderPanel();
    await screen.findByTestId('group-invite-revoke-ZX-ABCDE-FGHIJ');

    fireEvent.click(screen.getByTestId('group-invite-revoke-ZX-ABCDE-FGHIJ'));

    await waitFor(() => expect(clientMocks.revokeInviteCode).toHaveBeenCalledWith({ id: 'invite-1' }));
  });

  it('removes a joined member after confirmation', async () => {
    renderPanel();
    await screen.findByTestId('group-invite-member-remove-member-1');

    fireEvent.click(screen.getByTestId('group-invite-member-remove-member-1'));
    fireEvent.click(await screen.findByRole('button', { name: /^(ok|确定)$/i }));

    await waitFor(() =>
      expect(clientMocks.removeMember).toHaveBeenCalledWith({ teamId: 'team-1', memberId: 'member-1' })
    );
  });

  it('joins another group by invite code and navigates to it', async () => {
    const { navigate } = renderPanel();
    clientMocks.joinByInviteCode.mockResolvedValue({ teamId: 'team-2', member: { ...member, id: 'member-2' } });
    await screen.findByTestId('group-invite-join-submit');

    fireEvent.change(screen.getByTestId('group-invite-join-code'), { target: { value: 'ZX-12345-67890' } });
    fireEvent.change(screen.getByTestId('group-invite-join-name'), { target: { value: 'Bob' } });
    fireEvent.click(screen.getByTestId('group-invite-join-submit'));

    await waitFor(() =>
      expect(clientMocks.joinByInviteCode).toHaveBeenCalledWith({ code: 'ZX-12345-67890', displayName: 'Bob' })
    );
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/team/team-2'));
  });

  it('stays on the current group when the joined team matches', async () => {
    const { navigate } = renderPanel();
    clientMocks.joinByInviteCode.mockResolvedValue({ teamId: 'team-1', member });
    await screen.findByTestId('group-invite-join-submit');

    fireEvent.change(screen.getByTestId('group-invite-join-code'), { target: { value: 'ZX-12345-67890' } });
    fireEvent.change(screen.getByTestId('group-invite-join-name'), { target: { value: 'Bob' } });
    fireEvent.click(screen.getByTestId('group-invite-join-submit'));

    await waitFor(() => expect(clientMocks.joinByInviteCode).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
  });
});
