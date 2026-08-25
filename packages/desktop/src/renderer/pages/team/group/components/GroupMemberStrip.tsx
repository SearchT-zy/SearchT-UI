import type { TeamAssistant, TeamAgentRuntimeStatus } from '@/common/types/team/teamTypes';
import { Badge, Button } from '@arco-design/web-react';
import { CheckOne, Caution, Key } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import AgentStatusBadge from '../../components/AgentStatusBadge';
import TeamAgentIdentity from '../../components/TeamAgentIdentity';

export type GroupMemberRuntime = {
  status: TeamAgentRuntimeStatus;
  error?: string;
};

type Props = {
  members: TeamAssistant[];
  runtimeStatus: ReadonlyMap<string, GroupMemberRuntime>;
  pendingCounts: ReadonlyMap<string, number>;
  onOpenMember: (slotId: string) => void;
};

const GroupMemberStrip: React.FC<Props> = ({ members, runtimeStatus, pendingCounts, onOpenMember }) => {
  const { t } = useTranslation();

  return (
    <div className='flex min-w-0 gap-8px overflow-x-auto px-16px py-10px border-b border-solid border-b-base'>
      {members.map((member) => {
        const runtime = runtimeStatus.get(member.slot_id);
        const unavailable = runtime?.status === 'failed' || runtime?.status === 'pending';
        const pending = pendingCounts.get(member.slot_id) ?? 0;
        return (
          <div
            key={member.slot_id}
            data-testid={`group-member-${member.slot_id}`}
            data-unavailable={unavailable ? 'true' : 'false'}
            className='flex w-220px shrink-0 items-center gap-6px rounded-6px border border-solid border-b-base bg-bg-2 p-6px'
          >
            <Button
              type='text'
              className='min-w-0 flex-1 !h-auto !px-4px !py-4px text-left'
              onClick={() => onOpenMember(member.slot_id)}
            >
              <div className='min-w-0'>
                <TeamAgentIdentity
                  assistant_name={member.assistant_name}
                  assistant_backend={member.assistant_backend}
                  conversation_id={member.conversation_id}
                  icon={member.icon}
                  isLeader={member.role === 'leader'}
                  nameClassName='text-13px text-t-primary'
                  avatarOverlay={<AgentStatusBadge status={member.status} />}
                />
                <div className='mt-4px flex min-w-0 items-center gap-4px text-11px text-t-secondary'>
                  {unavailable ? <Caution size='12' /> : <CheckOne size='12' />}
                  <span className='truncate'>
                    {runtime?.error ||
                      (member.role === 'leader'
                        ? t('team.group.member.coordinator', { defaultValue: 'Coordinator' })
                        : t(`team.group.runtime.${runtime?.status ?? 'ready'}`, {
                            defaultValue: runtime?.status ?? 'Ready',
                          }))}
                  </span>
                </div>
              </div>
            </Button>
            {pending > 0 ? (
              <Badge count={pending} maxCount={99}>
                <Button
                  type='text'
                  shape='circle'
                  size='mini'
                  icon={<Key size='14' />}
                  data-testid={`group-permissions-${member.slot_id}`}
                  aria-label={t('team.group.member.permissions', {
                    count: pending,
                    defaultValue: '{{count}} permissions need attention',
                  })}
                  onClick={() => onOpenMember(member.slot_id)}
                />
              </Badge>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

export default GroupMemberStrip;
