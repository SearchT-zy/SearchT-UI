/**
 * @license
 * Copyright 2026 SearchT-UI Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  isButlerAssistantId,
  rebrandAssistant,
  rebrandLegacyText,
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
