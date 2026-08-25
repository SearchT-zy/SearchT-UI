// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SiderPersonalEntries } from '@renderer/components/layout/Sider/SiderNav/SiderPersonalEntries';

describe('SiderPersonalEntries', () => {
  it('renders visible modules in persisted order', () => {
    render(
      <SiderPersonalEntries
        collapsed={false}
        isMobile={false}
        pathname='/tasks'
        preferences={{
          visibleModules: {
            today: true,
            inbox: false,
            calendar: true,
            tasks: true,
            notes: false,
            knowledge: true,
            workflows: true,
          },
          navigationOrder: ['tasks', 'today', 'calendar', 'knowledge', 'workflows', 'inbox', 'notes'],
          startPage: 'today',
          scenePack: 'general',
        }}
        siderTooltipProps={{}}
        onNavigate={vi.fn()}
      />
    );

    expect(screen.getAllByRole('link').map((item) => item.getAttribute('href'))).toEqual([
      '#/tasks',
      '#/today',
      '#/calendar',
      '#/knowledge',
      '#/workflows',
      // The embedded browser is a standalone, always-available entry.
      '#/browser',
    ]);
  });
});
