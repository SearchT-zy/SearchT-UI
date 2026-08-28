// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryCandidate, MemoryClient, MemoryItem } from '@/common/types/searcht/memory';

vi.mock('@renderer/pages/settings/components/SettingsPageWrapper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/pages/settings/components/SettingsPageWrapper')>();
  return {
    ...actual,
    default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

const copy: Record<string, string> = {
  'personal.memory.title': '长期记忆',
  'personal.memory.description': '查看和管理SearchT记住的内容',
  'personal.memory.add': '添加记忆',
  'personal.memory.retry': '重试',
  'personal.memory.loadFailed': '记忆加载失败',
  'personal.memory.tabs.candidates': '待确认',
  'personal.memory.tabs.active': '有效记忆',
  'personal.memory.tabs.expired': '已过期',
  'personal.memory.status.pending': '待确认',
  'personal.memory.status.active': '有效',
  'personal.memory.status.expired': '已过期',
  'personal.memory.status.sensitive': '敏感',
  'personal.memory.searchPlaceholder': '搜索记忆',
  'personal.memory.allTypes': '全部类型',
  'personal.memory.actions.review': '审核',
  'personal.memory.actions.reject': '不保留',
  'personal.memory.actions.edit': '编辑',
  'personal.memory.actions.forget': '永久遗忘',
  'personal.memory.actions.reactivate': '重新启用',
  'personal.memory.actions.confirmReject': '确认不保留',
  'personal.memory.actions.confirmForget': '确认永久遗忘',
  'personal.memory.actions.confirmMemory': '确认保留',
  'personal.memory.actions.createMemory': '添加记忆',
  'personal.memory.actions.saveMemory': '保存修改',
  'personal.memory.actions.cancel': '取消',
  'personal.memory.empty.candidates': '没有待确认的记忆',
  'personal.memory.empty.active': '还没有有效记忆',
  'personal.memory.empty.expired': '没有已过期的记忆',
  'personal.memory.editor.reviewTitle': '审核候选记忆',
  'personal.memory.editor.createTitle': '添加记忆',
  'personal.memory.editor.editTitle': '编辑记忆',
  'personal.memory.editor.content': '内容',
  'personal.memory.editor.type': '类型',
  'personal.memory.editor.scope': '使用范围',
  'personal.memory.editor.scopeId': '范围名称',
  'personal.memory.editor.sensitivity': '敏感级别',
  'personal.memory.editor.confidence': '可信度',
  'personal.memory.editor.reason': '记住原因',
  'personal.memory.editor.expiresAt': '有效期',
  'personal.memory.editor.reviewAt': '复查时间',
  'personal.memory.types.preference': '偏好',
  'personal.memory.types.personal-fact': '个人信息',
  'personal.memory.types.relationship': '关系',
  'personal.memory.types.project-context': '项目背景',
  'personal.memory.types.operating-rule': '工作规则',
  'personal.memory.types.temporary-context': '临时背景',
  'personal.memory.scopes.global': '所有对话',
  'personal.memory.scopes.workspace': '工作区',
  'personal.memory.scopes.project': '项目',
  'personal.memory.scopes.assistant': '助手',
  'personal.memory.sensitivity.normal': '普通',
  'personal.memory.sensitivity.sensitive': '敏感',
  'personal.memory.sources.conversation-message': '对话消息',
  'personal.memory.sources.manual': '手动添加',
  'personal.memory.confirm.rejectTitle': '不保留这条候选记忆？',
  'personal.memory.confirm.forgetTitle': '永久遗忘这条记忆？',
  'personal.memory.confirm.forgetDescription': '删除后无法恢复。',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => copy[key] ?? key }),
}));

import MemorySettings from '@renderer/pages/settings/memory';
import { BUILTIN_TAB_IDS } from '@renderer/pages/settings/components/SettingsSider';
import { getBuiltinSettingsNavItems } from '@renderer/pages/settings/components/SettingsPageWrapper';

const candidate: MemoryCandidate = {
  id: 'candidate-1',
  operationId: 'operation-1',
  content: '偏好简短的每周总结',
  memoryType: 'preference',
  proposedScope: { kind: 'workspace', id: 'workspace-1' },
  sensitivity: 'normal',
  confidence: 0.9,
  reason: '用户多次提出相同要求',
  sourceReferences: [{ kind: 'conversation-message', id: 'message-1', label: '周报对话' }],
  suggestedExpiresAt: null,
  createdAt: 10,
  updatedAt: 10,
};

const activeMemory: MemoryItem = {
  id: 'memory-1',
  content: '偏好简短的产品总结',
  memoryType: 'preference',
  scope: { kind: 'workspace', id: 'workspace-1' },
  sensitivity: 'normal',
  confidence: 1,
  reason: '用户确认',
  sourceReferences: [{ kind: 'manual', id: 'memory-1' }],
  confirmedAt: 20,
  expiresAt: null,
  reviewAt: null,
  lastRetrievedAt: null,
  createdAt: 20,
  updatedAt: 20,
};

const expiredMemory: MemoryItem = {
  ...activeMemory,
  id: 'memory-expired',
  content: '已经结束的发布背景',
  memoryType: 'temporary-context',
  expiresAt: 50,
};

function makeClient(): MemoryClient & Record<string, ReturnType<typeof vi.fn>> {
  return {
    listCandidates: vi.fn(async () => ({ candidates: [candidate], total: 1 })),
    submitCandidate: vi.fn(async () => candidate),
    confirmCandidate: vi.fn(async (input) => ({ ...activeMemory, content: input.content })),
    rejectCandidate: vi.fn(async () => undefined),
    listMemories: vi.fn(async (query) => ({
      memories: query.view === 'expired' ? [expiredMemory] : [activeMemory],
      total: 1,
    })),
    getMemory: vi.fn(async () => activeMemory),
    createMemory: vi.fn(async (input) => ({ ...activeMemory, content: input.content })),
    updateMemory: vi.fn(async (input) => ({ ...activeMemory, ...input })),
    forgetMemory: vi.fn(async () => undefined),
    retrieve: vi.fn(async () => ({ hits: [] })),
    getStatus: vi.fn(async () => ({ pendingCount: 1, activeCount: 1, expiredCount: 1, sensitiveCount: 0 })),
    exportMemories: vi.fn(async () => ({ exportedAt: 100, memories: [activeMemory] })),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('MemorySettings', () => {
  it('shows an inline retry after loading fails', async () => {
    const client = makeClient();
    client.getStatus.mockRejectedValueOnce(new Error('offline'));
    render(<MemorySettings client={client} searchDelay={0} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('记忆加载失败');
    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText(candidate.content)).toBeInTheDocument();
  });

  it('edits and confirms a candidate while preserving its source', async () => {
    const client = makeClient();
    render(<MemorySettings client={client} searchDelay={0} />);
    await userEvent.click(await screen.findByRole('button', { name: '审核' }));
    const dialog = await screen.findByRole('dialog');
    const content = within(dialog).getByRole('textbox', { name: '内容' });
    await userEvent.clear(content);
    await userEvent.type(content, '偏好一句话产品总结');
    await userEvent.click(within(dialog).getByRole('button', { name: '确认保留' }));

    await waitFor(() =>
      expect(client.confirmCandidate).toHaveBeenCalledWith(
        expect.objectContaining({ candidateId: candidate.id, content: '偏好一句话产品总结' })
      )
    );
  });

  it('requires confirmation before rejecting a candidate', async () => {
    const client = makeClient();
    render(<MemorySettings client={client} searchDelay={0} />);
    await userEvent.click(await screen.findByRole('button', { name: '不保留' }));
    expect(client.rejectCandidate).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: '不保留这条候选记忆？' });
    await userEvent.click(within(dialog).getByRole('button', { name: '确认不保留' }));
    await waitFor(() => expect(client.rejectCandidate).toHaveBeenCalledWith(candidate.id));
  });

  it('adds a manual memory and applies search and type filters', async () => {
    const client = makeClient();
    render(<MemorySettings client={client} searchDelay={0} />);
    await userEvent.click(await screen.findByRole('button', { name: '添加记忆' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox', { name: '内容' }), '每周五整理收件箱');
    await userEvent.type(within(dialog).getByRole('textbox', { name: '记住原因' }), '用户手动添加');
    await userEvent.click(within(dialog).getByRole('button', { name: '添加记忆' }));
    await waitFor(() =>
      expect(client.createMemory).toHaveBeenCalledWith(expect.objectContaining({ content: '每周五整理收件箱' }))
    );

    await userEvent.click(screen.getByRole('tab', { name: /有效记忆/ }));
    await userEvent.type(await screen.findByRole('textbox', { name: '搜索记忆' }), '产品');
    await waitFor(() =>
      expect(client.listMemories).toHaveBeenCalledWith(expect.objectContaining({ view: 'active', search: '产品' }))
    );
  });

  it('reactivates expired memory and requires confirmation before forgetting', async () => {
    const client = makeClient();
    render(<MemorySettings client={client} searchDelay={0} />);
    await userEvent.click(await screen.findByRole('tab', { name: /已过期/ }));
    await userEvent.click(await screen.findByRole('button', { name: '重新启用' }));
    await waitFor(() =>
      expect(client.updateMemory).toHaveBeenCalledWith(
        expect.objectContaining({ id: expiredMemory.id, expiresAt: null })
      )
    );

    await userEvent.click(screen.getByRole('tab', { name: /有效记忆/ }));
    await userEvent.click(await screen.findByRole('button', { name: '永久遗忘' }));
    expect(client.forgetMemory).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: '永久遗忘这条记忆？' });
    await userEvent.click(within(dialog).getByRole('button', { name: '确认永久遗忘' }));
    await waitFor(() => expect(client.forgetMemory).toHaveBeenCalledWith(activeMemory.id));
  });

  it('places Memory immediately after Personal Workspace in desktop and mobile settings navigation', () => {
    expect(BUILTIN_TAB_IDS).toEqual(expect.arrayContaining(['personal-workspace', 'memory']));
    expect(BUILTIN_TAB_IDS.indexOf('memory')).toBe(BUILTIN_TAB_IDS.indexOf('personal-workspace') + 1);
    expect(getBuiltinSettingsNavItems(false, (key) => copy[key] ?? key).map((item) => item.id)).toContain('memory');
  });
});
