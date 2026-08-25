/**
 * @license
 * Copyright 2025 SearchT-UI Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { parseError } from '@/common/utils';
import {
  formatManagedAgentDiagnosticMessage,
  managedAgentSearchText,
  type ManagedAgent,
} from '@/renderer/utils/model/agentTypes';
import AionModal from '@/renderer/components/base/AionModal';
import { AionSearchInput } from '@/renderer/components/base';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { useManagedAgents } from '@/renderer/hooks/agent/useManagedAgents';
import { openExternalUrl } from '@/renderer/utils/platform';
import { Button, Message, Typography } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import TalkToButlerButton from '@/renderer/components/base/TalkToButlerButton';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AgentCard from './AgentCard';
import { isDeprecatedRuntimeAgentType } from '@/renderer/utils/model/agentTypeSupportPolicy';
import InlineAgentEditor, { type CustomAgentDraft } from './InlineAgentEditor';
import { getBoundAssistants, useAssistantsForAgents } from './BoundAssistants';
import SettingsPageHeader from '../components/SettingsPageHeader';
import { useNavigate } from 'react-router-dom';
import {
  filterAgentsForConnectionCenter,
  getAgentConnectionSummary,
  runInstalledAgentChecks,
  type AgentConnectionFilter,
  type InstalledAgentCheckProgress,
} from './agentFilters';

const LOCAL_AGENT_SETUP_GUIDE_URL = 'https://github.com/searcht-ui/SearchT-UI/wiki/ACP-Setup';

const LocalAgents: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const [testingAgentId, setTestingAgentId] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState<AgentConnectionFilter>('installed');
  const [bulkCheckProgress, setBulkCheckProgress] = useState<InstalledAgentCheckProgress | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const { assistants } = useAssistantsForAgents();

  // Management view: includes user-disabled custom agents so they stay
  // listed (greyed) with a working re-enable toggle. `refreshCatalog`
  // also refreshes assistant list caches because generated-assistant availability
  // can change after health checks or custom-agent mutations.
  const { agents: allAgents, isRefreshing, refreshCatalog } = useManagedAgents();

  // Hide deprecated runtime backends (nanobot / openclaw-gateway / remote / gemini)
  // — they are no longer offered as agents and shouldn't appear on the detection page.
  const officialAgents = useMemo(
    () => allAgents.filter((a) => a.agent_source !== 'custom' && !isDeprecatedRuntimeAgentType(a.agent_type)),
    [allAgents]
  );

  const customAgents: ManagedAgent[] = useMemo(() => allAgents.filter((a) => a.agent_source === 'custom'), [allAgents]);
  const connectionAgents = useMemo(() => [...officialAgents, ...customAgents], [customAgents, officialAgents]);

  const [editorVisible, setEditorVisible] = useState(false);
  const [editingAgent, setEditingAgent] = useState<ManagedAgent | null>(null);

  const handleSaveCustomAgent = useCallback(
    async (draft: CustomAgentDraft) => {
      const body = {
        name: draft.name,
        command: draft.command,
        icon: draft.icon,
        args: draft.args,
        env: draft.env,
        advanced: draft.advanced,
      };
      try {
        if (editingAgent) {
          await ipcBridge.acpConversation.updateCustomAgent.invoke({ id: editingAgent.id, ...body });
        } else {
          await ipcBridge.acpConversation.createCustomAgent.invoke(body);
        }
        await refreshCatalog();
        setEditorVisible(false);
        setEditingAgent(null);
      } catch (err) {
        console.error('save custom agent failed:', err);
        Message.error(parseError(err));
      }
    },
    [editingAgent, refreshCatalog]
  );

  const handleDeleteCustomAgent = useCallback(
    async (agentId: string) => {
      try {
        await ipcBridge.acpConversation.deleteCustomAgent.invoke({ id: agentId });
        await refreshCatalog();
      } catch (err) {
        console.error('delete custom agent failed:', err);
        Message.error(parseError(err));
      }
    },
    [refreshCatalog]
  );

  const handleToggleCustomAgent = useCallback(
    async (agentId: string, enabled: boolean) => {
      try {
        await ipcBridge.acpConversation.setAgentEnabled.invoke({ id: agentId, enabled });
        await refreshCatalog();
      } catch (err) {
        console.error('toggle custom agent failed:', err);
        Message.error(parseError(err));
      }
    },
    [refreshCatalog]
  );

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const matchesAgentSearch = useCallback(
    (agent: ManagedAgent) => {
      if (!normalizedSearchQuery) return true;
      return managedAgentSearchText(agent, i18n.language).includes(normalizedSearchQuery);
    },
    [i18n.language, normalizedSearchQuery]
  );

  const sortedOfficialAgents = useMemo(
    () =>
      officialAgents.toSorted((left, right) => {
        const leftIsAionrs = left.agent_type === 'aionrs' || left.backend === 'aionrs';
        const rightIsAionrs = right.agent_type === 'aionrs' || right.backend === 'aionrs';
        if (leftIsAionrs !== rightIsAionrs) {
          return leftIsAionrs ? -1 : 1;
        }
        // Strategic partner: pin Kimi right after the builtin aionrs agent.
        const leftIsKimi = left.backend === 'kimi';
        const rightIsKimi = right.backend === 'kimi';
        if (leftIsKimi !== rightIsKimi) {
          return leftIsKimi ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      }),
    [officialAgents]
  );
  const connectionSummary = getAgentConnectionSummary(connectionAgents);
  const eligibleInstalledCount = connectionAgents.filter((agent) => agent.installed && agent.enabled !== false).length;
  const visibleOfficialAgents = filterAgentsForConnectionCenter(
    sortedOfficialAgents.filter(matchesAgentSearch),
    agentFilter
  );
  const visibleCustomAgents = filterAgentsForConnectionCenter(customAgents.filter(matchesAgentSearch), agentFilter);

  const openCustomAgentEditor = useCallback(() => {
    setEditingAgent(null);
    setEditorVisible(true);
  }, []);

  const openAgentConfig = useCallback(
    (agentId: string) => {
      navigate(`/settings/agent/${agentId}/repair`);
    },
    [navigate]
  );

  // Manual "test connection": runs the live ACP probe (initialize +
  // session/new) and refreshes the catalog so the card reflects the new
  // status immediately (F2-02: three states stay clickable, in-progress
  // feedback, recover-on-success).
  const handleTestConnection = useCallback(
    async (agentId: string) => {
      try {
        setTestingAgentId(agentId);
        const result = await ipcBridge.acpConversation.checkManagedAgentHealthById.invoke({ id: agentId });
        await refreshCatalog();
        switch (result.status) {
          case 'online':
            Message.success(t('settings.agentManagement.testConnectionOnline', { name: result.name }));
            break;
          case 'missing':
            Message.warning(t('settings.agentManagement.testConnectionMissing', { name: result.name }));
            break;
          case 'offline':
            // auth_required is offline-with-a-reason: surface the diagnostic
            // (which carries the "needs sign-in" guidance) when present.
            Message.warning(
              formatManagedAgentDiagnosticMessage(t, result) ||
                (result.last_check_error_code === 'auth_required'
                  ? t('settings.agentManagement.testConnectionAuth', { name: result.name })
                  : t('settings.agentManagement.testConnectionOffline', { name: result.name }))
            );
            break;
          default:
            break;
        }
      } catch (error) {
        console.error('test managed agent failed:', error);
        Message.error(t('settings.agentManagement.testConnectionError'));
      } finally {
        setTestingAgentId(null);
      }
    },
    [refreshCatalog, t]
  );

  const handleCheckInstalledAgents = useCallback(async () => {
    if (bulkCheckProgress || eligibleInstalledCount === 0) return;

    setBulkCheckProgress({ current: 0, total: eligibleInstalledCount });
    try {
      const result = await runInstalledAgentChecks(
        connectionAgents,
        (agent) => ipcBridge.acpConversation.checkManagedAgentHealthById.invoke({ id: agent.id }),
        setBulkCheckProgress
      );
      await refreshCatalog();

      if (result.failedRequests > 0) {
        Message.warning(
          t('settings.agentManagement.bulkCheckRequestFailure', {
            count: result.failedRequests,
          })
        );
      } else if (result.attention > 0) {
        Message.warning(
          t('settings.agentManagement.bulkCheckAttention', {
            count: result.attention,
          })
        );
      } else {
        Message.success(t('settings.agentManagement.bulkCheckSuccess', { count: result.online }));
      }
    } catch (error) {
      console.error('check installed agents failed:', error);
      Message.error(t('settings.agentManagement.bulkCheckError'));
    } finally {
      setBulkCheckProgress(null);
    }
  }, [bulkCheckProgress, connectionAgents, eligibleInstalledCount, refreshCatalog, t]);

  return (
    <div data-testid='agent-management-page' className='flex flex-col gap-16px'>
      <SettingsPageHeader
        data-testid='agent-management-header'
        title={t('settings.agentManagement.connectionCenterTitle')}
        description={
          <>
            <span>{t('settings.agentManagement.connectionCenterDescription')} </span>
            <Button
              type='text'
              size='mini'
              className='!h-auto !p-0 !align-baseline !text-13px !font-normal !text-primary-6 hover:!text-primary-7 hover:!underline underline-offset-2'
              onClick={() => {
                void openExternalUrl(LOCAL_AGENT_SETUP_GUIDE_URL).catch(console.error);
              }}
            >
              {t('settings.agentManagement.localAgentsSetupLink')}
            </Button>
          </>
        }
        actions={
          <>
            <Button
              data-testid='agent-check-installed'
              type='primary'
              size='small'
              icon={<Refresh theme='outline' size='14' />}
              loading={bulkCheckProgress !== null}
              disabled={eligibleInstalledCount === 0}
              onClick={() => void handleCheckInstalledAgents()}
              className='!h-32px !rounded-8px !px-12px'
            >
              {bulkCheckProgress
                ? t('settings.agentManagement.checkingInstalledProgress', bulkCheckProgress)
                : t('settings.agentManagement.checkInstalled')}
            </Button>
            {!isMobile && (
              <AionSearchInput
                className='shrink-0 w-[200px] hidden md:flex'
                data-testid='input-search-agents'
                placeholder={t('settings.agentManagement.searchPlaceholder', { defaultValue: 'Search agents...' })}
                value={searchQuery}
                onChange={setSearchQuery}
              />
            )}
            <TalkToButlerButton
              label={t('settings.agentManagement.addCustomAgent', { defaultValue: 'Add custom Agent' })}
              chatLabel={t('settings.talkToButler.addViaChat', { defaultValue: 'Add via chat' })}
              onManual={openCustomAgentEditor}
              manualLabel={t('settings.talkToButler.addManually', { defaultValue: 'Add manually' })}
              prompt={t('settings.talkToButler.prompt.addCustomAgent', {
                defaultValue: 'Help me add a custom Agent.',
              })}
              data-testid='btn-add-custom-agent'
            />
          </>
        }
        tabs={[
          {
            key: 'installed',
            label: t('settings.agentManagement.filterInstalled'),
            count: connectionSummary.installed,
          },
          {
            key: 'group-ready',
            label: t('settings.agentManagement.filterGroupReady'),
            count: connectionSummary.groupReady,
          },
          {
            key: 'attention',
            label: t('settings.agentManagement.filterAttention'),
            count: connectionSummary.attention,
          },
          {
            key: 'all',
            label: t('settings.agentManagement.filterAll', { defaultValue: 'All' }),
            count: connectionAgents.length,
          },
        ]}
        activeTab={agentFilter}
        onTabChange={(key) => setAgentFilter(key as AgentConnectionFilter)}
      />

      <div
        data-testid='agent-connection-summary'
        className='grid grid-cols-2 gap-px overflow-hidden rounded-8px border border-border-2 bg-border-2 md:grid-cols-4'
      >
        {[
          {
            key: 'installed',
            label: t('settings.agentManagement.summaryInstalled'),
            value: connectionSummary.installed,
            valueClass: 'text-t-primary',
          },
          {
            key: 'connected',
            label: t('settings.agentManagement.summaryConnected'),
            value: connectionSummary.connected,
            valueClass: 'text-success-6',
          },
          {
            key: 'attention',
            label: t('settings.agentManagement.summaryAttention'),
            value: connectionSummary.attention,
            valueClass: 'text-warning-6',
          },
          {
            key: 'group-ready',
            label: t('settings.agentManagement.summaryGroupReady'),
            value: connectionSummary.groupReady,
            valueClass: 'text-primary-6',
          },
        ].map((item) => (
          <div
            key={item.key}
            data-testid={`agent-connection-summary-${item.key}`}
            className='flex min-h-54px items-baseline justify-between gap-10px bg-1 px-14px py-12px'
          >
            <span className='text-12px text-t-secondary'>{item.label}</span>
            <span className={`text-20px font-600 leading-none ${item.valueClass}`}>{item.value}</span>
          </div>
        ))}
      </div>

      {isRefreshing ? (
        <div className='text-11px text-t-tertiary'>{t('settings.agentManagement.refreshingStatuses')}</div>
      ) : null}

      {/* Detected Agents section */}
      <div data-testid='agent-management-official-section'>
        <div className='flex flex-col gap-8px rounded-12px border border-border-2 bg-2 p-8px md:rounded-16px md:p-10px'>
          {visibleOfficialAgents.map((agent) => (
            <AgentCard
              key={agent.id}
              type='official'
              agent={agent}
              boundAssistants={getBoundAssistants(agent, assistants)}
              onTestConnection={() => void handleTestConnection(agent.id)}
              onConfigure={() => openAgentConfig(agent.id)}
              isTesting={testingAgentId === agent.id}
            />
          ))}
          {visibleOfficialAgents.length === 0 && (
            <Typography.Text type='secondary' className='block py-16px text-center text-12px'>
              {normalizedSearchQuery || (agentFilter !== 'all' && agentFilter !== 'installed')
                ? t('settings.agentManagement.noSearchResults', { defaultValue: 'No matching agents.' })
                : agentFilter === 'installed'
                  ? t('settings.agentManagement.noInstalledAgents')
                  : t('settings.agentManagement.localAgentsEmpty')}
            </Typography.Text>
          )}
        </div>
      </div>

      {/* Custom Agents section */}
      <div data-testid='agent-management-custom-header' className='flex flex-col gap-2px'>
        <Typography.Text className='text-13px font-medium text-t-secondary block'>
          {t('settings.agentManagement.customAgents', { defaultValue: 'Custom Agents' })}
        </Typography.Text>
        <Typography.Text className='block text-12px text-t-tertiary'>
          {t('settings.agentManagement.customEmptyDescription')}
        </Typography.Text>
      </div>

      <AionModal
        visible={editorVisible}
        onCancel={() => {
          setEditorVisible(false);
          setEditingAgent(null);
        }}
        header={{
          title: editingAgent
            ? t('settings.agentManagement.editCustomAgent')
            : t('settings.agentManagement.detectCustomAgent'),
          showClose: true,
        }}
        footer={null}
        style={{ maxWidth: '92vw', borderRadius: 16 }}
        contentStyle={{
          background: 'var(--dialog-fill-0)',
          borderRadius: 16,
          padding: '20px 24px 16px',
          overflow: 'auto',
        }}
      >
        {/* Conditional mount + key unmounts the editor on close so the
            next `创建自定义 Agent` click always starts from a blank form.
            The inner useEffect([agent]) only resets when the `agent`
            reference changes; two consecutive `null` values would not
            retrigger it. */}
        {editorVisible && (
          <InlineAgentEditor
            key={editingAgent?.id ?? 'new'}
            agent={editingAgent}
            onSave={(agent) => void handleSaveCustomAgent(agent)}
            onCancel={() => {
              setEditorVisible(false);
              setEditingAgent(null);
            }}
          />
        )}
      </AionModal>

      <div data-testid='agent-management-custom-section'>
        <div className='flex flex-col gap-8px rounded-12px border border-border-2 bg-2 p-8px md:rounded-16px md:p-10px'>
          {visibleCustomAgents?.map((agent) => (
            <AgentCard
              key={agent.id}
              type='custom'
              agent={agent}
              boundAssistants={getBoundAssistants(agent, assistants)}
              onTestConnection={() => void handleTestConnection(agent.id)}
              onConfigure={() => openAgentConfig(agent.id)}
              isTesting={testingAgentId === agent.id}
              onEdit={() => {
                setEditingAgent(agent);
                setEditorVisible(true);
              }}
              onDelete={() => void handleDeleteCustomAgent(agent.id)}
              onToggle={(enabled) => void handleToggleCustomAgent(agent.id, enabled)}
            />
          ))}
          {visibleCustomAgents.length === 0 ? (
            <Typography.Text type='secondary' className='block py-12px text-center text-12px'>
              {normalizedSearchQuery || (agentFilter !== 'all' && customAgents.length > 0)
                ? t('settings.agentManagement.noSearchResults', { defaultValue: 'No matching agents.' })
                : t('settings.agentManagement.customEmpty')}
            </Typography.Text>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default LocalAgents;
