/**
 * @license
 * Copyright 2025 SearchT Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { SkillLifecycleClient, SkillSourceReference } from '@/common/types/searcht/skillConsolidation';
import { iconColors } from '@/renderer/styles/colors';
import { useUpdateConversationArtifactStatus } from '@renderer/pages/conversation/Messages/artifacts';
import { Button, Message } from '@arco-design/web-react';
import { Down, Inbox, Lightning, Up } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import MarkdownView from '@renderer/components/Markdown';
import { skillLifecycleClient } from '@renderer/pages/settings/SkillsSettings/consolidation/skillLifecycleClient';
import type { SkillSuggestion } from '@renderer/utils/chat/skillSuggestParser';

export interface SkillSuggestCardProps {
  artifact_id: string;
  conversation_id: string;
  suggestion: SkillSuggestion;
  cron_job_id: string;
  client?: SkillLifecycleClient;
  onNavigate?: (path: string) => void;
}

const CODE_STYLE = { marginTop: 4, marginBlock: 4 };

const SkillSuggestCard: React.FC<SkillSuggestCardProps> = ({
  artifact_id,
  conversation_id,
  suggestion,
  cron_job_id,
  client = skillLifecycleClient,
  onNavigate,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const updateArtifactStatus = useUpdateConversationArtifactStatus();
  const [saving, setSaving] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [queued, setQueued] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const go = useCallback(
    (path: string) => {
      if (onNavigate) onNavigate(path);
      else void navigate(path);
    },
    [navigate, onNavigate]
  );

  // Check if skill already exists on mount (persists across navigation)
  useEffect(() => {
    if (!cron_job_id) return;
    ipcBridge.cron.hasSkill
      .invoke({ job_id: cron_job_id })
      .then((exists) => {
        if (exists) setSaved(true);
      })
      .catch(() => {});
  }, [cron_job_id]);

  if (dismissed || saved || queued) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await ipcBridge.cron.saveSkill.invoke({ job_id: cron_job_id, content: suggestion.content });
      updateArtifactStatus(artifact_id, 'saved');
      setSaved(true);
      Message.success(t('cron.skill.saveSuccess'));
    } catch (err) {
      Message.error(t('cron.skill.saveFailed'));
      console.error('[SkillSuggestCard] Failed to save skill:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleAddToReview = async () => {
    setQueueing(true);
    try {
      const sourceReferences: SkillSourceReference[] = [
        { kind: 'conversation', id: conversation_id, label: suggestion.name },
      ];
      if (cron_job_id) sourceReferences.push({ kind: 'cron', id: cron_job_id, label: suggestion.name });
      const candidate = await client.submitCandidate({
        operationId: `skill-suggestion:${artifact_id}`,
        proposedName: suggestion.name,
        description: suggestion.description,
        content: suggestion.content,
        requiredTools: [],
        permissions: [],
        reason: 'Conversation skill suggestion',
        sourceReferences,
      });

      try {
        await ipcBridge.conversation.updateArtifact.invoke({
          conversation_id,
          artifact_id,
          status: 'saved',
        });
      } catch (statusError) {
        console.error('[SkillSuggestCard] Failed to persist artifact status:', statusError);
      }
      updateArtifactStatus(artifact_id, 'saved');
      setQueued(true);
      Message.success(t('personal.skillConsolidation.queuedSuccess', { defaultValue: 'Added to pending review' }));
      go(`/settings/skills/review/${encodeURIComponent(candidate.id)}`);
    } catch (candidateError) {
      Message.error(
        t('personal.skillConsolidation.queuedFailed', { defaultValue: 'Could not add this skill for review' })
      );
      console.error('[SkillSuggestCard] Failed to create skill candidate:', candidateError);
    } finally {
      setQueueing(false);
    }
  };

  return (
    <div
      data-testid='skill-suggest-card'
      className='mt-8px p-12px rd-8px bg-fill-0 b-1 b-solid'
      style={{ borderColor: 'color-mix(in srgb, var(--color-border-2) 70%, transparent)' }}
    >
      <div className='flex items-center gap-6px mb-8px'>
        <Lightning theme='filled' size={16} fill={iconColors.warning} />
        <span className='font-500 text-14px'>{t('cron.skill.turnIntoSkill')}</span>
      </div>
      <div className='text-t-primary text-13px mb-4px'>{suggestion.name}</div>
      <div className='text-t-secondary text-12px mb-8px'>{suggestion.description}</div>

      {/* Expandable preview */}
      <div
        className='flex items-center gap-4px text-12px text-t-secondary cursor-pointer hover:text-t-primary mb-8px select-none'
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <Up size={12} /> : <Down size={12} />}
        <span>{t('cron.skill.preview')}</span>
      </div>
      {expanded && (
        <div className='mb-12px p-8px rd-4px bg-bg-3 max-h-240px overflow-y-auto text-12px'>
          <MarkdownView codeStyle={CODE_STYLE}>{`\`\`\`markdown\n${suggestion.content}\n\`\`\``}</MarkdownView>
        </div>
      )}

      <div className='flex flex-wrap gap-8px'>
        <Button
          type='primary'
          size='small'
          icon={<Inbox size={14} />}
          loading={queueing}
          disabled={saving}
          data-testid='skill-suggest-add-review'
          onClick={handleAddToReview}
        >
          {t('personal.skillConsolidation.addToReview', { defaultValue: 'Add to pending review' })}
        </Button>
        {cron_job_id ? (
          <Button
            size='small'
            loading={saving}
            disabled={queueing}
            data-testid='skill-suggest-save-cron'
            onClick={handleSave}
          >
            {t('cron.skill.save')}
          </Button>
        ) : null}
        <Button
          size='small'
          disabled={saving || queueing}
          onClick={async () => {
            try {
              await ipcBridge.conversation.updateArtifact.invoke({
                conversation_id,
                artifact_id,
                status: 'dismissed',
              });
              updateArtifactStatus(artifact_id, 'dismissed');
              setDismissed(true);
            } catch (error) {
              Message.error(t('cron.skill.saveFailed'));
              console.error('[SkillSuggestCard] Failed to dismiss artifact:', error);
            }
          }}
        >
          {t('cron.skill.dismiss')}
        </Button>
      </div>
    </div>
  );
};

export default SkillSuggestCard;
