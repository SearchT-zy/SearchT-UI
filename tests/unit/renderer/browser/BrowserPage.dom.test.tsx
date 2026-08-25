// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@renderer/utils/platform', () => ({ isElectronDesktop: () => false }));

const messages = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: Object.assign(messages, { useMessage: () => [messages, null] }),
  };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));
vi.mock('@/common', () => ({
  ipcBridge: { inbox: { captureText: vi.fn(async () => ({})) } },
}));

import BrowserPage from '@renderer/pages/browser';

describe('BrowserPage (web fallback surface)', () => {
  it('renders the toolbar, address bar, and side panels without a webview', () => {
    render(<BrowserPage />);

    expect(screen.getByTestId('browser-page')).toBeInTheDocument();
    expect(screen.getByTestId('browser-address')).toBeInTheDocument();
    expect(screen.getByTestId('browser-side-panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '后退' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '前进' })).toBeDisabled();
    expect(screen.queryByTestId('browser-webview')).not.toBeInTheDocument();
    expect(screen.getByText('内置浏览器仅在SearchT-UI桌面版中可用。')).toBeInTheDocument();
  });

  it('keeps recognition and operation actions disabled until a page is loaded', () => {
    render(<BrowserPage />);

    expect(screen.getByTestId('browser-read-page')).toBeDisabled();
    expect(screen.getByTestId('browser-save-inbox')).toBeDisabled();
    expect(screen.getByTestId('browser-action-click')).toBeDisabled();
    expect(screen.getByTestId('browser-action-set')).toBeDisabled();
    // Scrolling only needs the desktop webview, still disabled in web mode.
    expect(screen.getByTestId('browser-action-scroll-down')).toBeDisabled();
  });

  it('shows the operate panel inputs', async () => {
    render(<BrowserPage />);

    const selector =
      screen.getByTestId('browser-action-selector').querySelector('input') ??
      screen.getByTestId('browser-action-selector');
    await userEvent.type(screen.getByLabelText('CSS 选择器'), 'a.login');
    expect(screen.getByDisplayValue('a.login')).toBeInTheDocument();
    void selector;
  });
});
