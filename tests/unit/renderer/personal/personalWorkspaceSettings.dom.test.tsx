// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@/common/types/searcht/workspace';

const messages = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

vi.mock('@renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: Object.assign(messages, { useMessage: () => [messages, null] }),
  };
});

import PersonalWorkspaceSettings from '@renderer/pages/settings/PersonalWorkspaceSettings';

const load = vi.fn(async () => DEFAULT_WORKSPACE_PREFERENCES);

describe('PersonalWorkspaceSettings', () => {
  it('persists a module visibility change', async () => {
    const save = vi.fn(async (preferences) => preferences);
    render(<PersonalWorkspaceSettings load={load} save={save} />);

    await userEvent.click(await screen.findByRole('switch', { name: '收件箱' }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ visibleModules: expect.objectContaining({ inbox: false }) })
      )
    );
  });

  it('restores the previous value when persistence fails', async () => {
    const save = vi.fn(async () => {
      throw new Error('disk full');
    });
    render(<PersonalWorkspaceSettings load={load} save={save} />);

    const inboxSwitch = await screen.findByRole('switch', { name: '收件箱' });
    await userEvent.click(inboxSwitch);

    expect(await screen.findByText('保存失败，已恢复原设置')).toBeInTheDocument();
    await waitFor(() => expect(inboxSwitch).toBeChecked());
  });

  it('shows the completed backup directory without adding another backup action', async () => {
    const createBackup = vi.fn(async () => ({
      path: 'C:\\data\\backups\\searcht-personal-2026-08-14',
      formatVersion: 1 as const,
    }));
    render(
      <PersonalWorkspaceSettings
        load={load}
        save={vi.fn(async (preferences) => preferences)}
        createBackup={createBackup}
        backupAvailable
      />
    );

    const button = await screen.findByRole('button', { name: '创建备份' });
    expect(screen.getAllByRole('button', { name: '创建备份' })).toHaveLength(1);
    await userEvent.click(button);

    expect(await screen.findByText('C:\\data\\backups\\searcht-personal-2026-08-14')).toBeInTheDocument();
    expect(createBackup).toHaveBeenCalledTimes(1);
    expect(messages.success).toHaveBeenCalledWith('备份已创建');
  });

  it('opens the first-run setup again without clearing saved preferences', async () => {
    render(<PersonalWorkspaceSettings load={load} save={vi.fn(async (preferences) => preferences)} />);

    await userEvent.click(await screen.findByRole('button', { name: '重新打开首次设置' }));

    expect(navigate).toHaveBeenCalledWith('/onboarding');
  });

  it('runs a one-click SearchT import and shows the per-category report', async () => {
    const report = {
      id: 'import-1',
      startedAt: 1,
      finishedAt: 2,
      status: 'succeeded' as const,
      rollbackAvailable: true,
      categories: [
        { category: 'conversations' as const, planned: 3, imported: 3, skipped: 0, failed: 0, errors: [] },
        { category: 'models' as const, planned: 1, imported: 1, skipped: 0, failed: 0, errors: [] },
      ],
    };
    const runImport = vi.fn(async () => report);
    render(
      <PersonalWorkspaceSettings
        load={load}
        save={vi.fn(async (preferences) => preferences)}
        importAvailable
        discoverImport={vi.fn(async () => ({
          available: true,
          dataDirectory: 'C:\\Roaming\\SearchT\\aionui',
          databasePath: 'C:\\Roaming\\SearchT\\aionui\\aionui.db',
          configDirectory: 'C:\\Roaming\\SearchT\\config',
        }))}
        planImport={vi.fn(async () => ({
          databasePath: 'C:\\Roaming\\SearchT\\aionui\\aionui.db',
          configDirectory: 'C:\\Roaming\\SearchT\\config',
          categories: [
            { category: 'conversations' as const, planned: 3 },
            { category: 'models' as const, planned: 1 },
          ],
        }))}
        listImports={vi.fn(async () => [])}
        runImport={runImport}
      />
    );

    const panel = await screen.findByTestId('searcht-import-panel');
    expect(panel).toHaveTextContent('会话历史 × 3');
    expect(panel).toHaveTextContent('模型配置 × 1');

    await userEvent.click(screen.getByTestId('searcht-import-run'));

    await waitFor(() => expect(runImport).toHaveBeenCalledOnce());
    expect(await screen.findByTestId('searcht-import-report')).toHaveTextContent('导入 3');
    expect(screen.getByTestId('searcht-import-rollback')).toBeInTheDocument();
  });

  it('rolls back an import from the report panel', async () => {
    const rollbackImport = vi.fn(async (id: string) => ({
      id,
      startedAt: 1,
      finishedAt: 3,
      status: 'rolled-back' as const,
      rollbackAvailable: false,
      categories: [],
    }));
    render(
      <PersonalWorkspaceSettings
        load={load}
        save={vi.fn(async (preferences) => preferences)}
        importAvailable
        discoverImport={vi.fn(async () => ({
          available: true,
          dataDirectory: 'C:\\Roaming\\SearchT\\aionui',
          databasePath: 'C:\\Roaming\\SearchT\\aionui\\aionui.db',
          configDirectory: null,
        }))}
        planImport={vi.fn(async () => ({
          databasePath: 'C:\\Roaming\\SearchT\\aionui\\aionui.db',
          configDirectory: null,
          categories: [{ category: 'workspaces' as const, planned: 1 }],
        }))}
        listImports={vi.fn(async () => [
          {
            id: 'import-1',
            startedAt: 1,
            finishedAt: 2,
            status: 'succeeded' as const,
            rollbackAvailable: true,
            categories: [
              { category: 'workspaces' as const, planned: 1, imported: 1, skipped: 0, failed: 0, errors: [] },
            ],
          },
        ])}
        rollbackImport={rollbackImport}
      />
    );

    await userEvent.click(await screen.findByTestId('searcht-import-rollback'));
    const confirm = await screen.findByRole('button', { name: /^(ok|确定)$/i });
    fireEvent.click(confirm);

    await waitFor(() => expect(rollbackImport).toHaveBeenCalledWith('import-1'));
  });
});
