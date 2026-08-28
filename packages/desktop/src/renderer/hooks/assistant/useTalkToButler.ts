/**
 * @license
 * Copyright 2025 SearchT Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { isButlerAssistantId } from '@/common/utils/legacyBrandRebrand';
import { globalNavigate } from '@/renderer/utils/navigation';
import { Message } from '@arco-design/web-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { mutate as swrMutate } from 'swr';

/**
 * Resolve the Butler assistant from the catalog. The backend has shipped the
 * butler under different ids across generations (`aionui-assistant` today,
 * `searcht-assistant` in newer upstream builds); match both rather than a
 * single literal.
 */
const findButler = (assistants: Assistant[]): Assistant | undefined => {
  return assistants.find((assistant) => isButlerAssistantId(assistant.id));
};

export type TalkToButlerArgs = {
  /** Prompt pre-filled into the home chat input. */
  prompt: string;
  /** Optional file paths pre-attached to the input (e.g. report screenshots). */
  files?: string[];
};

/**
 * Shared entry point behind every "via chat" action: jump to the home page,
 * select the SearchT Butler, and pre-fill the chat input with a ready-made
 * prompt (and optional attachments). Auto-enables the Butler if the user has
 * disabled it, since clicking the action is an explicit intent to use it.
 *
 * Reuses the home page's `prefillPrompt` navigation contract (added with the
 * scheduled-tasks "create via chat" entry) and extends it with `prefillFiles`.
 * Uses `globalNavigate` rather than `useNavigate` so it is safe to call from
 * components mounted outside the Router (e.g. the global FeedbackReportModal).
 */
export const useTalkToButler = (): ((args: TalkToButlerArgs) => Promise<void>) => {
  const { t } = useTranslation();

  return useCallback(
    async ({ prompt, files }: TalkToButlerArgs) => {
      let selectedAssistantId: string | undefined;

      try {
        const assistants = await ipcBridge.assistants.list.invoke();
        const butler = findButler(assistants);
        if (butler) {
          selectedAssistantId = butler.id;
          if (butler.enabled === false) {
            await ipcBridge.assistants.setState.invoke({ id: butler.id, enabled: true });
            await swrMutate('assistants.list');
            Message.success(
              t('settings.talkToButler.enabledToast', { defaultValue: 'Enabled the SearchT Butler for you' })
            );
          }
        }
      } catch (error) {
        // Non-fatal: fall through to the home page with the prompt pre-filled
        // but no assistant pinned, rather than blocking the user.
        console.error('[talkToButler] failed to resolve/enable butler:', error);
      }

      globalNavigate('/guid', {
        state: {
          selectedAssistantId,
          prefillPrompt: prompt,
          prefillFiles: files,
        },
      });
    },
    [t]
  );
};

export default useTalkToButler;
