import React from 'react';
import { Button, Empty } from '@arco-design/web-react';
import { Delete, Edit } from '@icon-park/react';
import type { CalendarEvent, ScheduleBlock } from '@/common/types/searcht/calendar';

type Props = {
  events: CalendarEvent[];
  blocks: ScheduleBlock[];
  empty: string;
  editLabel: string;
  deleteLabel: string;
  trash?: boolean;
  onEdit(event: CalendarEvent): void;
  onRemove(event: CalendarEvent): void;
  onRestore?(event: CalendarEvent): void;
  onDestroy?(event: CalendarEvent): void;
};
const CalendarDayList: React.FC<Props> = ({
  events,
  blocks,
  empty,
  editLabel,
  deleteLabel,
  trash,
  onEdit,
  onRemove,
  onRestore,
  onDestroy,
}) =>
  events.length === 0 && blocks.length === 0 ? (
    <Empty className='py-36px' description={empty} />
  ) : (
    <div className='flex flex-col gap-8px'>
      {events.map((event) => (
        <div
          key={event.id}
          className='group flex items-start gap-10px rounded-6px border border-border-2 bg-bg-2 p-10px'
        >
          <div className='mt-2px h-28px w-3px shrink-0 rounded-2px bg-link' />
          <div className='min-w-0 flex-1'>
            <div className='truncate text-13px font-500'>{event.title}</div>
            <div className='mt-2px text-11px text-t-secondary'>
              {event.allDay
                ? 'All day'
                : event.startsAt
                  ? new Date(event.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : ''}
            </div>
          </div>
          {trash ? (
            <>
              <Button type='text' size='mini' onClick={() => onRestore?.(event)}>
                {editLabel}
              </Button>
              <Button type='text' status='danger' size='mini' onClick={() => onDestroy?.(event)}>
                {deleteLabel}
              </Button>
            </>
          ) : (
            <>
              <Button
                type='text'
                shape='circle'
                size='mini'
                aria-label={editLabel}
                icon={<Edit size='14' />}
                onClick={() => onEdit(event)}
              />
              <Button
                type='text'
                status='danger'
                shape='circle'
                size='mini'
                aria-label={deleteLabel}
                icon={<Delete size='14' />}
                onClick={() => onRemove(event)}
              />
            </>
          )}
        </div>
      ))}
      {blocks.map((block) => (
        <div
          key={block.id}
          className='rounded-6px border border-dashed border-border-2 px-10px py-8px text-12px text-t-secondary'
        >
          {new Date(block.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {block.taskId}
        </div>
      ))}
    </div>
  );
export default CalendarDayList;
