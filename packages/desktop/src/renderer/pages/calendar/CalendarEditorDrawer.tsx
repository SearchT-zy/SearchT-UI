import React, { useEffect, useState } from 'react';
import { Drawer, Input, Select, Switch } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type {
  CalendarEvent,
  CalendarEventCreateInput,
  CalendarEventUpdateInput,
  ReminderOffsetMinutes,
  CalendarRecurrenceRule,
} from '@/common/types/searcht/calendar';
import { addLocalDays } from '@/common/searcht/calendarDate';

type Props = {
  visible: boolean;
  date: string;
  event: CalendarEvent | null;
  saving: boolean;
  onClose(): void;
  onSubmit(input: CalendarEventCreateInput | CalendarEventUpdateInput): void;
};
const CalendarEditorDrawer: React.FC<Props> = ({ visible, date, event, saving, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [startDate, setStartDate] = useState(date);
  const [endDate, setEndDate] = useState(addLocalDays(date, 1));
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [reminder, setReminder] = useState<ReminderOffsetMinutes | null>(null);
  const [repeat, setRepeat] = useState<'none' | CalendarRecurrenceRule['frequency']>('none');
  const [interval, setIntervalValue] = useState(1);
  useEffect(() => {
    if (!visible) return;
    setTitle(event?.title ?? '');
    setAllDay(event?.allDay ?? false);
    setStartDate(event?.startLocalDate ?? date);
    setEndDate(event?.endLocalDate ?? addLocalDays(date, 1));
    setStartTime(event?.startsAt ? new Date(event.startsAt).toISOString().slice(11, 16) : '09:00');
    setEndTime(event?.endsAt ? new Date(event.endsAt).toISOString().slice(11, 16) : '10:00');
    setLocation(event?.location ?? '');
    setDescription(event?.description ?? '');
    setReminder(event?.reminderMinutes ?? null);
    setRepeat('none');
    setIntervalValue(1);
  }, [date, event, visible]);
  const submit = () => {
    const base: CalendarEventCreateInput = {
      title,
      description,
      location,
      allDay,
      startLocalDate: startDate,
      endLocalDate: endDate,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
      reminderMinutes: reminder,
      startsAt: allDay ? null : new Date(`${startDate}T${startTime}:00`).toISOString(),
      endsAt: allDay
        ? null
        : new Date(`${endDate === addLocalDays(startDate, 1) ? startDate : endDate}T${endTime}:00`).toISOString(),
      ...(repeat === 'none'
        ? {}
        : { recurrence: { rule: recurrenceRule(repeat, interval, startDate), end: { kind: 'never' } } }),
    };
    onSubmit(event ? { ...base, id: event.id } : base);
  };
  return (
    <Drawer
      title={event ? t('personal.calendar.editor.editTitle') : t('personal.calendar.editor.createTitle')}
      visible={visible}
      width={420}
      style={{ maxWidth: '100vw' }}
      onCancel={onClose}
      onOk={submit}
      okButtonProps={{ loading: saving }}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
    >
      <div className='flex flex-col gap-14px'>
        <label className='flex flex-col gap-6px text-12px text-t-secondary'>
          {t('personal.calendar.fields.title')}
          <Input value={title} onChange={setTitle} autoFocus />
        </label>
        <label className='flex flex-col gap-6px text-12px text-t-secondary'>
          {t('personal.tasks.recurrence.label')}
          <Select value={repeat} onChange={(value) => setRepeat(value as typeof repeat)}>
            <Select.Option value='none'>{t('personal.tasks.priorities.none')}</Select.Option>
            <Select.Option value='daily'>{t('personal.tasks.recurrence.daily')}</Select.Option>
            <Select.Option value='weekdays'>{t('personal.tasks.recurrence.weekdays')}</Select.Option>
            <Select.Option value='weekly'>{t('personal.tasks.recurrence.weekly')}</Select.Option>
            <Select.Option value='monthly'>{t('personal.tasks.recurrence.monthly')}</Select.Option>
          </Select>
        </label>
        {repeat !== 'none' && repeat !== 'weekdays' ? (
          <label className='flex flex-col gap-6px text-12px text-t-secondary'>
            {t('personal.tasks.recurrence.interval')}
            <Input
              type='number'
              min={1}
              max={365}
              value={String(interval)}
              onChange={(value) => setIntervalValue(Math.max(1, Number(value) || 1))}
            />
          </label>
        ) : null}
        <label className='flex items-center justify-between text-12px text-t-secondary'>
          {t('personal.calendar.fields.allDay')}
          <Switch checked={allDay} onChange={setAllDay} />
        </label>
        <div className='grid grid-cols-2 gap-10px'>
          <Input type='date' value={startDate} onChange={setStartDate} />
          <Input type='date' value={endDate} onChange={setEndDate} />
          {!allDay ? (
            <>
              <Input type='time' value={startTime} onChange={setStartTime} />
              <Input type='time' value={endTime} onChange={setEndTime} />
            </>
          ) : null}
        </div>
        <label className='flex flex-col gap-6px text-12px text-t-secondary'>
          {t('personal.calendar.fields.location')}
          <Input value={location} onChange={setLocation} />
        </label>
        <label className='flex flex-col gap-6px text-12px text-t-secondary'>
          {t('personal.calendar.fields.description')}
          <Input.TextArea value={description} onChange={setDescription} autoSize={{ minRows: 3, maxRows: 6 }} />
        </label>
        <label className='flex flex-col gap-6px text-12px text-t-secondary'>
          {t('personal.calendar.fields.reminder')}
          <Select
            value={reminder ?? 'none'}
            onChange={(value) => setReminder(value === 'none' ? null : (Number(value) as ReminderOffsetMinutes))}
          >
            <Select.Option value='none'>{t('personal.calendar.reminders.none')}</Select.Option>
            {[0, 5, 15, 30, 60, 1440].map((value) => (
              <Select.Option key={value} value={value}>
                {t(`personal.calendar.reminders.m${value}`)}
              </Select.Option>
            ))}
          </Select>
        </label>
      </div>
    </Drawer>
  );
};
export default CalendarEditorDrawer;

function recurrenceRule(
  frequency: CalendarRecurrenceRule['frequency'],
  interval: number,
  date: string
): CalendarRecurrenceRule {
  if (frequency === 'weekdays') return { frequency, interval: 1 };
  if (frequency === 'weekly') {
    const parts = date.split('-').map(Number);
    return { frequency, interval, weekdays: [new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay()] };
  }
  if (frequency === 'monthly') return { frequency, interval, dayOfMonth: Number(date.slice(8, 10)) };
  return { frequency, interval };
}
