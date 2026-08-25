import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Message, Spin, Tabs } from '@arco-design/web-react';
import { Add } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { Task, TaskCreateInput, TaskListView, TaskScope, TaskUpdateInput } from '@/common/types/searcht/tasks';
import PersonalPageShell from '../personal/PersonalPageShell';
import { taskClient, type TaskClient } from '../personal/taskClient';
import RecurrenceScopeModal from './RecurrenceScopeModal';
import TaskEditorDrawer from './TaskEditorDrawer';
import TaskList from './TaskList';
import TrashActions from './TrashActions';

const localDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

type PendingScope = { action: 'edit'; task: Task; input: TaskUpdateInput } | { action: 'remove'; task: Task };

const TasksPage: React.FC<{ client?: TaskClient }> = ({ client = taskClient }) => {
  const { t } = useTranslation();
  const [view, setView] = useState<TaskListView>('all');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [pendingScope, setPendingScope] = useState<PendingScope | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTasks(await client.list({ view, todayLocalDate: localDate() }));
    } catch {
      Message.error(t('personal.tasks.errors.load'));
    } finally {
      setLoading(false);
    }
  }, [client, t, view]);
  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditingTask(null);
    setEditorVisible(true);
  };
  const openEdit = (task: Task) => {
    if (view !== 'trash') {
      setEditingTask(task);
      setEditorVisible(true);
    }
  };
  const closeEditor = () => {
    if (!saving) {
      setEditorVisible(false);
      setEditingTask(null);
    }
  };

  const saveUpdate = async (input: TaskUpdateInput, scope: TaskScope) => {
    setSaving(true);
    try {
      await client.update(input, scope);
      setEditorVisible(false);
      setEditingTask(null);
      setPendingScope(null);
      await load();
    } catch {
      Message.error(t('personal.tasks.errors.save'));
    } finally {
      setSaving(false);
    }
  };

  const submit = async (input: TaskCreateInput | TaskUpdateInput) => {
    if ('id' in input) {
      if (editingTask?.seriesId) {
        setPendingScope({ action: 'edit', task: editingTask, input });
        return;
      }
      await saveUpdate(input, 'single');
      return;
    }
    setSaving(true);
    try {
      await client.create(input);
      setEditorVisible(false);
      await load();
    } catch {
      Message.error(t('personal.tasks.errors.create'));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (task: Task) => {
    try {
      if (task.status === 'completed') await client.reopen(task.id);
      else await client.complete(task.id);
      await load();
    } catch {
      Message.error(t('personal.tasks.errors.update'));
    }
  };
  const remove = async (task: Task) => {
    if (task.seriesId) {
      setPendingScope({ action: 'remove', task });
      return;
    }
    try {
      await client.remove(task.id, 'single');
      await load();
    } catch {
      Message.error(t('personal.tasks.errors.remove'));
    }
  };
  const selectScope = async (scope: TaskScope) => {
    if (!pendingScope) return;
    if (pendingScope.action === 'edit') {
      await saveUpdate(pendingScope.input, scope);
      return;
    }
    try {
      await client.remove(pendingScope.task.id, scope);
      setPendingScope(null);
      await load();
    } catch {
      Message.error(t('personal.tasks.errors.remove'));
    }
  };
  const restore = async (task: Task) => {
    try {
      await client.restore(task.id);
      await load();
    } catch {
      Message.error(t('personal.tasks.errors.restore'));
    }
  };
  const destroy = async (task: Task) => {
    try {
      await client.destroy(task.id);
      await load();
    } catch {
      Message.error(t('personal.tasks.errors.destroy'));
    }
  };
  const emptyTrash = async () => {
    try {
      await client.emptyTrash();
      await load();
    } catch {
      Message.error(t('personal.tasks.errors.emptyTrash'));
    }
  };

  const tabItems = useMemo(
    () =>
      [
        ['all', t('personal.tasks.views.all')],
        ['today', t('personal.tasks.views.today')],
        ['scheduled', t('personal.tasks.views.scheduled')],
        ['completed', t('personal.tasks.views.completed')],
        ['trash', t('personal.tasks.views.trash')],
      ] as const,
    [t]
  );

  return (
    <PersonalPageShell title={t('personal.tasks.title')} description={t('personal.tasks.description')}>
      <div className='flex flex-col gap-12px sm:flex-row sm:items-center sm:justify-between'>
        <Tabs className='min-w-0 overflow-x-auto' activeTab={view} onChange={(key) => setView(key as TaskListView)}>
          {tabItems.map(([key, label]) => (
            <Tabs.TabPane key={key} title={label} />
          ))}
        </Tabs>
        <div className='flex shrink-0 justify-end gap-8px'>
          {view === 'trash' ? (
            <TrashActions disabled={tasks.length === 0} loading={saving} onConfirm={() => void emptyTrash()} />
          ) : null}
          <Button type='primary' icon={<Add theme='outline' size='16' />} onClick={openCreate}>
            {t('personal.tasks.editor.createTitle')}
          </Button>
        </div>
      </div>
      <div className='mt-14px min-h-160px'>
        {loading ? (
          <div className='flex justify-center py-48px'>
            <Spin />
          </div>
        ) : (
          <TaskList
            tasks={tasks}
            trash={view === 'trash'}
            onToggle={toggle}
            onEdit={openEdit}
            onRemove={remove}
            onRestore={restore}
            onDestroy={destroy}
          />
        )}
      </div>
      <TaskEditorDrawer
        visible={editorVisible}
        task={editingTask}
        saving={saving}
        onClose={closeEditor}
        onSubmit={(input) => void submit(input)}
      />
      <RecurrenceScopeModal
        visible={pendingScope !== null}
        action={pendingScope?.action ?? 'edit'}
        onCancel={() => setPendingScope(null)}
        onSelect={(scope) => void selectScope(scope)}
      />
    </PersonalPageShell>
  );
};

export default TasksPage;
