// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: true }),
}));

vi.mock('@/renderer/hooks/system/useExtensionSettingsTabs', () => ({
  useExtensionSettingsTabs: () => [],
}));

vi.mock('@/renderer/hooks/system/useExtI18n', () => ({
  useExtI18n: () => ({ resolveExtTabName: (tab: { id: string }) => tab.id }),
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => false,
  resolveExtensionAssetUrl: () => '',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import SettingsPageWrapper from '@/renderer/pages/settings/components/SettingsPageWrapper';

describe('SettingsPageWrapper mobile navigation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('scrolls the active settings tab into view', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    render(
      <MemoryRouter initialEntries={['/settings/connections']}>
        <SettingsPageWrapper>
          <div>content</div>
        </SettingsPageWrapper>
      </MemoryRouter>
    );

    expect(screen.getByRole('button', { name: 'personal.connectors.title' })).toHaveClass(
      'settings-mobile-top-nav__item--active'
    );
    await waitFor(() =>
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'nearest', inline: 'center' })
    );
  });
});
