import React, { useEffect, useState } from 'react';
import { Button, Drawer, Input, Tabs } from '@arco-design/web-react';
import type { InboxItem } from '@/common/types/searcht/inbox';

type Props = {
  item: InboxItem | null;
  mode: 'task' | 'calendar-event' | null;
  saving: boolean;
  labels: Record<string, string>;
  onClose(): void;
  onTask(title: string): Promise<boolean>;
  onEvent(input: { title: string; startLocalDate: string; endLocalDate: string }): Promise<boolean>;
};

const tomorrow = () => {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  return value.toISOString().slice(0, 10);
};

const InboxConversionDrawer: React.FC<Props> = ({ item, mode, saving, labels, onClose, onTask, onEvent }) => {
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState(tomorrow());
  useEffect(() => setTitle(item?.title ?? ''), [item]);
  const finish = (saved: boolean) => {
    if (saved) onClose();
  };
  return (
    <Drawer width={420} visible={mode !== null} title={labels.title} footer={null} onCancel={onClose} unmountOnExit>
      <Tabs activeTab={mode ?? 'task'}>
        <Tabs.TabPane key={mode ?? 'task'} title={mode === 'calendar-event' ? labels.event : labels.task} />
      </Tabs>
      <label className='mt-16px block text-12px text-t-secondary'>
        {labels.targetTitle}
        <Input className='mt-6px' value={title} onChange={setTitle} />
      </label>
      {mode === 'calendar-event' ? (
        <label className='mt-14px block text-12px text-t-secondary'>
          {labels.date}
          <input
            className='mt-6px box-border h-32px w-full border border-border-3 bg-bg-2 px-10px text-t-primary'
            type='date'
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </label>
      ) : null}
      <Button
        className='mt-18px w-full'
        type='primary'
        loading={saving}
        disabled={!title.trim()}
        onClick={() =>
          void (
            mode === 'calendar-event'
              ? onEvent({ title, startLocalDate: startDate, endLocalDate: nextDate(startDate) })
              : onTask(title)
          ).then(finish)
        }
      >
        {mode === 'calendar-event' ? labels.createEvent : labels.createTask}
      </Button>
    </Drawer>
  );
};

function nextDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

export default InboxConversionDrawer;
