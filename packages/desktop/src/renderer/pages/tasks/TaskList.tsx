import React from 'react';
import { Button, Checkbox, Empty, Popconfirm, Tag, Tooltip } from '@arco-design/web-react';
import { Delete, Edit, Undo } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { Task } from '@/common/types/searcht/tasks';

type TaskListProps = {
  tasks: Task[];
  trash: boolean;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onRemove: (task: Task) => void;
  onRestore: (task: Task) => void;
  onDestroy: (task: Task) => void;
};

const priorityColors: Record<Task['priority'], 'gray' | 'blue' | 'orange' | 'red'> = {
  none: 'gray',
  low: 'blue',
  medium: 'orange',
  high: 'red',
};

const TaskList: React.FC<TaskListProps> = ({ tasks, trash, onToggle, onEdit, onRemove, onRestore, onDestroy }) => {
  const { t } = useTranslation();
  if (tasks.length === 0)
    return <Empty className='py-64px' description={t(trash ? 'personal.tasks.trash.empty' : 'personal.tasks.empty')} />;
  return (
    <div className='divide-y divide-border-2 border-y border-border-2'>
      {tasks.map((task) => (
        <div
          key={task.id}
          className='group flex min-h-62px items-start gap-12px px-4px py-11px sm:items-center sm:px-8px'
        >
          {!trash ? (
            <Checkbox
              className='mt-2px sm:mt-0'
              checked={task.status === 'completed'}
              onChange={() => onToggle(task)}
              aria-label={t(
                task.status === 'completed'
                  ? 'personal.tasks.actions.reopenNamed'
                  : 'personal.tasks.actions.completeNamed',
                { title: task.title }
              )}
            />
          ) : (
            <span className='w-16px' />
          )}
          <Button
            type='text'
            className='h-auto min-w-0 flex-1 justify-start p-0 text-left'
            onClick={() => onEdit(task)}
          >
            <div
              className={`truncate text-14px leading-20px ${task.status === 'completed' ? 'text-t-tertiary line-through' : 'text-t-primary'}`}
            >
              {task.title}
            </div>
            <div className='mt-4px flex min-h-20px flex-wrap items-center gap-6px text-12px text-t-tertiary'>
              {task.dueLocalDate ? <span>{task.dueLocalDate}</span> : <span>{t('personal.tasks.noDate')}</span>}
              {task.estimatedMinutes ? (
                <span>{t('personal.tasks.minutes', { count: task.estimatedMinutes })}</span>
              ) : null}
              {task.seriesId ? (
                <Tag size='small' color='arcoblue'>
                  {t('personal.tasks.recurrence.label')}
                </Tag>
              ) : null}
              {task.priority !== 'none' ? (
                <Tag size='small' color={priorityColors[task.priority]}>
                  {t(`personal.tasks.priorities.${task.priority}`)}
                </Tag>
              ) : null}
            </div>
          </Button>
          <div className='flex shrink-0 items-center gap-2px'>
            {trash ? (
              <>
                <Tooltip content={t('personal.tasks.actions.restore')}>
                  <Button
                    aria-label={t('personal.tasks.actions.restoreNamed', { title: task.title })}
                    type='text'
                    icon={<Undo theme='outline' size='17' />}
                    onClick={() => onRestore(task)}
                  />
                </Tooltip>
                <Popconfirm title={t('personal.tasks.trash.destroyConfirm')} onOk={() => onDestroy(task)}>
                  <Tooltip content={t('personal.tasks.actions.destroy')}>
                    <Button
                      aria-label={t('personal.tasks.actions.destroyNamed', { title: task.title })}
                      type='text'
                      status='danger'
                      icon={<Delete theme='outline' size='17' />}
                    />
                  </Tooltip>
                </Popconfirm>
              </>
            ) : (
              <>
                <Tooltip content={t('common.edit')}>
                  <Button
                    aria-label={t('personal.tasks.actions.editNamed', { title: task.title })}
                    type='text'
                    icon={<Edit theme='outline' size='17' />}
                    onClick={() => onEdit(task)}
                  />
                </Tooltip>
                <Tooltip content={t('personal.tasks.actions.moveToTrash')}>
                  <Button
                    aria-label={t('personal.tasks.actions.removeNamed', { title: task.title })}
                    type='text'
                    status='danger'
                    icon={<Delete theme='outline' size='17' />}
                    onClick={() => onRemove(task)}
                  />
                </Tooltip>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default TaskList;
