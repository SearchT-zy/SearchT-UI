import React from 'react';
import { Checkbox, Input, InputNumber, Select } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { TaskCreateInput, TaskRecurrenceEnd, TaskRecurrenceRule } from '@/common/types/searcht/tasks';

type Recurrence = NonNullable<TaskCreateInput['recurrence']>;

type Props = {
  value: Recurrence | null;
  onChange: (value: Recurrence | null) => void;
};

const defaultRecurrence: Recurrence = {
  rule: { frequency: 'daily', interval: 1 },
  end: { kind: 'never' },
  timezone: 'Asia/Shanghai',
};

const RecurrenceEditor: React.FC<Props> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const updateRule = (rule: TaskRecurrenceRule) => onChange({ ...(value ?? defaultRecurrence), rule });
  const updateEnd = (end: TaskRecurrenceEnd) => onChange({ ...(value ?? defaultRecurrence), end });
  const frequency = value?.rule.frequency ?? 'daily';
  const weekdays = [
    { value: 1, label: t('personal.tasks.recurrence.weekdaysShort.monday') },
    { value: 2, label: t('personal.tasks.recurrence.weekdaysShort.tuesday') },
    { value: 3, label: t('personal.tasks.recurrence.weekdaysShort.wednesday') },
    { value: 4, label: t('personal.tasks.recurrence.weekdaysShort.thursday') },
    { value: 5, label: t('personal.tasks.recurrence.weekdaysShort.friday') },
    { value: 6, label: t('personal.tasks.recurrence.weekdaysShort.saturday') },
    { value: 0, label: t('personal.tasks.recurrence.weekdaysShort.sunday') },
  ];
  return (
    <section className='border-t border-border-2 pt-16px'>
      <Checkbox
        aria-label={t('personal.tasks.recurrence.label')}
        checked={value !== null}
        onChange={(checked) => onChange(checked ? defaultRecurrence : null)}
      >
        {t('personal.tasks.recurrence.label')}
      </Checkbox>
      {value ? (
        <div className='mt-12px grid grid-cols-1 gap-12px sm:grid-cols-2'>
          <div className='flex flex-col gap-6px text-12px text-t-secondary'>
            <span>{t('personal.tasks.recurrence.frequency')}</span>
            <Select
              aria-label={t('personal.tasks.recurrence.frequency')}
              value={frequency}
              onChange={(next) => {
                if (next === 'weekdays') updateRule({ frequency: 'weekdays', interval: 1 });
                else if (next === 'weekly') updateRule({ frequency: 'weekly', interval: 1, weekdays: [1] });
                else if (next === 'monthly') updateRule({ frequency: 'monthly', interval: 1, dayOfMonth: 1 });
                else updateRule({ frequency: 'daily', interval: 1 });
              }}
            >
              <Select.Option value='daily'>{t('personal.tasks.recurrence.daily')}</Select.Option>
              <Select.Option value='weekdays'>{t('personal.tasks.recurrence.weekdays')}</Select.Option>
              <Select.Option value='weekly'>{t('personal.tasks.recurrence.weekly')}</Select.Option>
              <Select.Option value='monthly'>{t('personal.tasks.recurrence.monthly')}</Select.Option>
            </Select>
          </div>
          {frequency !== 'weekdays' ? (
            <div className='flex flex-col gap-6px text-12px text-t-secondary'>
              <span>{t('personal.tasks.recurrence.interval')}</span>
              <InputNumber
                aria-label={t('personal.tasks.recurrence.interval')}
                min={1}
                max={365}
                value={'interval' in value.rule ? value.rule.interval : 1}
                onChange={(interval) =>
                  updateRule({ ...value.rule, interval: Number(interval) || 1 } as TaskRecurrenceRule)
                }
              />
            </div>
          ) : null}
          {value.rule.frequency === 'weekly' ? (
            <div className='sm:col-span-2'>
              <div className='mb-6px text-12px text-t-secondary'>{t('personal.tasks.recurrence.weekday')}</div>
              <Checkbox.Group
                value={value.rule.weekdays}
                options={weekdays}
                onChange={(days) =>
                  updateRule({
                    frequency: 'weekly',
                    interval: value.rule.frequency === 'weekly' ? value.rule.interval : 1,
                    weekdays: days.map(Number),
                  })
                }
              />
            </div>
          ) : null}
          {value.rule.frequency === 'monthly' ? (
            <div className='flex flex-col gap-6px text-12px text-t-secondary'>
              <span>{t('personal.tasks.recurrence.dayOfMonth')}</span>
              <InputNumber
                aria-label={t('personal.tasks.recurrence.dayOfMonth')}
                min={1}
                max={31}
                value={value.rule.dayOfMonth}
                onChange={(day) =>
                  updateRule({
                    frequency: 'monthly',
                    interval: value.rule.frequency === 'monthly' ? value.rule.interval : 1,
                    dayOfMonth: Number(day) || 1,
                  })
                }
              />
            </div>
          ) : null}
          <div className='flex flex-col gap-6px text-12px text-t-secondary'>
            <span>{t('personal.tasks.recurrence.end')}</span>
            <Select
              aria-label={t('personal.tasks.recurrence.end')}
              value={value.end?.kind ?? 'never'}
              onChange={(kind) => {
                if (kind === 'until') updateEnd({ kind: 'until', date: '' });
                else if (kind === 'count') updateEnd({ kind: 'count', occurrences: 10 });
                else updateEnd({ kind: 'never' });
              }}
            >
              <Select.Option value='never'>{t('personal.tasks.recurrence.never')}</Select.Option>
              <Select.Option value='until'>{t('personal.tasks.recurrence.until')}</Select.Option>
              <Select.Option value='count'>{t('personal.tasks.recurrence.count')}</Select.Option>
            </Select>
          </div>
          {value.end?.kind === 'until' ? (
            <div className='flex flex-col gap-6px text-12px text-t-secondary'>
              <span>{t('personal.tasks.recurrence.endDate')}</span>
              <Input
                aria-label={t('personal.tasks.recurrence.endDate')}
                type='date'
                value={value.end.date}
                onChange={(date) => updateEnd({ kind: 'until', date })}
              />
            </div>
          ) : null}
          {value.end?.kind === 'count' ? (
            <div className='flex flex-col gap-6px text-12px text-t-secondary'>
              <span>{t('personal.tasks.recurrence.occurrences')}</span>
              <InputNumber
                aria-label={t('personal.tasks.recurrence.occurrences')}
                min={1}
                max={10000}
                value={value.end.occurrences}
                onChange={(count) => updateEnd({ kind: 'count', occurrences: Number(count) || 1 })}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

export default RecurrenceEditor;
