import React, { useMemo } from 'react';
import { Button } from '@arco-design/web-react';
import { buildMonthCells } from './calendarViewModel';
import type { CalendarEvent } from '@/common/types/searcht/calendar';

type Props = {
  month: string;
  today: string;
  selected: string;
  events: CalendarEvent[];
  weekdays: string[];
  onSelect(date: string): void;
};

const CalendarMonth: React.FC<Props> = ({ month, today, selected, events, weekdays, onSelect }) => {
  const cells = useMemo(() => buildMonthCells(month, today), [month, today]);
  return (
    <div role='grid' className='grid grid-cols-7 overflow-hidden rounded-6px border border-border-2 bg-bg-2'>
      {weekdays.map((day) => (
        <div
          key={day}
          role='columnheader'
          className='border-b border-border-2 py-8px text-center text-11px text-t-secondary'
        >
          {day}
        </div>
      ))}
      {cells.map((cell) => {
        const count = events.filter(
          (event) => event.startLocalDate <= cell.localDate && event.endLocalDate > cell.localDate
        ).length;
        return (
          <div
            key={cell.localDate}
            role='gridcell'
            aria-label={cell.localDate}
            className='min-w-0 border-b border-r border-border-2 p-4px last:border-r-0'
          >
            <Button
              type={selected === cell.localDate ? 'primary' : 'text'}
              shape='circle'
              size='mini'
              className={`${!cell.inMonth ? 'opacity-45' : ''} ${cell.isToday && selected !== cell.localDate ? 'font-700 text-link' : ''}`}
              onClick={() => onSelect(cell.localDate)}
            >
              {cell.day}
            </Button>
            <div className='mt-3px h-8px text-center text-9px leading-8px text-t-secondary'>
              {count > 0 ? `${count}` : ''}
            </div>
          </div>
        );
      })}
    </div>
  );
};
export default CalendarMonth;
