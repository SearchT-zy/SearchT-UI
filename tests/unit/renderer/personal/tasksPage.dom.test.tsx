// @vitest-environment jsdom
import React from 'react';
import { Message } from '@arco-design/web-react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskClient } from '@renderer/pages/personal/taskClient';
import TasksPage from '@renderer/pages/tasks';

const translations: Record<string, string> = {
  'common.cancel': '取消',
  'common.edit': '编辑',
  'personal.tasks.title': '待办',
  'personal.tasks.description': '把要做的事放在这里，按计划逐项完成。',
  'personal.tasks.empty': '暂无待办',
  'personal.tasks.noDate': '无日期',
  'personal.tasks.minutes': '{{count}} 分钟',
  'personal.tasks.views.all': '全部',
  'personal.tasks.views.today': '今天',
  'personal.tasks.views.scheduled': '计划中',
  'personal.tasks.views.completed': '已完成',
  'personal.tasks.views.trash': '回收站',
  'personal.tasks.editor.createTitle': '新建待办',
  'personal.tasks.editor.editTitle': '编辑待办',
  'personal.tasks.editor.createAction': '创建待办',
  'personal.tasks.editor.saveChanges': '保存修改',
  'personal.tasks.fields.title': '标题',
  'personal.tasks.fields.titlePlaceholder': '要完成什么？',
  'personal.tasks.fields.notes': '备注',
  'personal.tasks.fields.notesPlaceholder': '补充上下文或结果要求',
  'personal.tasks.fields.dueDate': '截止日期',
  'personal.tasks.fields.priority': '优先级',
  'personal.tasks.fields.estimatedMinutes': '预计时长（分钟）',
  'personal.tasks.fields.optional': '可选',
  'personal.tasks.priorities.none': '无',
  'personal.tasks.priorities.low': '低',
  'personal.tasks.priorities.medium': '中',
  'personal.tasks.priorities.high': '高',
  'personal.tasks.actions.moveToTrash': '移到回收站',
  'personal.tasks.actions.restore': '恢复',
  'personal.tasks.actions.restoreNamed': '恢复 {{title}}',
  'personal.tasks.actions.editNamed': '编辑 {{title}}',
  'personal.tasks.actions.removeNamed': '删除 {{title}}',
  'personal.tasks.actions.completeNamed': '完成 {{title}}',
  'personal.tasks.trash.empty': '回收站为空',
  'personal.tasks.trash.emptyAction': '清空回收站',
  'personal.tasks.trash.emptyTitle': '清空回收站',
  'personal.tasks.trash.confirmEmpty': '确认清空',
  'personal.tasks.trash.emptyDescription': '回收站中的待办将被永久删除，且无法恢复。',
  'personal.tasks.errors.restore': '无法恢复待办',
  'personal.tasks.recurrence.label': '重复',
  'personal.tasks.recurrence.frequency': '频率',
  'personal.tasks.recurrence.daily': '每天',
  'personal.tasks.recurrence.weekdays': '工作日',
  'personal.tasks.recurrence.weekly': '每周',
  'personal.tasks.recurrence.monthly': '每月',
  'personal.tasks.recurrence.interval': '间隔',
  'personal.tasks.recurrence.weekday': '星期',
  'personal.tasks.recurrence.dayOfMonth': '每月日期',
  'personal.tasks.recurrence.end': '结束',
  'personal.tasks.recurrence.never': '永不',
  'personal.tasks.recurrence.until': '指定日期',
  'personal.tasks.recurrence.count': '指定次数',
  'personal.tasks.recurrence.endDate': '结束日期',
  'personal.tasks.recurrence.occurrences': '总次数',
  'personal.tasks.recurrence.editTitle': '修改重复待办',
  'personal.tasks.recurrence.scopeDescription': '选择此次操作影响的范围。已完成的历史记录不会改变。',
  'personal.tasks.recurrence.single': '仅本次',
  'personal.tasks.recurrence.thisAndFuture': '本次及以后',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      (translations[key] ?? key).replace(/{{(\w+)}}/g, (_match, name: string) => String(values?.[name] ?? '')),
  }),
}));

const normalTask = {
  id: 'task-1',
  title: 'Review inbox',
  notes: '',
  priority: 'none' as const,
  dueAt: null,
  dueLocalDate: '2026-08-13',
  estimatedMinutes: null,
  status: 'open' as const,
  completedAt: null,
  seriesId: null,
  occurrenceKey: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};

function makeClient(tasks = [normalTask]): TaskClient {
  return {
    list: vi.fn(async () => tasks),
    create: vi.fn(async (input) => ({ ...normalTask, id: 'created', title: input.title })),
    update: vi.fn(async (input) => ({ ...normalTask, ...input })),
    complete: vi.fn(async () => ({ task: { ...normalTask, status: 'completed' } })),
    reopen: vi.fn(async () => normalTask),
    remove: vi.fn(async () => undefined),
    restore: vi.fn(async () => normalTask),
    destroy: vi.fn(async () => undefined),
    emptyTrash: vi.fn(async () => ({ removed: 1 })),
  };
}

describe('TasksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // userEvent.type + several waitFor rounds make this slow under parallel load.
  it('opens an existing task and saves edits', { timeout: 30000 }, async () => {
    const client = makeClient();
    render(<TasksPage client={client} />);
    await userEvent.click(await screen.findByText('Review inbox'));
    const title = await screen.findByLabelText('标题');
    await userEvent.clear(title);
    await userEvent.type(title, 'Review all inboxes');
    await userEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() =>
      expect(client.update).toHaveBeenCalledWith(expect.objectContaining({ title: 'Review all inboxes' }), 'single')
    );
  });

  it('creates a recurring task from the editor', async () => {
    const client = makeClient([]);
    render(<TasksPage client={client} />);
    await userEvent.click(await screen.findByRole('button', { name: '新建待办' }));
    await userEvent.type(screen.getByLabelText('标题'), 'Daily planning');
    fireEvent.change(screen.getByLabelText('截止日期'), { target: { value: '2026-08-13' } });
    await userEvent.click(screen.getByRole('checkbox', { name: '重复' }));
    await userEvent.click(screen.getByRole('button', { name: '创建待办' }));
    await waitFor(() =>
      expect(client.create).toHaveBeenCalledWith(
        expect.objectContaining({ recurrence: expect.objectContaining({ rule: { frequency: 'daily', interval: 1 } }) })
      )
    );
  });

  it('asks for a scope before editing a recurring task', async () => {
    const client = makeClient([{ ...normalTask, seriesId: 'series-1', occurrenceKey: '2026-08-13' }]);
    render(<TasksPage client={client} />);
    await userEvent.click(await screen.findByText('Review inbox'));
    await userEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect(await screen.findByText('修改重复待办')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '本次及以后' }));
    await waitFor(() => expect(client.update).toHaveBeenCalledWith(expect.anything(), 'this-and-future'));
  });

  it('empties the trash after confirmation', async () => {
    const client = makeClient([{ ...normalTask, deletedAt: 2 }]);
    render(<TasksPage client={client} />);
    await userEvent.click(await screen.findByText('回收站'));
    await userEvent.click(await screen.findByRole('button', { name: '清空回收站' }));
    await userEvent.click(await screen.findByRole('button', { name: '确认清空' }));
    await waitFor(() => expect(client.emptyTrash).toHaveBeenCalled());
  });

  it('shows a localized error when restoring from trash fails', async () => {
    const client = makeClient([{ ...normalTask, deletedAt: 2 }]);
    vi.mocked(client.restore).mockRejectedValueOnce(new Error('database unavailable'));
    const error = vi.spyOn(Message, 'error').mockImplementation(() => undefined as never);
    render(<TasksPage client={client} />);

    await userEvent.click(await screen.findByText('回收站'));
    await userEvent.click(await screen.findByRole('button', { name: '恢复 Review inbox' }));

    await waitFor(() => expect(error).toHaveBeenCalledWith('无法恢复待办'));
  });
});
