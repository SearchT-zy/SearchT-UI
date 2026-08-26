/**
 * @license
 * Copyright 2026 SearchT-UI Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Display-layer rebranding for backend-owned catalog rows.
 *
 * The built-in assistant/agent catalog ships inside the upstream backend
 * binary ("Aion CLI", "AionUi管家" / "AionUi Butler"), and the backend rejects
 * renames on those rows (PUT name → Forbidden, builtin rule writes →
 * BAD_REQUEST). Until the backend manifest carries SearchT branding, the only
 * desktop-controlled seam is the HTTP response layer: every name/description/
 * prompt the backend serves is passed through {@link rebrandLegacyText} before
 * it reaches the renderer. The underlying rows stay untouched, so nothing here
 * fights the backend's own migrations on upgrade.
 */

import type { Assistant } from '@/common/types/agent/assistantTypes';

/** Ordered longest-first so "AionUi管家" wins over the bare "AionUi" pass. */
const TEXT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/AionUi管家/g, 'SearchT-UI 管家'],
  [/AionUi Butler/g, 'SearchT-UI Butler'],
  [/Aion\s?UI/g, 'SearchT-UI'],
  [/AionUi/g, 'SearchT-UI'],
  [/Aion CLI/g, 'SearchT CLI'],
  // Upstream backend/binary name ("aioncore config CLI" in skill copy).
  [/aioncore/gi, 'searcht-backend'],
  // Lowercase skill-name cross-references inside descriptions.
  [/aionui-/gi, 'searcht-'],
];

export function rebrandLegacyText(input: string | undefined): string | undefined {
  if (!input) return input;
  let out = input;
  for (const [pattern, replacement] of TEXT_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function rebrandRecord(record: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!record) return record;
  const out: Record<string, string> = {};
  for (const [locale, value] of Object.entries(record)) {
    out[locale] = rebrandLegacyText(value) ?? value;
  }
  return out;
}

function rebrandStringList(list: string[] | undefined): string[] | undefined {
  if (!list) return list;
  return list.map((entry) => rebrandLegacyText(entry) ?? entry);
}

/**
 * Inline brand mark for upstream avatar URLs (e.g. /api/assets/logos/brand/
 * aion.svg). A data URI keeps the mapping usable from both main and renderer
 * processes — no bundler asset import, no extra HTTP hop.
 */
const BRAND_AVATAR_DATA_URI =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none">' +
      '<rect x="4" y="4" width="72" height="72" rx="16" fill="#191928"/>' +
      '<circle cx="40" cy="40" r="22" stroke="#ffffff" stroke-width="4.5" fill="none"/>' +
      '<path d="M30 33 h20 M40 33 v15" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>'
  );

function rebrandAvatar(avatar: string | undefined): string | undefined {
  if (!avatar) return avatar;
  // Only upstream brand marks are swapped; assistant-uploaded avatars and
  // backend icons for third-party agents (claude.svg, codex.svg…) pass
  // through untouched. The butler's own avatar endpoint serves the upstream
  // logo from the backend's assets, so redirect that too.
  if (avatar.includes('/brand/aion') || /^\/api\/assistants\/(?:builtin-)?(?:aionui|searcht)-assistant\/avatar/.test(avatar)) {
    return BRAND_AVATAR_DATA_URI;
  }
  return avatar;
}

// ---------------------------------------------------------------------------
// Skill-name remapping (two-way)
// ---------------------------------------------------------------------------
// Skill names double as identifiers referenced by assistants' enabled_skills,
// conversation overrides and materialization calls. The upstream corpus seeds
// four `aionui-*` builtins whose names surface in every skill picker, so they
// are rebranded on the way OUT (display) and restored on the way IN (backend
// writes) — a one-way rename would strand selections against unknown ids.

const SKILL_NAME_REBRAND: Record<string, string> = {
  'aionui-config': 'searcht-config',
  'aionui-troubleshooting': 'searcht-troubleshooting',
  'aionui-webui-public': 'searcht-webui-public',
  'aionui-webui-setup': 'searcht-webui-setup',
};

const SKILL_NAME_RESTORE: Record<string, string> = Object.fromEntries(
  Object.entries(SKILL_NAME_REBRAND).map(([backendName, displayName]) => [displayName, backendName])
);

export function rebrandSkillName(name: string): string {
  return SKILL_NAME_REBRAND[name] ?? name;
}

export function restoreBackendSkillName(name: string): string {
  return SKILL_NAME_RESTORE[name] ?? name;
}

export function rebrandSkillNameList(list: string[] | undefined | null): string[] | undefined {
  return list ? list.map(rebrandSkillName) : (list as string[] | undefined);
}

export function restoreBackendSkillNameList(list: string[] | undefined | null): string[] | undefined {
  return list ? list.map(restoreBackendSkillName) : (list as string[] | undefined);
}

/** Skill catalog rows shown in the skills hub and every skill picker. */
export function rebrandSkillCatalogEntry<
  T extends { name: string; description?: string; relative_location?: string },
>(entry: T): T {
  return {
    ...entry,
    name: rebrandSkillName(entry.name),
    description: rebrandLegacyText(entry.description),
    relative_location: rebrandLegacyText(entry.relative_location),
  };
}

export function rebrandAssistant<T extends Assistant>(assistant: T): T {
  return {
    ...assistant,
    name: rebrandLegacyText(assistant.name) ?? assistant.name,
    name_i18n: rebrandRecord(assistant.name_i18n) ?? assistant.name_i18n,
    description: rebrandLegacyText(assistant.description),
    description_i18n: rebrandRecord(assistant.description_i18n) ?? assistant.description_i18n,
    context: rebrandLegacyText(assistant.context),
    context_i18n: rebrandRecord(assistant.context_i18n) ?? assistant.context_i18n,
    prompts: rebrandStringList(assistant.prompts) ?? assistant.prompts,
    prompts_i18n:
      assistant.prompts_i18n &&
      Object.fromEntries(
        Object.entries(assistant.prompts_i18n).map(([locale, list]) => [locale, rebrandStringList(list) ?? list])
      ),
    avatar: rebrandAvatar(assistant.avatar),
    enabled_skills: rebrandSkillNameList(assistant.enabled_skills) ?? assistant.enabled_skills,
    custom_skill_names: rebrandSkillNameList(assistant.custom_skill_names) ?? assistant.custom_skill_names,
    disabled_builtin_skills: rebrandSkillNameList(assistant.disabled_builtin_skills) ?? assistant.disabled_builtin_skills,
  };
}

export function rebrandAssistantList<T extends Assistant>(assistants: T[] | undefined): T[] | undefined {
  return assistants?.map(rebrandAssistant);
}

/** AssistantDetail carries the user-visible copy under `profile`. */
export function rebrandAssistantProfileFields<T extends { profile?: unknown; source?: string }>(detail: T): T {
  const profile = detail.profile as
    | { name?: string; name_i18n?: Record<string, string>; description?: string; description_i18n?: Record<string, string>; avatar?: string }
    | undefined;
  const withProfile =
    profile && typeof profile === 'object'
      ? {
          ...detail,
          profile: {
            ...profile,
            name: rebrandLegacyText(profile.name) ?? profile.name,
            name_i18n: rebrandRecord(profile.name_i18n) ?? profile.name_i18n,
            description: rebrandLegacyText(profile.description),
            description_i18n: rebrandRecord(profile.description_i18n) ?? profile.description_i18n,
            avatar: rebrandAvatar(profile.avatar),
          },
        }
      : detail;
  return rebrandAssistantDetailInternals(withProfile);
}

/**
 * Rebrand the skill-id arrays embedded in an AssistantDetail (defaults /
 * preferences / capabilities) plus, for built-in rows, the upstream rule text.
 * Skill-id arrays MUST be rebranded on read — pickers intersect them with the
 * (rebranded) skills catalog, so leaving raw ids here would deselect every
 * aionui-* skill in the editor.
 */
function rebrandAssistantDetailInternals<T extends Record<string, unknown>>(detail: T): T {
  const out: Record<string, unknown> = { ...detail };

  if (Array.isArray(detail.enabled_skills)) out.enabled_skills = rebrandSkillNameList(detail.enabled_skills);
  if (Array.isArray(detail.custom_skill_names)) out.custom_skill_names = rebrandSkillNameList(detail.custom_skill_names);

  const defaults = detail.defaults as
    | { skills?: { value?: string[] | null } }
    | undefined;
  if (defaults?.skills && Array.isArray(defaults.skills.value)) {
    out.defaults = { ...defaults, skills: { ...defaults.skills, value: rebrandSkillNameList(defaults.skills.value) } };
  }

  const preferences = detail.preferences as
    | { last_skill_ids?: string[] | null; last_disabled_builtin_skill_ids?: string[] | null }
    | undefined;
  if (preferences) {
    out.preferences = {
      ...preferences,
      ...(Array.isArray(preferences.last_skill_ids)
        ? { last_skill_ids: rebrandSkillNameList(preferences.last_skill_ids) }
        : {}),
      ...(Array.isArray(preferences.last_disabled_builtin_skill_ids)
        ? { last_disabled_builtin_skill_ids: rebrandSkillNameList(preferences.last_disabled_builtin_skill_ids) }
        : {}),
    };
  }

  const capabilities = detail.capabilities as
    | { default_skill_ids?: string[] | null; default_disabled_builtin_skill_ids?: string[] | null }
    | undefined;
  if (capabilities) {
    out.capabilities = {
      ...capabilities,
      ...(Array.isArray(capabilities.default_skill_ids)
        ? { default_skill_ids: rebrandSkillNameList(capabilities.default_skill_ids) }
        : {}),
      ...(Array.isArray(capabilities.default_disabled_builtin_skill_ids)
        ? { default_disabled_builtin_skill_ids: rebrandSkillNameList(capabilities.default_disabled_builtin_skill_ids) }
        : {}),
    };
  }

  // Only built-in rows carry upstream rule text; user-authored rules are the
  // user's own words and round-trip through the editor, so they stay verbatim.
  const rules = detail.rules as { content?: string } | undefined;
  if (detail.source === 'builtin' && rules && typeof rules.content === 'string') {
    out.rules = { ...rules, content: rebrandLegacyText(rules.content) ?? rules.content };
  }

  return out as T;
}

/**
 * Backend ids of the built-in butler assistant. The live backend serves
 * `aionui-assistant`; newer upstream builds rename it to `searcht-assistant`
 * (the name this fork's code was written against). Match both, plus the
 * `builtin-` prefix the frontend sometimes carries, so butler features keep
 * working across either backend generation.
 */
const BUTLER_ASSISTANT_IDS = new Set(['aionui-assistant', 'searcht-assistant']);

export function isButlerAssistantId(id: string | undefined | null): boolean {
  if (!id) return false;
  return BUTLER_ASSISTANT_IDS.has(id.replace(/^builtin-/, ''));
}

/**
 * Deep display-layer pass for managed-agent rows. The agent management feed
 * carries user-visible copy in loosely-typed fields (name, icon,
 * last_check_guidance — the "newer than the version AionUi verified" banner —
 * available_commands descriptions…), so walk every string instead of
 * enumerating fields. Identifier-ish values (agent_type "aionrs", ids, skill
 * dir paths) match none of the replacement patterns and pass through
 * untouched; icon/avatar strings get the brand-mark swap.
 */
export function rebrandManagedAgent<T>(agent: T): T {
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') return rebrandLegacyText(value) ?? value;
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        out[key] = (key === 'icon' || key === 'avatar') && typeof entry === 'string' ? rebrandAvatar(entry) : visit(entry);
      }
      return out;
    }
    return value;
  };
  return visit(agent) as T;
}
