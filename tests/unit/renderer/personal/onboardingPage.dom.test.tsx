// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@/common/types/searcht/workspace';

const { navigate, save } = vi.hoisted(() => ({
  navigate: vi.fn(),
  save: vi.fn(async (value: unknown) => value),
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

vi.mock('@renderer/hooks/agent/useManagedAgents', () => ({
  useManagedAgents: () => ({ agents: [], isLoading: false, isRefreshing: false }),
}));

vi.mock('@renderer/pages/personal/workspacePreferencesClient', () => ({
  loadWorkspacePreferences: async () => DEFAULT_WORKSPACE_PREFERENCES,
  saveWorkspacePreferences: save,
}));

import OnboardingPage from '@renderer/pages/onboarding';

describe('OnboardingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('completes all six steps and routes to the selected start page', async () => {
    render(
      <MemoryRouter initialEntries={['/onboarding']}>
        <OnboardingPage />
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: '设置你的工作台' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '下一步' }));
    await userEvent.click(screen.getByRole('button', { name: '下一步' }));

    // Step 2 — model boundary: pick local-only so no cloud consent is needed.
    await userEvent.click(screen.getByRole('radio', { name: /仅本地模型/ }));
    await userEvent.click(screen.getByRole('button', { name: '下一步' }));

    // Step 3 — connector interests: select calendar subscription.
    await userEvent.click(screen.getByTestId('onboarding-connector-calendar'));
    await userEvent.click(screen.getByRole('button', { name: '下一步' }));

    // Step 4 — permission review.
    await userEvent.click(screen.getByRole('checkbox', { name: /我已了解以上默认权限边界/ }));
    await userEvent.click(screen.getByRole('button', { name: '下一步' }));

    // Step 5 — local agents, then finish.
    await userEvent.click(screen.getByRole('button', { name: '开始使用' }));

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        onboardingCompleted: true,
        onboardingVersion: 2,
        startPage: 'today',
        modelBoundary: 'local-only',
        connectorInterests: ['calendar'],
        permissionsReviewed: true,
      })
    );
    expect(navigate).toHaveBeenCalledWith('/today', { replace: true });
  });

  it('requires explicit consent when the included cloud allowance is chosen', async () => {
    render(
      <MemoryRouter initialEntries={['/onboarding']}>
        <OnboardingPage />
      </MemoryRouter>
    );

    await screen.findByRole('heading', { name: '设置你的工作台' });
    await userEvent.click(screen.getByRole('button', { name: '下一步' }));
    await userEvent.click(screen.getByRole('button', { name: '下一步' }));

    const consent = screen.getByRole('checkbox', { name: /我了解并同意/ });
    expect(consent).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: /使用内置云额度/ }));
    await userEvent.click(consent);

    expect(save).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: '跳过，稍后设置' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ modelBoundary: 'included-cloud', cloudConsentGranted: true })
    );
  });

  it('lets users skip Agent detection and still finish locally', async () => {
    render(
      <MemoryRouter initialEntries={['/onboarding']}>
        <OnboardingPage />
      </MemoryRouter>
    );

    await userEvent.click(await screen.findByRole('button', { name: '跳过，稍后设置' }));

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ onboardingCompleted: true }));
    expect(navigate).toHaveBeenCalledWith('/today', { replace: true });
  });
});
