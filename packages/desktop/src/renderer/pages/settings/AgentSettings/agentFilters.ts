import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';

export type AgentConnectionFilter = 'installed' | 'group-ready' | 'attention' | 'all';

export type AgentConnectionSummary = {
  installed: number;
  connected: number;
  attention: number;
  groupReady: number;
};

export type InstalledAgentCheckProgress = {
  current: number;
  total: number;
};

export type InstalledAgentCheckResult = {
  checked: number;
  online: number;
  attention: number;
  failedRequests: number;
};

export const isAgentGroupReady = (agent: ManagedAgent): boolean =>
  agent.installed && agent.enabled !== false && agent.status === 'online' && agent.team_capable === true;

export const getAgentConnectionSummary = (agents: ManagedAgent[]): AgentConnectionSummary => {
  const installedAgents = agents.filter((agent) => agent.installed);
  return {
    installed: installedAgents.length,
    connected: installedAgents.filter((agent) => agent.status === 'online').length,
    attention: installedAgents.filter((agent) => agent.status !== 'online').length,
    groupReady: installedAgents.filter(isAgentGroupReady).length,
  };
};

export const filterAgentsForConnectionCenter = (
  agents: ManagedAgent[],
  filter: AgentConnectionFilter
): ManagedAgent[] => {
  switch (filter) {
    case 'installed':
      return agents.filter((agent) => agent.installed);
    case 'group-ready':
      return agents.filter(isAgentGroupReady);
    case 'attention':
      return agents.filter((agent) => agent.installed && agent.status !== 'online');
    case 'all':
      return agents;
  }
};

export const runInstalledAgentChecks = async (
  agents: ManagedAgent[],
  check: (agent: ManagedAgent) => Promise<Pick<ManagedAgent, 'status'>>,
  onProgress?: (progress: InstalledAgentCheckProgress) => void
): Promise<InstalledAgentCheckResult> => {
  const eligibleAgents = agents.filter((agent) => agent.installed && agent.enabled !== false);
  let online = 0;
  let failedRequests = 0;

  for (const [index, agent] of eligibleAgents.entries()) {
    try {
      // eslint-disable-next-line no-await-in-loop -- Agent CLIs are checked sequentially to bound process and memory usage.
      const result = await check(agent);
      if (result.status === 'online') online += 1;
    } catch {
      failedRequests += 1;
    } finally {
      onProgress?.({ current: index + 1, total: eligibleAgents.length });
    }
  }

  return {
    checked: eligibleAgents.length,
    online,
    attention: eligibleAgents.length - online,
    failedRequests,
  };
};
