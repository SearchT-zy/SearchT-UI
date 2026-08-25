import type { CollaborationDeliveryStatus } from '@/common/types/searcht/collaboration';
import { Button, Empty, Tag } from '@arco-design/web-react';
import { ArrowRight, Branch, Check, Clipboard, Key, LoadingFour, MessageOne } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { GroupTimelineItem } from '../groupTimelineProjector';

type Props = {
  items: GroupTimelineItem[];
  colorOf: (slotId: string | undefined) => string;
  onOpenMember: (slotId: string) => void;
  onOpenBoard: () => void;
};

const GroupTimeline: React.FC<Props> = ({ items, colorOf, onOpenMember, onOpenBoard }) => {
  const { t, i18n } = useTranslation();
  if (items.length === 0) {
    return (
      <div className='flex min-h-240px flex-1 items-center justify-center px-24px'>
        <Empty description={t('team.group.empty', { defaultValue: 'Describe a goal to start local collaboration' })} />
      </div>
    );
  }

  return (
    <div className='min-h-0 flex-1 overflow-y-auto px-16px py-12px' data-testid='group-timeline'>
      {items.map((item) => {
        const content = timelineContent(item);
        const isTask = item.kind === 'task';
        const isHandoff = item.kind === 'handoff' && 'mailboxMessage' in item;
        return (
          <div key={item.stableId} className='relative grid grid-cols-[18px_minmax(0,1fr)] gap-10px pb-18px'>
            <div className='relative flex justify-center'>
              <span
                className='relative z-1 mt-5px h-9px w-9px rounded-full border-2 border-solid border-bg-1'
                style={{ backgroundColor: colorOf(item.senderSlotId ?? undefined) }}
              />
              <span className='absolute bottom--18px top-14px w-1px bg-b-base' />
            </div>
            <div className='min-w-0'>
              <div className='flex min-w-0 items-center gap-8px'>
                <span className='truncate text-13px font-500 text-t-primary'>
                  {item.senderName ?? t('team.group.sender.you', { defaultValue: 'You' })}
                </span>
                <span className='text-11px text-t-secondary'>
                  {new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(
                    item.createdAt
                  )}
                </span>
                <span className='inline-flex text-t-secondary'>{timelineIcon(item.kind)}</span>
              </div>
              <div
                className={`mt-5px whitespace-pre-wrap break-words text-13px leading-20px text-t-primary ${
                  isTask || item.kind === 'result' ? 'rounded-6px border border-solid border-b-base bg-bg-2 p-10px' : ''
                }`}
              >
                {content}
              </div>
              {'deliveries' in item && item.deliveries.length > 0 ? (
                <div className='mt-7px flex flex-wrap gap-5px'>
                  {item.deliveries.map((delivery) => (
                    <span key={delivery.id} className='inline-flex items-center gap-4px'>
                      <Tag size='small'>
                        {delivery.targetSlotId} ·{' '}
                        {t(`team.group.delivery.${delivery.status}`, { defaultValue: delivery.status })}
                      </Tag>
                      {delivery.status === 'unknown' ? (
                        <Button
                          type='text'
                          size='mini'
                          icon={<ArrowRight size='12' />}
                          aria-label={t('team.group.action.inspect', { defaultValue: 'Inspect conversation' })}
                          onClick={() => onOpenMember(delivery.targetSlotId)}
                        />
                      ) : null}
                    </span>
                  ))}
                </div>
              ) : null}
              {isTask || isHandoff ? (
                <Button type='text' size='mini' className='mt-4px !px-0' onClick={onOpenBoard}>
                  {t('team.group.action.openBoard', { defaultValue: 'Open board' })}
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
};

function timelineContent(item: GroupTimelineItem): string {
  if (item.kind === 'task') return [item.task.subject, item.task.description].filter(Boolean).join('\n');
  if (item.kind === 'handoff' && 'mailboxMessage' in item) return item.mailboxMessage.content;
  return item.message.content;
}

function timelineIcon(kind: GroupTimelineItem['kind']): React.ReactNode {
  switch (kind) {
    case 'task':
      return <Clipboard size='13' />;
    case 'handoff':
      return <Branch size='13' />;
    case 'result':
      return <Check size='13' />;
    case 'approval':
      return <Key size='13' />;
    case 'progress':
      return <LoadingFour size='13' />;
    default:
      return <MessageOne size='13' />;
  }
}

export const deliveryStatusOrder: CollaborationDeliveryStatus[] = [
  'pending',
  'accepted',
  'running',
  'completed',
  'failed',
  'cancelled',
  'unknown',
];

export default GroupTimeline;
