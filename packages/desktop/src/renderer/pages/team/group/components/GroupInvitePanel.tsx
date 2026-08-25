import type { CollaborationInviteCode, CollaborationMember } from '@/common/types/searcht/collaboration';
import { useNavigate } from 'react-router-dom';
import { Button, Empty, Input, Message, Popconfirm, Spin, Tag } from '@arco-design/web-react';
import { Copy, Delete, PeoplePlus } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { groupClient } from '../groupClient';

type Props = {
  teamId: string;
  onChanged?: () => void;
  navigate?: (path: string) => void;
};

type InviteStatus = 'active' | 'revoked' | 'expired' | 'exhausted';

function inviteStatus(invite: CollaborationInviteCode, now: number): InviteStatus {
  if (invite.revokedAt !== null) return 'revoked';
  if (invite.expiresAt !== null && now > invite.expiresAt) return 'expired';
  if (invite.useCount >= invite.maxUses) return 'exhausted';
  return 'active';
}

const GroupInvitePanel: React.FC<Props> = ({ teamId, onChanged, navigate }) => {
  const { t, i18n } = useTranslation();
  const routerNavigate = useNavigate();
  const goTo = navigate ?? ((path: string) => routerNavigate(path));
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<CollaborationMember[]>([]);
  const [invites, setInvites] = useState<CollaborationInviteCode[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [joinName, setJoinName] = useState('');
  const [joining, setJoining] = useState(false);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [nextMembers, nextInvites] = await Promise.all([
        groupClient.listMembers(teamId),
        groupClient.listInviteCodes(teamId),
      ]);
      setMembers(nextMembers);
      setInvites(nextInvites);
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleCreateInvite = useCallback(async () => {
    setCreating(true);
    try {
      await groupClient.createInviteCode({ teamId });
      await reload();
      onChanged?.();
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  }, [onChanged, reload, teamId]);

  const handleRevoke = useCallback(
    async (invite: CollaborationInviteCode) => {
      try {
        await groupClient.revokeInviteCode({ id: invite.id });
        await reload();
      } catch (error) {
        Message.error(error instanceof Error ? error.message : String(error));
      }
    },
    [reload]
  );

  const handleCopy = useCallback(
    async (invite: CollaborationInviteCode) => {
      try {
        await navigator.clipboard.writeText(invite.code);
        Message.success(t('team.group.invite.copied', { defaultValue: 'Invite code copied' }));
      } catch {
        Message.error(t('team.group.invite.copyFailed', { defaultValue: 'Copy failed' }));
      }
    },
    [t]
  );

  const handleRemoveMember = useCallback(
    async (member: CollaborationMember) => {
      try {
        await groupClient.removeMember({ teamId, memberId: member.id });
        await reload();
        onChanged?.();
      } catch (error) {
        Message.error(error instanceof Error ? error.message : String(error));
      }
    },
    [onChanged, reload, teamId]
  );

  const handleJoin = useCallback(async () => {
    setJoining(true);
    try {
      const result = await groupClient.joinByInviteCode({ code: joinCode, displayName: joinName });
      Message.success(
        t('team.group.invite.joinSuccess', { defaultValue: 'Joined the group', name: result.member.displayName })
      );
      setJoinCode('');
      setJoinName('');
      onChanged?.();
      if (result.teamId !== teamId) goTo(`/team/${result.teamId}`);
      await reload();
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setJoining(false);
    }
  }, [goTo, joinCode, joinName, onChanged, reload, teamId]);

  if (loading) {
    return (
      <div className='flex items-center justify-center py-24px'>
        <Spin />
      </div>
    );
  }

  const now = Date.now();
  const dateFormatter = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });

  return (
    <div className='flex flex-col gap-16px px-16px py-16px' data-testid='group-invite-panel'>
      <section data-testid='group-invite-members'>
        <div className='mb-8px flex items-center justify-between'>
          <span className='text-13px font-500 text-t-primary'>
            {t('team.group.invite.members', { defaultValue: 'Human members' })}
          </span>
        </div>
        {members.length === 0 ? (
          <Empty description={t('team.group.invite.noMembers', { defaultValue: 'No joined members yet' })} />
        ) : (
          <div className='flex flex-col gap-6px'>
            {members.map((member) => (
              <div
                key={member.id}
                data-testid={`group-invite-member-${member.id}`}
                className='flex items-center justify-between gap-8px rounded-6px border border-solid border-b-base bg-bg-2 px-10px py-6px'
              >
                <div className='min-w-0'>
                  <div className='truncate text-13px text-t-primary'>{member.displayName}</div>
                  <div className='text-11px text-t-secondary'>
                    {t('team.group.invite.joinedAt', { defaultValue: 'Joined' })}{' '}
                    {dateFormatter.format(member.joinedAt)}
                  </div>
                </div>
                <Tag size='small'>{member.role}</Tag>
                {member.role !== 'owner' ? (
                  <Popconfirm
                    title={t('team.group.invite.removeConfirm', { defaultValue: 'Remove this member?' })}
                    onOk={() => handleRemoveMember(member)}
                  >
                    <Button
                      type='text'
                      size='mini'
                      icon={<Delete size='14' />}
                      data-testid={`group-invite-member-remove-${member.id}`}
                      aria-label={t('team.group.invite.remove', { defaultValue: 'Remove member' })}
                    />
                  </Popconfirm>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section data-testid='group-invite-codes'>
        <div className='mb-8px flex items-center justify-between'>
          <span className='text-13px font-500 text-t-primary'>
            {t('team.group.invite.codes', { defaultValue: 'Invite codes' })}
          </span>
          <Button
            size='small'
            type='primary'
            loading={creating}
            icon={<PeoplePlus size='14' />}
            data-testid='group-invite-create'
            onClick={handleCreateInvite}
          >
            {t('team.group.invite.create', { defaultValue: 'New invite code' })}
          </Button>
        </div>
        {invites.length === 0 ? (
          <Empty description={t('team.group.invite.noCodes', { defaultValue: 'No invite codes yet' })} />
        ) : (
          <div className='flex flex-col gap-6px'>
            {invites.map((invite) => (
              <div
                key={invite.id}
                data-testid={`group-invite-code-${invite.code}`}
                className='flex items-center justify-between gap-8px rounded-6px border border-solid border-b-base bg-bg-2 px-10px py-6px'
              >
                <div className='min-w-0'>
                  <button
                    type='button'
                    className='cursor-pointer truncate border-0 bg-transparent p-0 font-mono text-13px text-t-primary'
                    title={t('team.group.invite.copy', { defaultValue: 'Copy code' })}
                    onClick={() => handleCopy(invite)}
                  >
                    {invite.code}
                  </button>
                  <div className='text-11px text-t-secondary'>
                    {invite.useCount}/{invite.maxUses} {t('team.group.invite.used', { defaultValue: 'used' })}
                    {invite.expiresAt !== null ? ` · ${dateFormatter.format(invite.expiresAt)}` : ''}
                  </div>
                </div>
                <div className='flex shrink-0 items-center gap-4px'>
                  <Tag size='small' color={inviteStatus(invite, now) === 'active' ? 'green' : 'gray'}>
                    {t(`team.group.invite.status.${inviteStatus(invite, now)}`, {
                      defaultValue: inviteStatus(invite, now),
                    })}
                  </Tag>
                  <Button
                    type='text'
                    size='mini'
                    icon={<Copy size='14' />}
                    aria-label={t('team.group.invite.copy', { defaultValue: 'Copy code' })}
                    data-testid={`group-invite-copy-${invite.code}`}
                    onClick={() => handleCopy(invite)}
                  />
                  {inviteStatus(invite, now) === 'active' ? (
                    <Button
                      type='text'
                      size='mini'
                      status='danger'
                      aria-label={t('team.group.invite.revoke', { defaultValue: 'Revoke invite code' })}
                      data-testid={`group-invite-revoke-${invite.code}`}
                      onClick={() => handleRevoke(invite)}
                    />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section data-testid='group-invite-join'>
        <div className='mb-8px text-13px font-500 text-t-primary'>
          {t('team.group.invite.joinTitle', { defaultValue: 'Join a group with an invite code' })}
        </div>
        <div className='flex flex-col gap-8px'>
          <Input
            placeholder={t('team.group.invite.joinCodePlaceholder', { defaultValue: 'Invite code (ZX-XXXXX-XXXXX)' })}
            value={joinCode}
            data-testid='group-invite-join-code'
            onChange={setJoinCode}
          />
          <Input
            placeholder={t('team.group.invite.joinNamePlaceholder', { defaultValue: 'Your display name' })}
            value={joinName}
            maxLength={32}
            data-testid='group-invite-join-name'
            onChange={setJoinName}
          />
          <Button
            type='primary'
            long
            loading={joining}
            disabled={!joinCode.trim() || !joinName.trim()}
            data-testid='group-invite-join-submit'
            onClick={handleJoin}
          >
            {t('team.group.invite.join', { defaultValue: 'Join group' })}
          </Button>
        </div>
      </section>
    </div>
  );
};

export default GroupInvitePanel;
