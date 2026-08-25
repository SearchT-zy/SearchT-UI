import React, { useEffect, useState } from 'react';
import { Drawer, Input, Select } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { ScheduleBlockCreateInput } from '@/common/types/searcht/calendar';
import type { Task } from '@/common/types/searcht/tasks';
import { taskClient } from '../personal/taskClient';

type Props = {
  visible: boolean;
  date: string;
  saving: boolean;
  onClose(): void;
  onSubmit(input: ScheduleBlockCreateInput): void;
};
const ScheduleBlockDrawer: React.FC<Props> = ({ visible, date, saving, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const [taskId, setTaskId] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const [tasks, setTasks] = useState<Task[]>([]);
  useEffect(() => {
    if (visible) {
      setTaskId('');
      setStart('09:00');
      setEnd('10:00');
      void taskClient.list({ view: 'all', todayLocalDate: date }).then(setTasks);
    }
  }, [visible]);
  return (
    <Drawer
      title={t('personal.calendar.createBlock')}
      visible={visible}
      width={420}
      style={{ maxWidth: '100vw' }}
      onCancel={onClose}
      onOk={() =>
        onSubmit({
          taskId,
          startsAt: new Date(`${date}T${start}:00`).toISOString(),
          endsAt: new Date(`${date}T${end}:00`).toISOString(),
          localDate: date,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
        })
      }
      okButtonProps={{ loading: saving }}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
    >
      <div className='flex flex-col gap-14px'>
        <label className='flex flex-col gap-6px text-12px text-t-secondary'>
          {t('personal.tasks.title')}
          <Select
            value={taskId || undefined}
            onChange={setTaskId}
            placeholder={t('personal.tasks.fields.titlePlaceholder')}
          >
            {tasks.map((task) => (
              <Select.Option key={task.id} value={task.id}>
                {task.title}
              </Select.Option>
            ))}
          </Select>
        </label>
        <div className='grid grid-cols-2 gap-10px'>
          <Input type='time' value={start} onChange={setStart} />
          <Input type='time' value={end} onChange={setEnd} />
        </div>
      </div>
    </Drawer>
  );
};
export default ScheduleBlockDrawer;
