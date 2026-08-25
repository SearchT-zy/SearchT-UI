/**
 * @license
 * Copyright 2025 SearchT-UI Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  filterAgentsForConnectionCenter,
  getAgentConnectionSummary,
  isAgentGroupReady,
  type AgentConnectionFilter,
} from '@/renderer/pages/settings/AgentSettings/agentFilters';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';

const agent = (
  id: string,
  status: ManagedAgent['status'],
  overrides?: Partial<ManagedAgent>
): ManagedAgent =>
  ({
    id,
    name: id,
    agent_type: 'acp',
    agent_source: 'builtin',
    enabled: true,
    installed: status !== 'missing',
    status,
    team_capable: false,
    ...overrides,
  }) as ManagedAgent;

describe('agent connection filters', () => {
  // a: installed but offline; b/d: installed, online, team-capable;
  // c: not installed (missing) so it is excluded from every connection count.
  const agents = [
    agent('a', 'offline'),
    agent('b', 'online', { team_capable: true }),
    agent('c', 'missing', { team_capable: true }),
    agent('d', 'online', { team_capable: true }),
  ];

  it('counts installed, connected, attention, and group-ready agents', () => {
    expect(getAgentConnectionSummary(agents)).toEqual({
      installed: 3,
      connected: 2,
      attention: 1,
      groupReady: 2,
    });
  });

  it.each<[AgentConnectionFilter, string[]]>([
    ['all', ['a', 'b', 'c', 'd']],
    ['installed', ['a', 'b', 'd']],
    ['attention', ['a']],
    ['group-ready', ['b', 'd']],
  ])('filters %s agents without changing relative order', (filter, expectedIds) => {
    expect(filterAgentsForConnectionCenter(agents, filter).map((item) => item.id)).toEqual(expectedIds);
  });

  it('requires install, enabled, online, and team capability for group readiness', () => {
    expect(isAgentGroupReady(agents[1])).toBe(true);
    expect(isAgentGroupReady(agent('x', 'online'))).toBe(false); // not team-capable
    expect(isAgentGroupReady(agent('y', 'online', { team_capable: true, enabled: false }))).toBe(false);
    expect(isAgentGroupReady(agent('z', 'offline', { team_capable: true }))).toBe(false);
    expect(isAgentGroupReady(agent('w', 'missing', { team_capable: true, installed: false }))).toBe(false);
  });
});
