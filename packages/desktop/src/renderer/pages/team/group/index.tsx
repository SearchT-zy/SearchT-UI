import { ipcBridge } from '@/common';
import type { TeamAgentRuntimeStatus, TTeam } from '@/common/types/team/teamTypes';
import type { CollaborationSnapshot } from '@/common/types/searcht/collaboration';
import { Button, Drawer, Message } from '@arco-design/web-react';
import { List, PeoplePlus } from '@icon-park/react';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildGroupRoute } from './groupMentionRouter';
import { createGroupDispatchController, type GroupDispatchInput } from './groupDispatchController';
import { groupClient } from './groupClient';
import { useGroupTimeline } from './useGroupTimeline';
import GroupActivityPanel from './components/GroupActivityPanel';
import GroupComposer, { type GroupComposerSubmit } from './components/GroupComposer';
import GroupInvitePanel from './components/GroupInvitePanel';
import GroupMemberStrip, { type GroupMemberRuntime } from './components/GroupMemberStrip';
import GroupTimeline from './components/GroupTimeline';

type Props = {
  team: TTeam;
  runtimeStatus?: ReadonlyMap<string, GroupMemberRuntime>;
  pendingCounts?: ReadonlyMap<string, number>;
  colorOf?: (slotId: string | undefined) => string;
  onOpenMember: (slotId: string) => void;
  onOpenBoard: () => void;
  dispatch?: (input: GroupDispatchInput) => Promise<CollaborationSnapshot>;
};

const EMPTY_RUNTIME = new Map<string, { status: TeamAgentRuntimeStatus; error?: string }>();
const EMPTY_COUNTS = new Map<string, number>();

const TeamGroupView: React.FC<Props> = ({
  team,
  runtimeStatus = EMPTY_RUNTIME,
  pendingCounts = EMPTY_COUNTS,
  colorOf = () => 'var(--color-text-3)',
  onOpenMember,
  onOpenBoard,
  dispatch,
}) => {
  const { t } = useTranslation();
  const [sending, setSending] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const narrow = useNarrowLayout();
  const groupTimeline = useGroupTimeline(team);
  const defaultController = useMemo(
    () =>
      createGroupDispatchController({
        store: groupClient,
        sendCoordinator: (input) => ipcBridge.team.sendMessage.invoke(input),
        sendMember: (input) => ipcBridge.team.sendMessageToAgent.invoke(input),
      }),
    []
  );
  const dispatchInstruction = dispatch ?? defaultController.dispatch;
  const members = team.assistants ?? team.agents ?? [];
  const composerMembers = members.map((member) => {
    const state = runtimeStatus.get(member.slot_id)?.status;
    return {
      slotId: member.slot_id,
      name: member.assistant_name,
      ready: state !== 'failed' && state !== 'pending',
      role: member.role,
    };
  });

  const handleSubmit = useCallback(
    async (input: GroupComposerSubmit): Promise<void> => {
      const route = buildGroupRoute({
        mode: input.targetMode,
        selectedSlotIds: input.selectedSlotIds,
        members: composerMembers,
      });
      if (route.targetSlotIds.length === 0) {
        Message.warning(t('team.group.error.noAvailableTarget', { defaultValue: 'No selected member is available' }));
        return;
      }
      if (route.unavailableSlotIds.length > 0) {
        Message.warning(
          t('team.group.error.someUnavailable', {
            count: route.unavailableSlotIds.length,
            defaultValue: '{{count}} unavailable members were not assigned',
          })
        );
      }
      setSending(true);
      try {
        await dispatchInstruction({
          localMessageId: crypto.randomUUID(),
          teamId: team.id,
          content: input.content,
          targetMode: route.targetMode,
          targetSlotIds: route.targetSlotIds,
          fileRefs: input.fileRefs,
        });
        await groupTimeline.revalidate();
      } catch (error) {
        Message.error(error instanceof Error ? error.message : String(error));
        throw error;
      } finally {
        setSending(false);
      }
    },
    [composerMembers, dispatchInstruction, groupTimeline, t, team.id]
  );

  const activityPanel = <GroupActivityPanel activities={groupTimeline.activities} onOpenBoard={onOpenBoard} />;

  return (
    <div
      className='grid h-full max-w-full min-w-0 grid-cols-[minmax(0,1fr)_320px] overflow-hidden bg-bg-1 max-[760px]:grid-cols-1'
      data-testid='team-group-view'
    >
      <section className='flex min-h-0 min-w-0 flex-col'>
        <div className='flex shrink-0 items-center justify-end border-b border-solid border-b-base px-12px py-4px'>
          <Button
            type='text'
            size='small'
            icon={<PeoplePlus size='15' />}
            data-testid='group-invite-open'
            onClick={() => setInviteOpen(true)}
          >
            {t('team.group.invite.open', { defaultValue: 'Invite & members' })}
          </Button>
        </div>
        <GroupMemberStrip
          members={members}
          runtimeStatus={runtimeStatus}
          pendingCounts={pendingCounts}
          onOpenMember={onOpenMember}
        />
        {narrow ? (
          <div className='flex h-40px shrink-0 items-center justify-end border-b border-solid border-b-base px-12px'>
            <Button
              type='text'
              size='small'
              icon={<List size='15' />}
              data-testid='group-activity-open'
              onClick={() => setActivityOpen(true)}
            >
              {t('team.group.activity.title', { defaultValue: 'Tasks and hand-offs' })}
            </Button>
          </div>
        ) : null}
        <GroupTimeline
          items={groupTimeline.timeline}
          colorOf={colorOf}
          onOpenMember={onOpenMember}
          onOpenBoard={onOpenBoard}
        />
        <GroupComposer members={composerMembers} sending={sending} onSubmit={handleSubmit} />
      </section>
      {!narrow ? (
        <aside className='min-h-0 border-l border-solid border-b-base' data-testid='group-activity-desktop'>
          {activityPanel}
        </aside>
      ) : null}
      <Drawer
        width='min(360px, 92vw)'
        visible={narrow && activityOpen}
        footer={null}
        title={t('team.group.activity.title', { defaultValue: 'Tasks and hand-offs' })}
        onCancel={() => setActivityOpen(false)}
        unmountOnExit
      >
        <div className='h-full' data-testid='group-activity-drawer'>
          {activityPanel}
        </div>
      </Drawer>
      <Drawer
        width='min(360px, 92vw)'
        visible={inviteOpen}
        footer={null}
        title={t('team.group.invite.title', { defaultValue: 'Invite & members' })}
        onCancel={() => setInviteOpen(false)}
        unmountOnExit
      >
        <div className='h-full overflow-y-auto' data-testid='group-invite-drawer'>
          <GroupInvitePanel teamId={team.id} onChanged={() => void groupTimeline.revalidate()} />
        </div>
      </Drawer>
    </div>
  );
};

function useNarrowLayout(): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 760);
  React.useEffect(() => {
    const update = (): void => setNarrow(window.innerWidth <= 760);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return narrow;
}

export default TeamGroupView;
