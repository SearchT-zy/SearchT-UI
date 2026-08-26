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
  // Only the upstream Aion brand mark is swapped; assistant-uploaded avatars
  // and backend icons for third-party agents (claude.svg, codex.svg…) pass
  // through untouched.
  return avatar.includes('/brand/aion') ? BRAND_AVATAR_DATA_URI : avatar;
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
  };
}

export function rebrandAssistantList<T extends Assistant>(assistants: T[] | undefined): T[] | undefined {
  return assistants?.map(rebrandAssistant);
}

/** AssistantDetail carries the user-visible copy under `profile`. */
export function rebrandAssistantProfileFields<T extends { profile?: unknown }>(detail: T): T {
  const profile = detail.profile as
    | { name?: string; name_i18n?: Record<string, string>; description?: string; description_i18n?: Record<string, string>; avatar?: string }
    | undefined;
  if (!profile || typeof profile !== 'object') return detail;
  return {
    ...detail,
    profile: {
      ...profile,
      name: rebrandLegacyText(profile.name) ?? profile.name,
      name_i18n: rebrandRecord(profile.name_i18n) ?? profile.name_i18n,
      description: rebrandLegacyText(profile.description),
      description_i18n: rebrandRecord(profile.description_i18n) ?? profile.description_i18n,
      avatar: rebrandAvatar(profile.avatar),
    },
  };
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
