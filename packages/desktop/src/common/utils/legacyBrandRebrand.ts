/**
 * @license
 * Copyright 2026 SearchT-UI Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared brand-normalization primitives.
 *
 * The primary defense is now data-level: `process/services/brand/
 * backendBrandScrub.ts` rewrites the backend's own storage (SKILL.md
 * frontmatter + SQLite catalog) on every boot. Two display-side helpers
 * remain for surfaces with no persistent data to rewrite:
 * {@link rebrandManagedAgent} (the agent-center feed carries runtime-generated
 * guidance text like "newer than the version <old-brand> verified") and
 * {@link isButlerAssistantId} (the butler's backend id still carries the
 * legacy prefix in this backend generation).
 */

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

/**
 * Canonical skill-name mapping applied by the data scrubber: the four upstream
 * `aionui-*` builtins are renamed everywhere they are referenced (SKILL.md
 * frontmatter, skills table, assistant default_skill_ids, …). On-disk folder
 * names intentionally keep the legacy ids — the backend re-seeds missing
 * folders by directory name, so renaming them would duplicate every skill.
 */
const SKILL_NAME_REBRAND: Record<string, string> = {
  'aionui-config': 'searcht-config',
  'aionui-troubleshooting': 'searcht-troubleshooting',
  'aionui-webui-public': 'searcht-webui-public',
  'aionui-webui-setup': 'searcht-webui-setup',
};

export function rebrandSkillName(name: string): string {
  return SKILL_NAME_REBRAND[name] ?? name;
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

export function rebrandAvatar(avatar: string | undefined): string | undefined {
  if (!avatar) return avatar;
  // Only upstream brand marks are swapped; assistant-uploaded avatars and
  // backend icons for third-party agents (claude.svg, codex.svg…) pass
  // through untouched.
  if (
    avatar.includes('/brand/aion') ||
    /^\/api\/assistants\/(?:builtin-)?(?:aionui|searcht)-assistant\/avatar/.test(avatar)
  ) {
    return BRAND_AVATAR_DATA_URI;
  }
  return avatar;
}

/**
 * Backend ids of the built-in butler assistant. The live backend serves
 * `aionui-assistant`; newer upstream builds rename it to `searcht-assistant`.
 * Match both, plus the `builtin-` prefix the frontend sometimes carries, so
 * butler features keep working across either backend generation.
 */
const BUTLER_ASSISTANT_IDS = new Set(['aionui-assistant', 'searcht-assistant']);

export function isButlerAssistantId(id: string | undefined | null): boolean {
  if (!id) return false;
  return BUTLER_ASSISTANT_IDS.has(id.replace(/^builtin-/, ''));
}

/**
 * Display pass for the managed-agents feed. Its guidance copy
 * (last_check_guidance — "newer than the version <old-brand> verified") is
 * generated at runtime by the backend, so there is no stored row to scrub;
 * walk every string instead. Identifier-ish values (agent_type, ids, skill
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
        out[key] =
          (key === 'icon' || key === 'avatar') && typeof entry === 'string' ? rebrandAvatar(entry) : visit(entry);
      }
      return out;
    }
    return value;
  };
  return visit(agent) as T;
}
