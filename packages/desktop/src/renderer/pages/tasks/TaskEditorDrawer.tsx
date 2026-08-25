import React, { useEffect, useState } from 'react';
import { Drawer, Input, InputNumber, Select } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { Task, TaskCreateInput, TaskPriority, TaskUpdateInput } from '@/common/types/searcht/tasks';
import RecurrenceEditor from './RecurrenceEditor';

type Props = {
  visible: boolean;
  task: Task | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (input: TaskCreateInput | TaskUpdateInput) => void;
};

const TaskEditorDrawer: React.FC<Props> = ({ visible, task, saving, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('none');
  const [dueLocalDate, setDueLocalDate] = useState('');
  const [estimatedMinutes, setEstimatedMinutes] = useState<number | undefined>();
  const [recurrence, setRecurrence] = useState<TaskCreateInput['recurrence'] | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTitle(task?.title ?? '');
    setNotes(task?.notes ?? '');
    setPriority(task?.priority ?? 'none');
    setDueLocalDate(task?.dueLocalDate ?? '');
    setEstimatedMinutes(task?.estimatedMinutes ?? undefined);
    setRecurrence(task?.recurrence ?? null);
  }, [task, visible]);

  const submit = () => {
    const fields: TaskCreateInput = {
      title,
      notes,
      priority,
      dueLocalDate: dueLocalDate || null,
      estimatedMinutes: estimatedMinutes ?? null,
      ...(recurrence ? { recurrence } : {}),
    };
    onSubmit(task ? { ...fields, id: task.id, recurrence } : fields);
  };

  return (
    <Drawer
      title={task ? t('personal.tasks.editor.editTitle') : t('personal.tasks.editor.createTitle')}
      visible={visible}
      width={420}
      maskClosable={!saving}
      escToExit={!saving}
      onCancel={onClose}
      onOk={submit}
      okButtonProps={{ loading: saving }}
      okText={task ? t('personal.tasks.editor.saveChanges') : t('personal.tasks.editor.createAction')}
      cancelText={t('common.cancel')}
    >
      <div className='flex flex-col gap-16px'>
        {/* Caption blocks use <div>+<span>, not <label>: wrapping Select and
            other popup controls in <label> makes the browser's label-activation
            forward extra clicks into the control, instantly closing popups
            (priority dropdown was unopenable for real clicks). */}
        <div className='flex flex-col gap-6px text-12px text-t-secondary'>
          <span>{t('personal.tasks.fields.title')}</span>
          <Input
            aria-label={t('personal.tasks.fields.title')}
            autoFocus
            maxLength={200}
            value={title}
            onChange={setTitle}
            placeholder={t('personal.tasks.fields.titlePlaceholder')}
          />
        </div>
        <div className='flex flex-col gap-6px text-12px text-t-secondary'>
          <span>{t('personal.tasks.fields.notes')}</span>
          <Input.TextArea
            aria-label={t('personal.tasks.fields.notes')}
            maxLength={10000}
            autoSize={{ minRows: 3, maxRows: 7 }}
            value={notes}
            onChange={setNotes}
            placeholder={t('personal.tasks.fields.notesPlaceholder')}
          />
        </div>
        <div className='grid grid-cols-1 gap-12px sm:grid-cols-2'>
          <div className='flex flex-col gap-6px text-12px text-t-secondary'>
            <span>{t('personal.tasks.fields.dueDate')}</span>
            <Input
              aria-label={t('personal.tasks.fields.dueDate')}
              type='date'
              value={dueLocalDate}
              onChange={setDueLocalDate}
            />
          </div>
          <div className='flex flex-col gap-6px text-12px text-t-secondary'>
            <span>{t('personal.tasks.fields.priority')}</span>
            <Select
              aria-label={t('personal.tasks.fields.priority')}
              value={priority}
              onChange={(value) => setPriority(value as TaskPriority)}
            >
              <Select.Option value='none'>{t('personal.tasks.priorities.none')}</Select.Option>
              <Select.Option value='low'>{t('personal.tasks.priorities.low')}</Select.Option>
              <Select.Option value='medium'>{t('personal.tasks.priorities.medium')}</Select.Option>
              <Select.Option value='high'>{t('personal.tasks.priorities.high')}</Select.Option>
            </Select>
          </div>
        </div>
        <div className='flex flex-col gap-6px text-12px text-t-secondary'>
          <span>{t('personal.tasks.fields.estimatedMinutes')}</span>
          <InputNumber
            aria-label={t('personal.tasks.fields.estimatedMinutes')}
            min={1}
            max={1440}
            value={estimatedMinutes}
            onChange={(value) => setEstimatedMinutes(value == null ? undefined : Number(value))}
            placeholder={t('personal.tasks.fields.optional')}
          />
        </div>
        <RecurrenceEditor value={recurrence ?? null} onChange={setRecurrence} />
      </div>
    </Drawer>
  );
};

export default TaskEditorDrawer;
