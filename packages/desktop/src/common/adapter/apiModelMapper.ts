/**
 * @license
 * Copyright 2025 SearchT-UI Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TProviderWithModel } from '../config/storage';
import { rebrandSkillNameList, restoreBackendSkillNameList } from '@/common/utils/legacyBrandRebrand';

export type ApiProviderWithModel = {
  provider_id: string;
  model: string;
  use_model?: string;
};

function hasCompleteModelIdentity(
  model?: TProviderWithModel
): model is TProviderWithModel & { id: string; use_model: string } {
  return Boolean(
    model &&
    typeof model.id === 'string' &&
    model.id.trim().length > 0 &&
    typeof model.use_model === 'string' &&
    model.use_model.trim().length > 0
  );
}

// ── Frontend → Backend ──────────────────────────────────────────────────

export function toApiModel(m: TProviderWithModel): ApiProviderWithModel {
  return {
    provider_id: m.id,
    model: m.use_model,
  };
}

export function toApiModelOptional(m?: TProviderWithModel): ApiProviderWithModel | undefined {
  return hasCompleteModelIdentity(m) ? toApiModel(m) : undefined;
}

/** Minimal shape of a create-conversation request consumed by the body builder. */
export type CreateConversationBodyInput = {
  type?: 'acp' | 'aionrs';
  id?: string;
  name?: string;
  model?: TProviderWithModel;
  assistant?: unknown;
  extra?: unknown;
};

/**
 * Build the HTTP body for `POST /api/conversations`.
 *
 * Top-level `model` is aionrs-only on the backend (spec 2026-05-12); other
 * agent types carry model info via `extra`.
 */
export function buildCreateConversationBody(p: CreateConversationBodyInput): Record<string, unknown> {
  const hasAssistant = p.assistant !== undefined && p.assistant !== null;
  const body: Record<string, unknown> = {
    type: hasAssistant ? undefined : p.type,
    id: p.id,
    name: p.name,
    assistant: hasAssistant ? restoreAssistantSkillFields(p.assistant) : p.assistant,
    extra: restoreExtraSkillFields(p.extra),
  };
  const model = p.type === 'acp' ? undefined : toApiModelOptional(p.model);
  if (model) body.model = model;
  return body;
}

// The skills catalog shows rebranded display names (aionui-* → searcht-*);
// restore the backend ids on the way in so selections still resolve. See
// common/utils/legacyBrandRebrand.ts for the two-way contract.
type AssistantLike = {
  conversation_overrides?: {
    skill_ids?: string[] | null;
    disabled_builtin_skill_ids?: string[] | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

function restoreAssistantSkillFields<T extends AssistantLike>(assistant: T): T {
  const overrides = assistant.conversation_overrides;
  if (!overrides) return assistant;
  return {
    ...assistant,
    conversation_overrides: {
      ...overrides,
      skill_ids: restoreBackendSkillNameList(overrides.skill_ids ?? undefined) ?? overrides.skill_ids,
      disabled_builtin_skill_ids:
        restoreBackendSkillNameList(overrides.disabled_builtin_skill_ids ?? undefined) ??
        overrides.disabled_builtin_skill_ids,
    },
  };
}

type ExtraLike = {
  preset_enabled_skills?: string[] | null;
  exclude_auto_inject_skills?: string[] | null;
  [key: string]: unknown;
};

function restoreExtraSkillFields<T extends ExtraLike>(extra: T | undefined): T | undefined {
  if (!extra) return extra;
  return {
    ...extra,
    preset_enabled_skills:
      restoreBackendSkillNameList(extra.preset_enabled_skills ?? undefined) ?? extra.preset_enabled_skills,
    exclude_auto_inject_skills:
      restoreBackendSkillNameList(extra.exclude_auto_inject_skills ?? undefined) ??
      extra.exclude_auto_inject_skills,
  };
}

// ── Backend → Frontend ──────────────────────────────────────────────────

export function fromApiModel(raw: ApiProviderWithModel): TProviderWithModel {
  return {
    id: raw.provider_id,
    platform: '',
    name: '',
    base_url: '',
    api_key: '',
    use_model: raw.use_model ?? raw.model,
  };
}

function fromApiModelOptional(raw?: ApiProviderWithModel | null): TProviderWithModel | undefined {
  return raw ? fromApiModel(raw) : undefined;
}

export function fromApiConversation<T>(raw: T): T {
  if (!raw || typeof raw !== 'object') return raw;

  const r = raw as T & {
    model?: ApiProviderWithModel | null;
    extra?: Record<string, unknown> | null;
  };
  const next = { ...r } as unknown as T & {
    model?: TProviderWithModel;
    extra?: Record<string, unknown> | null;
  };

  if ('model' in r) {
    next.model = fromApiModelOptional(r.model);
  }

  const extra = r.extra;
  if (extra && typeof extra === 'object') {
    const base = 'custom_workspace' in extra ? { ...extra } : {
      ...extra,
      custom_workspace:
        (typeof extra.workspace === 'string' ? extra.workspace : '').length > 0 &&
        extra.is_temporary_workspace !== true,
    };
    // `extra.skills` is the creation-time skill snapshot shown by the
    // conversation skills indicator; rebrand it so it joins against the
    // (rebranded) skills catalog instead of dangling on legacy ids.
    next.extra = Array.isArray(base.skills)
      ? { ...base, skills: rebrandSkillNameList(base.skills as string[]) }
      : base;
  }

  return next;
}

export function fromApiPaginatedConversations<T>(result: { items: T[]; total: number; has_more: boolean }): {
  items: T[];
  total: number;
  has_more: boolean;
} {
  return {
    ...result,
    items: result.items.map(fromApiConversation),
  };
}
