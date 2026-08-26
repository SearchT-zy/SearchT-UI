/**
 * @license
 * Copyright 2025 SearchT-UI Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Render test for the LocalAgents settings surface. Its purpose is to lock in
 * that LocalAgents reads the management view (`useManagedAgents`) — the
 * include_disabled data path that keeps user-disabled agents listed — and
 * derives the detected/custom sections from it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// t() echoes the key so section labels/buttons are assertable.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

const { messageSuccess, messageWarning, messageError } = vi.hoisted(() => ({
  messageSuccess: vi.fn(),
  messageWarning: vi.fn(),
  messageError: vi.fn(),
}));
const { openExternalUrl } = vi.hoisted(() => ({
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Message: {
      useMessage: () => [
        {
          success: messageSuccess,
          warning: messageWarning,
          error: messageError,
        },
        null,
      ],
      success: messageSuccess,
      warning: messageWarning,
      error: messageError,
    },
  };
});

// Controlled management-view data; assert LocalAgents consumes THIS hook.
const useManagedAgents = vi.fn();
vi.mock('@renderer/hooks/agent/useManagedAgents', () => ({
  useManagedAgents: () => useManagedAgents(),
}));

// Bridge is only touched by user-action handlers, not on render — stub the
// shape the handlers reference so the import resolves.
vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      createCustomAgent: { invoke: vi.fn() },
      updateCustomAgent: { invoke: vi.fn() },
      deleteCustomAgent: { invoke: vi.fn() },
      setAgentEnabled: { invoke: vi.fn() },
      checkManagedAgentHealthById: { invoke: vi.fn() },
    },
    // Bound-assistant avatar stacks fetch the assistant list via SWR.
    assistants: {
      list: { invoke: vi.fn().mockResolvedValue([]) },
    },
  },
}));

vi.mock('@renderer/utils/platform', async () => {
  const actual = await vi.importActual<typeof import('@renderer/utils/platform')>('@renderer/utils/platform');
  return {
    ...actual,
    openExternalUrl,
  };
});

vi.mock('@/renderer/utils/model/agentLogo', () => ({
  useAgentLogos: () => ({}),
  resolveAgentAvatar: () => ({ kind: 'icon', value: '' }),
}));

vi.mock('@renderer/pages/settings/AgentSettings/BoundAssistants', async () => {
  const actual = await vi.importActual<typeof import('@renderer/pages/settings/AgentSettings/BoundAssistants')>(
    '@renderer/pages/settings/AgentSettings/BoundAssistants'
  );
  return {
    ...actual,
    BoundAssistantStack: () => null,
    useAssistantsForAgents: () => ({ assistants: [] }),
  };
});

// Keep the test focused on LocalAgents' own logic — stub heavy children.
vi.mock('@/renderer/components/base/SearchtModal', () => ({ default: () => null }));
vi.mock('@renderer/pages/settings/AgentSettings/InlineAgentEditor', () => ({ default: () => null }));
vi.mock('@renderer/pages/settings/AgentSettings/AgentHubModal', () => ({ AgentHubModal: () => null }));

import LocalAgents from '@renderer/pages/settings/AgentSettings/LocalAgents';
import AgentModalContent from '@renderer/components/settings/SettingsModal/contents/AgentModalContent';
import { SettingsViewModeProvider } from '@renderer/components/settings/SettingsModal/settingsViewContext';
import { ipcBridge } from '@/common';
import { MemoryRouter } from 'react-router-dom';
import { getBoundAssistants } from '@renderer/pages/settings/AgentSettings/BoundAssistants';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';
import {
  filterAgentsForConnectionCenter,
  getAgentConnectionSummary,
  runInstalledAgentChecks,
} from '@renderer/pages/settings/AgentSettings/agentFilters';

const makeAgents = () => [
  {
    id: 'aionrs',
    name: 'Aion CLI',
    agent_type: 'aionrs',
    agent_source: 'internal',
    backend: 'aionrs',
    enabled: true,
    available: true,
    installed: true,
    status: 'online',
  },
  {
    id: 'acp-claude',
    name: 'Claude Code',
    agent_type: 'acp',
    agent_source: 'builtin',
    backend: 'claude',
    enabled: true,
    available: false,
    installed: false,
    status: 'missing',
  },
  {
    id: 'openclaw-gateway',
    name: 'OpenClaw Gateway',
    agent_type: 'openclaw-gateway',
    agent_source: 'builtin',
    backend: 'openclaw-gateway',
    enabled: true,
    available: false,
    installed: false,
    status: 'missing',
  },
  {
    id: 'custom-1',
    name: 'My Agent',
    agent_type: 'acp',
    agent_source: 'custom',
    command: 'sh',
    enabled: true,
    available: true,
    installed: true,
    status: 'offline',
  },
];

describe('Agent connection model', () => {
  const modelAgents = [
    {
      ...makeAgents()[0],
      id: 'codex',
      name: 'Codex CLI',
      status: 'online',
      team_capable: true,
    },
    {
      ...makeAgents()[0],
      id: 'aion',
      status: 'online',
      team_capable: false,
    },
    {
      ...makeAgents()[0],
      id: 'hermes',
      name: 'Hermes',
      status: 'offline',
      team_capable: true,
    },
    {
      ...makeAgents()[1],
      id: 'missing',
      name: 'Missing Agent',
      installed: false,
      status: 'missing',
      team_capable: true,
    },
  ] as ManagedAgent[];

  it('summarizes installed, connected, attention, and group-ready Agents', () => {
    expect(getAgentConnectionSummary(modelAgents)).toEqual({
      installed: 3,
      connected: 2,
      attention: 1,
      groupReady: 1,
    });
  });

  it('projects each connection-center filter from the same catalog', () => {
    expect(filterAgentsForConnectionCenter(modelAgents, 'installed').map((agent) => agent.id)).toEqual([
      'codex',
      'aion',
      'hermes',
    ]);
    expect(filterAgentsForConnectionCenter(modelAgents, 'group-ready').map((agent) => agent.id)).toEqual(['codex']);
    expect(filterAgentsForConnectionCenter(modelAgents, 'attention').map((agent) => agent.id)).toEqual(['hermes']);
    expect(filterAgentsForConnectionCenter(modelAgents, 'all')).toEqual(modelAgents);
  });

  it('checks enabled installed Agents sequentially and continues after a rejected probe', async () => {
    const checkedOrder: string[] = [];
    const progress: number[] = [];
    const agents = [modelAgents[0], { ...modelAgents[1], enabled: false }, modelAgents[2], modelAgents[3]];

    const result = await runInstalledAgentChecks(
      agents,
      async (agent) => {
        checkedOrder.push(agent.id);
        if (agent.id === 'hermes') throw new Error('provider rejected');
        return { ...agent, status: 'online' };
      },
      ({ current }) => progress.push(current)
    );

    expect(checkedOrder).toEqual(['codex', 'hermes']);
    expect(progress).toEqual([1, 2]);
    expect(result).toEqual({ checked: 2, online: 1, attention: 1, failedRequests: 1 });
  });
});

describe('LocalAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).mockReset();
  });

  it('opens as an installed-Agent connection center with readiness counts', () => {
    useManagedAgents.mockReturnValue({
      agents: [
        {
          ...makeAgents()[0],
          id: 'aion',
          installed: true,
          status: 'online',
          team_capable: true,
        },
        {
          ...makeAgents()[0],
          id: 'codex',
          name: 'Codex CLI',
          installed: true,
          status: 'online',
          team_capable: true,
        },
        {
          ...makeAgents()[0],
          id: 'hermes',
          name: 'Hermes',
          installed: true,
          status: 'offline',
          team_capable: true,
        },
        {
          ...makeAgents()[1],
          id: 'missing-agent',
          name: 'Missing Agent',
          installed: false,
          status: 'missing',
          team_capable: true,
        },
      ],
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    expect(screen.getByTestId('agent-connection-summary-installed')).toHaveTextContent('3');
    expect(screen.getByTestId('agent-connection-summary-connected')).toHaveTextContent('2');
    expect(screen.getByTestId('agent-connection-summary-attention')).toHaveTextContent('1');
    expect(screen.getByTestId('agent-connection-summary-group-ready')).toHaveTextContent('2');
    expect(screen.getByTestId('settings-tab-installed')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('Missing Agent')).not.toBeInTheDocument();
  });

  it('checks enabled installed Agents in order and refreshes the catalog once', async () => {
    const refreshCatalog = vi.fn().mockResolvedValue(undefined);
    const agents = [
      { ...makeAgents()[0], id: 'codex', name: 'Codex CLI', installed: true, enabled: true },
      { ...makeAgents()[0], id: 'hermes', name: 'Hermes', installed: true, enabled: true },
      { ...makeAgents()[0], id: 'disabled', name: 'Disabled Agent', installed: true, enabled: false },
      { ...makeAgents()[1], id: 'missing', name: 'Missing Agent', installed: false, enabled: true },
    ];
    useManagedAgents.mockReturnValue({ agents, revalidate: vi.fn(), refreshCatalog });
    vi.mocked(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke)
      .mockResolvedValueOnce({ ...agents[0], status: 'online' })
      .mockRejectedValueOnce(new Error('provider rejected'));

    render(<LocalAgents />);
    fireEvent.click(screen.getByTestId('agent-check-installed'));

    await waitFor(() => {
      expect(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).toHaveBeenNthCalledWith(1, { id: 'codex' });
      expect(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).toHaveBeenNthCalledWith(2, {
        id: 'hermes',
      });
    });
    expect(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(refreshCatalog).toHaveBeenCalledTimes(1));
  });

  it('runs the health probe and shows a success toast after an official-agent test connection succeeds', async () => {
    const refreshCatalog = vi.fn().mockResolvedValue(undefined);
    useManagedAgents.mockReturnValue({ agents: makeAgents(), revalidate: vi.fn(), refreshCatalog });
    vi.mocked(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).mockResolvedValue({
      ...makeAgents()[0],
      status: 'online',
    });

    render(<LocalAgents />);

    fireEvent.click(screen.getAllByText('settings.agentManagement.testConnection')[0]);

    await waitFor(() => {
      expect(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).toHaveBeenCalledWith({ id: 'aionrs' });
    });
    await waitFor(() => {
      expect(refreshCatalog).toHaveBeenCalled();
      expect(messageSuccess).toHaveBeenCalledWith('settings.agentManagement.testConnectionOnline');
    });
  });

  it('warns with the auth guidance when a test connection reports auth_required', async () => {
    const refreshCatalog = vi.fn().mockResolvedValue(undefined);
    useManagedAgents.mockReturnValue({ agents: makeAgents(), revalidate: vi.fn(), refreshCatalog });
    vi.mocked(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).mockResolvedValue({
      ...makeAgents()[0],
      status: 'offline',
      last_check_error_code: 'auth_required',
    });

    render(<LocalAgents />);

    fireEvent.click(screen.getAllByText('settings.agentManagement.testConnection')[0]);

    await waitFor(() => {
      // formatManagedAgentDiagnosticMessage maps auth_required → its errorCodes key.
      expect(messageWarning).toHaveBeenCalledWith('settings.agentManagement.errorCodes.auth_required');
    });
  });

  it('reads the managed-agents view and renders detected + custom sections', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);
    fireEvent.click(screen.getByTestId('settings-tab-all'));

    // Proves L30 (useManagedAgents) ran and fed the derived lists.
    expect(useManagedAgents).toHaveBeenCalled();
    expect(screen.getByText('Aion CLI')).toBeTruthy();
    expect(screen.getByText('Claude Code')).toBeTruthy();
    expect(screen.getByText('My Agent')).toBeTruthy();
  });

  it('shows the empty state when no detected agents are present', () => {
    useManagedAgents.mockReturnValue({ agents: [], revalidate: vi.fn(), refreshCatalog: vi.fn() });

    render(<LocalAgents />);

    expect(screen.getByText('settings.agentManagement.noInstalledAgents')).toBeTruthy();
    expect(screen.getByText('settings.agentManagement.customAgents')).toBeTruthy();
    expect(screen.getByText('settings.agentManagement.customEmpty')).toBeTruthy();
  });

  it('renders official/custom sections with management statuses and removes the chat shortcut', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);
    fireEvent.click(screen.getByTestId('settings-tab-all'));

    expect(screen.getByText('settings.agentManagement.connectionCenterTitle')).toBeTruthy();
    expect(screen.getByText('settings.agentManagement.customAgents')).toBeTruthy();
    // Only Claude Code shows 'missing' now; openclaw-gateway is filtered out as deprecated
    expect(screen.getByText('settings.agentManagement.statusMissing')).toBeTruthy();
    expect(screen.getByText('settings.agentManagement.statusOffline')).toBeTruthy();
    expect(screen.queryByText('settings.agentManagement.goToChat')).toBeNull();
    // Verify deprecated agent is filtered out
    expect(screen.queryByText('OpenClaw Gateway')).toBeNull();
  });

  it('shows a lightweight refresh hint while the management view is revalidating', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      isRefreshing: true,
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    expect(screen.getByText('settings.agentManagement.refreshingStatuses')).toBeInTheDocument();
    expect(screen.getByText('Aion CLI')).toBeInTheDocument();
  });

  it('renders official agents as diagnostics cards and filters out deprecated types', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);
    fireEvent.click(screen.getByTestId('settings-tab-all'));

    // Agent names render
    expect(screen.getByText('Aion CLI')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    // Deprecated openclaw-gateway agent is filtered out
    expect(screen.queryByText('OpenClaw Gateway')).toBeNull();
    // Status tags render
    expect(screen.getByText('settings.agentManagement.statusOnline')).toBeInTheDocument();
    expect(screen.getByText('settings.agentManagement.statusMissing')).toBeInTheDocument();
  });

  it('does not render the market-install CTA in the diagnostics-only agent page', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    expect(screen.queryByText('settings.agentManagement.installFromMarket')).toBeNull();
    expect(screen.queryByText('settings.agentManagement.discoverMoreAgents')).toBeNull();
  });

  it('renders the setup-guide action for official agents diagnostics', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    fireEvent.click(screen.getByText('settings.agentManagement.localAgentsSetupLink'));

    expect(openExternalUrl).toHaveBeenCalledWith('https://github.com/searcht-ui/SearchT-UI/wiki/ACP-Setup');
  });

  it('binds assistants to managed agents by agent_id instead of runtime backend', () => {
    const [aionrsAgent, claudeAgent] = makeAgents();
    const assistants: Assistant[] = [
      {
        id: 'assistant-on-claude-runtime',
        source: 'generated',
        name: 'Claude Runtime',
        name_i18n: {},
        description_i18n: {},
        enabled: true,
        sort_order: 1,
        agent_id: 'acp-other-claude',
        preset_agent_type: 'claude',
        enabled_skills: [],
        custom_skill_names: [],
        disabled_builtin_skills: [],
        context_i18n: {},
        prompts: [],
        prompts_i18n: {},
        models: [],
        agent_status: 'online',
        team_selectable: true,
        deletable: true,
      },
      {
        id: 'assistant-on-claude-agent',
        source: 'generated',
        name: 'Claude Agent',
        name_i18n: {},
        description_i18n: {},
        enabled: true,
        sort_order: 2,
        agent_id: 'acp-claude',
        preset_agent_type: 'claude',
        enabled_skills: [],
        custom_skill_names: [],
        disabled_builtin_skills: [],
        context_i18n: {},
        prompts: [],
        prompts_i18n: {},
        models: [],
        agent_status: 'online',
        team_selectable: true,
        deletable: true,
      },
    ];

    expect(getBoundAssistants(claudeAgent, assistants).map((assistant) => assistant.id)).toEqual([
      'assistant-on-claude-agent',
    ]);
    expect(getBoundAssistants(aionrsAgent, assistants)).toEqual([]);
  });

  it('pins Kimi right after the aionrs agent in the official list', () => {
    useManagedAgents.mockReturnValue({
      agents: [
        ...makeAgents(),
        {
          id: 'acp-kimi',
          name: 'Kimi',
          agent_type: 'acp',
          agent_source: 'builtin',
          backend: 'kimi',
          enabled: true,
          available: false,
          installed: false,
          status: 'missing',
        },
      ],
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);
    fireEvent.click(screen.getByTestId('settings-tab-all'));

    // Alphabetically Claude Code < Kimi, so this order proves the pin rule:
    // aionrs stays first, Kimi jumps ahead of the localeCompare ordering.
    const aion = screen.getByText('Aion CLI');
    const kimi = screen.getByText('Kimi');
    const claude = screen.getByText('Claude Code');
    expect(kimi.compareDocumentPosition(aion) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(claude.compareDocumentPosition(kimi) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('renders agent management as a single diagnostics page without local/remote tabs', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/settings/agents?tab=remote']}>
        <SettingsViewModeProvider value='page'>
          <AgentModalContent />
        </SettingsViewModeProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('Aion CLI')).toBeInTheDocument();
    expect(screen.queryByText('settings.agentManagement.localAgents')).toBeNull();
  });

  it('surfaces custom-agent toggle failures to the user', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const refreshCatalog = vi.fn().mockResolvedValue(undefined);
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog,
    });
    vi.mocked(ipcBridge.acpConversation.setAgentEnabled.invoke).mockRejectedValue({
      backendMessage: 'permission denied',
    });

    render(<LocalAgents />);

    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => {
      expect(ipcBridge.acpConversation.setAgentEnabled.invoke).toHaveBeenCalledWith({
        id: 'custom-1',
        enabled: false,
      });
      expect(messageError).toHaveBeenCalledWith('permission denied');
    });
    expect(refreshCatalog).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('switches between installed, group-ready, attention, and all Agent filters', () => {
    useManagedAgents.mockReturnValue({
      agents: [
        { ...makeAgents()[0], team_capable: true },
        { ...makeAgents()[0], id: 'hermes', name: 'Hermes', status: 'offline', team_capable: true },
        makeAgents()[1],
      ],
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    const allTab = screen.getByTestId('settings-tab-all');
    const installedTab = screen.getByTestId('settings-tab-installed');
    const groupReadyTab = screen.getByTestId('settings-tab-group-ready');
    const attentionTab = screen.getByTestId('settings-tab-attention');
    expect(allTab.tagName).toBe('BUTTON');

    // Installed is the ordinary-user default, so the missing CLI stays out of view.
    expect(installedTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Aion CLI')).toBeInTheDocument();
    expect(screen.getByText('Hermes')).toBeInTheDocument();
    expect(screen.queryByText('Claude Code')).toBeNull();

    fireEvent.click(groupReadyTab);
    expect(screen.getByText('Aion CLI')).toBeInTheDocument();
    expect(screen.queryByText('Hermes')).toBeNull();

    fireEvent.click(attentionTab);
    expect(screen.queryByText('Aion CLI')).toBeNull();
    expect(screen.getByText('Hermes')).toBeInTheDocument();

    fireEvent.click(allTab);
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
  });

  it('uses a filtered empty state instead of claiming no custom Agents exist', () => {
    useManagedAgents.mockReturnValue({
      agents: [{ ...makeAgents()[3], team_capable: false }],
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);
    fireEvent.click(screen.getByTestId('settings-tab-group-ready'));

    expect(screen.getAllByText('settings.agentManagement.noSearchResults')).toHaveLength(2);
    expect(screen.queryByText('settings.agentManagement.customEmpty')).toBeNull();
  });
});
