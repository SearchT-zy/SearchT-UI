/**
 * @license
 * Copyright 2026 SearchT-UI Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  isButlerAssistantId,
  rebrandAvatar,
  rebrandLegacyText,
  rebrandManagedAgent,
  rebrandSkillName,
} from '@/common/utils/legacyBrandRebrand';

describe('rebrandLegacyText', () => {
  it('renames the butler across known locale variants', () => {
    expect(rebrandLegacyText('AionUi管家')).toBe('SearchT-UI 管家');
    expect(rebrandLegacyText('AionUi Butler')).toBe('SearchT-UI Butler');
    expect(rebrandLegacyText('Дворецкий AionUi')).toBe('Дворецкий SearchT-UI');
  });

  it('renames the built-in CLI agent and upstream binary name', () => {
    expect(rebrandLegacyText('Aion CLI')).toBe('SearchT CLI');
    expect(rebrandLegacyText('through the bundled aioncore config CLI')).toBe(
      'through the bundled searcht-backend config CLI'
    );
  });

  it('rebrands prose mentions and lowercase skill cross-references', () => {
    expect(rebrandLegacyText('reach AionUi from your phone')).toBe('reach SearchT-UI from your phone');
    expect(rebrandLegacyText('Configure Aion UI itself')).toBe('Configure SearchT-UI itself');
    expect(rebrandLegacyText('Distinct from aionui-webui-setup (covers LAN)')).toBe(
      'Distinct from searcht-webui-setup (covers LAN)'
    );
  });

  it('leaves unrelated text and runtime identifiers untouched', () => {
    expect(rebrandLegacyText('Claude Code')).toBe('Claude Code');
    expect(rebrandLegacyText('.aionrs/skills')).toBe('.aionrs/skills');
    expect(rebrandLegacyText(undefined)).toBeUndefined();
  });
});

describe('rebrandSkillName', () => {
  it('maps the four upstream builtins and passes everything else through', () => {
    expect(rebrandSkillName('aionui-config')).toBe('searcht-config');
    expect(rebrandSkillName('aionui-troubleshooting')).toBe('searcht-troubleshooting');
    expect(rebrandSkillName('aionui-webui-public')).toBe('searcht-webui-public');
    expect(rebrandSkillName('aionui-webui-setup')).toBe('searcht-webui-setup');
    expect(rebrandSkillName('officecli')).toBe('officecli');
  });
});

describe('rebrandAvatar', () => {
  it('swaps upstream brand marks for the SearchT mark', () => {
    expect(rebrandAvatar('/api/assets/logos/brand/aion.svg')?.startsWith('data:image/svg+xml')).toBe(true);
    expect(rebrandAvatar('/api/assistants/aionui-assistant/avatar?v=1')?.startsWith('data:image/svg+xml')).toBe(
      true
    );
  });

  it('keeps third-party icons and uploads', () => {
    expect(rebrandAvatar('/api/assets/logos/tools/coding/codex.svg')).toBe('/api/assets/logos/tools/coding/codex.svg');
    expect(rebrandAvatar(undefined)).toBeUndefined();
  });
});

describe('isButlerAssistantId', () => {
  it('matches both backend generations and the builtin- prefix', () => {
    expect(isButlerAssistantId('aionui-assistant')).toBe(true);
    expect(isButlerAssistantId('searcht-assistant')).toBe(true);
    expect(isButlerAssistantId('builtin-aionui-assistant')).toBe(true);
    expect(isButlerAssistantId('bare:632f31d2')).toBe(false);
    expect(isButlerAssistantId(undefined)).toBe(false);
  });
});

describe('rebrandManagedAgent', () => {
  it('rebrands agent names, icons and runtime guidance across the row', () => {
    const agent = rebrandManagedAgent({
      id: 'bare:632f31d2',
      name: 'Aion CLI',
      icon: '/api/assets/logos/brand/aion.svg',
      agent_type: 'aionrs',
      last_check_guidance: 'newer than the version AionUi verified. It should still work.',
      available_commands: [{ name: 'agent-reach', description: 'route through the AionUi browser' }],
      native_skills_dirs: ['.aionrs/skills'],
    });

    expect(agent.name).toBe('SearchT CLI');
    expect(agent.icon?.startsWith('data:image/svg+xml')).toBe(true);
    expect(agent.last_check_guidance).not.toMatch(/aion/i);
    expect(agent.available_commands[0].name).toBe('agent-reach');
    expect(agent.available_commands[0].description).toBe('route through the SearchT-UI browser');
    // Functional discriminants and real paths survive verbatim.
    expect(agent.agent_type).toBe('aionrs');
    expect(agent.id).toBe('bare:632f31d2');
    expect(agent.native_skills_dirs).toEqual(['.aionrs/skills']);
  });
});
