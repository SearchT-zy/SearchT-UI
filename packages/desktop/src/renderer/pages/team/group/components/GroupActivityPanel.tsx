import type { ITeamActivityItem } from '@/common/types/team/teamTypes';
import { Button, Empty, Tag } from '@arco-design/web-react';
import { ArrowRight, Branch, Clipboard, Down, Up } from '@icon-park/react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  activities: ITeamActivityItem[];
  onOpenBoard: () => void;
};

const TERMINAL_TASK_STATES = new Set(['completed', 'deleted', 'cancelled', 'failed']);

const GroupActivityPanel: React.FC<Props> = ({ activities, onOpenBoard }) => {
  const { t } = useTranslation();
  const [showTerminal, setShowTerminal] = useState(false);
  const visible = useMemo(
    () =>
      activities
        .filter((item) => item.kind === 'message' || showTerminal || !TERMINAL_TASK_STATES.has(item.task.status))
        .toSorted((left, right) => right.created_at - left.created_at || left.id.localeCompare(right.id)),
    [activities, showTerminal]
  );
  const terminalCount = activities.filter(
    (item) => item.kind === 'task' && TERMINAL_TASK_STATES.has(item.task.status)
  ).length;

  return (
    <div className='flex h-full min-h-0 flex-col' data-testid='group-activity-panel'>
      <div className='flex h-44px shrink-0 items-center justify-between border-b border-solid border-b-base px-12px'>
        <span className='text-13px font-500 text-t-primary'>
          {t('team.group.activity.title', { defaultValue: 'Tasks and hand-offs' })}
        </span>
        <Button
          type='text'
          size='mini'
          icon={<ArrowRight size='13' />}
          aria-label={t('team.group.action.openBoard', { defaultValue: 'Open board' })}
          onClick={onOpenBoard}
        />
      </div>
      {terminalCount > 0 ? (
        <Button
          type='text'
          size='small'
          className='!mx-8px !mt-6px !justify-start'
          icon={showTerminal ? <Up size='13' /> : <Down size='13' />}
          onClick={() => setShowTerminal((value) => !value)}
        >
          {t('team.group.activity.completedCount', {
            count: terminalCount,
            defaultValue: '{{count}} completed',
          })}
        </Button>
      ) : null}
      <div className='min-h-0 flex-1 overflow-y-auto px-10px py-8px'>
        {visible.length === 0 ? (
          <Empty description={t('team.group.activity.empty', { defaultValue: 'No tasks or hand-offs yet' })} />
        ) : (
          visible.map((item) => (
            <Button
              key={`${item.kind}:${item.id}`}
              type='text'
              long
              className='!mb-4px !h-auto !justify-start !px-8px !py-8px text-left'
              onClick={onOpenBoard}
            >
              <span className='flex min-w-0 items-start gap-8px'>
                <span className='mt-2px shrink-0 text-t-secondary'>
                  {item.kind === 'task' ? <Clipboard size='14' /> : <Branch size='14' />}
                </span>
                <span className='min-w-0 flex-1'>
                  <span className='block truncate text-12px text-t-primary'>
                    {item.kind === 'task' ? item.task.subject : item.message.summary || item.message.content}
                  </span>
                  {item.kind === 'task' ? <Tag size='small'>{item.task.status}</Tag> : null}
                </span>
              </span>
            </Button>
          ))
        )}
      </div>
    </div>
  );
};

export default GroupActivityPanel;
