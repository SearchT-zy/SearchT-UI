/**
 * @license
 * Copyright 2026 SearchT-UI Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  isButlerAssistantId,
  rebrandAssistant,
  rebrandAssistantProfileFields,
  rebrandLegacyText,
  rebrandManagedAgent,
  rebrandSkillCatalogEntry,
  rebrandSkillName,
  restoreBackendSkillName,
} from '@/common/utils/legacyBrandRebrand';
import type { Assistant } from '@/common/types/agent/assistantTypes';

const buildAssistant = (overrides: Partial<Assistant> = {}): Assistant =>
  ({
    id: 'bare:1',
    source: 'generated',
    name: 'Some Agent',
    name_i18n: {},
    description_i18n: {},
    avatar: '/api/assets/logos/tools/coding/codex.svg',
    enabled: true,
    sort_order: 0,
    agent_id: 'agent-1',
    enabled_skills: [],
    custom_skill_names: [],
    disabled_builtin_skills: [],
    context_i18n: {},
    prompts: [],
    prompts_i18n: {},
    models: [],
    ...overrides,
  }) satisfies Assistant;

describe('rebrandLegacyText', () => {
  it('renames the butler across known locale variants', () => {
    expect(rebrandLegacyText('AionUi管家')).toBe('SearchT-UI 管家');
    expect(rebrandLegacyText('AionUi Butler')).toBe('SearchT-UI Butler');
    expect(rebrandLegacyText('Дворецкий AionUi')).toBe('Дворецкий SearchT-UI');
  });

  it('renames the built-in CLI agent', () => {
    expect(rebrandLegacyText('Aion CLI')).toBe('SearchT CLI');
  });

  it('rebrands prose mentions without breaking surrounding text', () => {
    expect(rebrandLegacyText('reach AionUi from your phone')).toBe('reach SearchT-UI from your phone');
    expect(rebrandLegacyText('Configure Aion UI itself')).toBe('Configure SearchT-UI itself');
  });

  it('leaves unrelated text untouched', () => {
    expect(rebrandLegacyText('Claude Code')).toBe('Claude Code');
    expect(rebrandLegacyText(undefined)).toBeUndefined();
  });
});

describe('rebrandAssistant', () => {
  it('rebrands every user-visible field of the upstream butler row', () => {
    const butler = buildAssistant({
      id: 'aionui-assistant',
      source: 'builtin',
      name: 'AionUi Butler',
      name_i18n: { 'zh-CN': 'AionUi管家', 'en-US': 'AionUi Butler' },
      description: 'Your all-in-one AionUi butler',
      description_i18n: { 'en-US': 'Your all-in-one AionUi butler' },
      prompts: ['Set up remote access so I can open AionUi from my phone'],
      prompts_i18n: { 'en-US': ['Set up remote access so I can open AionUi from my phone'] },
      avatar: '/api/assets/logos/brand/aion.svg',
    });

    const rebranded = rebrandAssistant(butler);
    expect(rebranded.name).toBe('SearchT-UI Butler');
    expect(rebranded.name_i18n['zh-CN']).toBe('SearchT-UI 管家');
    expect(rebranded.description).toBe('Your all-in-one SearchT-UI butler');
    expect(rebranded.description_i18n['en-US']).toBe('Your all-in-one SearchT-UI butler');
    expect(rebranded.prompts[0]).toContain('open SearchT-UI from my phone');
    expect(rebranded.prompts_i18n['en-US'][0]).toContain('open SearchT-UI from my phone');
    expect(rebranded.avatar?.startsWith('data:image/svg+xml')).toBe(true);
    // Identity fields must stay untouched — the backend keys off them.
    expect(rebranded.id).toBe('aionui-assistant');
    expect(rebranded.source).toBe('builtin');
  });

  it('renames the generated Aion CLI row but keeps its codex-style avatar', () => {
    const cli = buildAssistant({
      id: 'bare:632f31d2',
      name: 'Aion CLI',
      avatar: '/api/assets/logos/brand/aion.svg',
    });
    const rebranded = rebrandAssistant(cli);
    expect(rebranded.name).toBe('SearchT CLI');
    expect(rebranded.avatar?.startsWith('data:image/svg+xml')).toBe(true);

    const other = buildAssistant({ name: 'Codex CLI' });
    expect(rebrandAssistant(other).avatar).toBe('/api/assets/logos/tools/coding/codex.svg');
  });
});

describe('isButlerAssistantId', () => {
  it('matches both backend generations and the builtin- prefix', () => {
    expect(isButlerAssistantId('aionui-assistant')).toBe(true);
    expect(isButlerAssistantId('searcht-assistant')).toBe(true);
    expect(isButlerAssistantId('builtin-aionui-assistant')).toBe(true);
    expect(isButlerAssistantId('builtin-searcht-assistant')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isButlerAssistantId('bare:632f31d2')).toBe(false);
    expect(isButlerAssistantId(undefined)).toBe(false);
    expect(isButlerAssistantId('')).toBe(false);
  });
});

describe('skill name remapping', () => {
  it('rebrands the four upstream aionui-* builtins', () => {
    expect(rebrandSkillName('aionui-config')).toBe('searcht-config');
    expect(rebrandSkillName('aionui-troubleshooting')).toBe('searcht-troubleshooting');
    expect(rebrandSkillName('aionui-webui-public')).toBe('searcht-webui-public');
    expect(rebrandSkillName('aionui-webui-setup')).toBe('searcht-webui-setup');
    expect(rebrandSkillName('officecli')).toBe('officecli');
  });

  it('restores backend ids losslessly (round-trip)', () => {
    for (const name of ['aionui-config', 'aionui-troubleshooting', 'aionui-webui-public', 'aionui-webui-setup', 'cron', 'pdf']) {
      expect(restoreBackendSkillName(rebrandSkillName(name))).toBe(name);
    }
  });

  it('rebrands catalog entries name + description + relative location', () => {
    const entry = rebrandSkillCatalogEntry({
      name: 'aionui-config',
      description: 'Configure AionUi itself through the bundled aioncore config CLI',
      location: 'C:/corpus/aionui-config',
      relative_location: 'auto-inject/aionui-config/SKILL.md',
      is_auto_inject: true,
      is_custom: false,
      source: 'builtin' as const,
    });
    expect(entry.name).toBe('searcht-config');
    expect(entry.description).not.toMatch(/aion/i);
    // Absolute path stays functional for fs operations.
    expect(entry.location).toBe('C:/corpus/aionui-config');
  });

  it('rebrands skill-id arrays on assistant rows', () => {
    const row = rebrandAssistant(
      buildAssistant({
        enabled_skills: ['aionui-config', 'officecli'],
        disabled_builtin_skills: ['aionui-webui-setup'],
      })
    );
    expect(row.enabled_skills).toEqual(['searcht-config', 'officecli']);
    expect(row.disabled_builtin_skills).toEqual(['searcht-webui-setup']);
  });

  it('rebrands skill-id arrays and builtin rule text on assistant details', () => {
    const detail = {
      id: 'aionui-assistant',
      source: 'builtin',
      profile: { name: 'AionUi管家' },
      enabled_skills: ['aionui-config'],
      defaults: { skills: { mode: 'fixed' as const, value: ['aionui-config', 'pdf'] } },
      preferences: { last_skill_ids: ['aionui-troubleshooting'], last_disabled_builtin_skill_ids: null },
      capabilities: { default_skill_ids: ['aionui-webui-public'], default_disabled_builtin_skill_ids: [] },
      rules: { content: 'You are AionUi\'s built-in butler', storage_mode: 'builtin' as const },
    };
    const out = rebrandAssistantProfileFields(detail);
    expect(out.enabled_skills).toEqual(['searcht-config']);
    expect((out.defaults as { skills: { value: string[] } }).skills.value).toEqual(['searcht-config', 'pdf']);
    expect((out.preferences as { last_skill_ids: string[] }).last_skill_ids).toEqual(['searcht-troubleshooting']);
    expect((out.capabilities as { default_skill_ids: string[] }).default_skill_ids).toEqual(['searcht-webui-public']);
    expect((out.rules as { content: string }).content).not.toMatch(/aion/i);
  });

  it('keeps user-authored rule text verbatim on non-builtin details', () => {
    const detail = {
      id: 'user-1',
      source: 'user',
      profile: { name: 'My writer' },
      rules: { content: 'Call the tool AionUi-config if you must', storage_mode: 'user_file' as const },
    };
    const out = rebrandAssistantProfileFields(detail);
    expect((out.rules as { content: string }).content).toBe('Call the tool AionUi-config if you must');
  });
});

describe('rebrandManagedAgent', () => {
  it('rebrands agent names, icons and status guidance across the row', () => {
    const agent = rebrandManagedAgent({
      id: 'bare:632f31d2',
      name: 'Aion CLI',
      icon: '/api/assets/logos/brand/aion.svg',
      agent_type: 'aionrs',
      last_check_guidance:
        'The installed claude is newer than the version AionUi verified. It should still work.',
      available_commands: [{ name: 'agent-reach', description: 'route through the AionUi browser' }],
      native_skills_dirs: ['.aionrs/skills'],
    });

    expect(agent.name).toBe('SearchT CLI');
    expect(agent.icon?.startsWith('data:image/svg+xml')).toBe(true);
    expect(agent.last_check_guidance).not.toMatch(/aion/i);
    expect(agent.available_commands[0].name).toBe('agent-reach');
    expect(agent.available_commands[0].description).toBe('route through the SearchT-UI browser');
    // Functional discriminants and real paths must survive verbatim.
    expect(agent.agent_type).toBe('aionrs');
    expect(agent.id).toBe('bare:632f31d2');
    expect(agent.native_skills_dirs).toEqual(['.aionrs/skills']);
  });
});
