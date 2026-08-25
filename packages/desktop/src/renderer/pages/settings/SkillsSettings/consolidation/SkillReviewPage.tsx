import { Alert, Button, Form, Input, Modal, Spin, Tag } from '@arco-design/web-react';
import { ArrowLeft, Check, Delete, Save } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import type {
  SkillCandidate,
  SkillCandidateUpdateInput,
  SkillLifecycleClient,
  SkillPublishResult,
} from '@/common/types/searcht/skillConsolidation';
import { validateSkillDraft } from '@/common/searcht/skillValidation';
import CodeEditor from '@/renderer/pages/conversation/Preview/components/editors/CodeEditor';
import SettingsPageWrapper from '../../components/SettingsPageWrapper';
import { skillLifecycleClient } from './skillLifecycleClient';
import { publishSkillDraft, type SkillDraftPublication, type VerifiedSkillPublication } from './skillPublisher';
import styles from './SkillConsolidation.module.css';

export type ReviewSkillPublisher = (
  draft: SkillDraftPublication,
  commit: (publication: VerifiedSkillPublication) => Promise<SkillPublishResult>
) => Promise<{ commitResult: SkillPublishResult }>;

type SkillReviewPageProps = {
  client?: SkillLifecycleClient;
  candidateId?: string;
  publish?: ReviewSkillPublisher;
  onNavigate?: (path: string) => void;
};

type Draft = Pick<
  SkillCandidate,
  'proposedName' | 'description' | 'content' | 'requiredTools' | 'permissions' | 'reason' | 'sourceReferences'
>;

type Confirmation = 'publish-warning' | 'reject' | null;

const defaultPublish: ReviewSkillPublisher = (draft, commit) => publishSkillDraft(draft, commit);

const SkillReviewPage: React.FC<SkillReviewPageProps> = ({
  client = skillLifecycleClient,
  candidateId: candidateIdProp,
  publish = defaultPublish,
  onNavigate,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ candidateId: string }>();
  const candidateId = candidateIdProp ?? params.candidateId ?? '';
  const go = useCallback(
    (path: string) => {
      if (onNavigate) onNavigate(path);
      else void navigate(path);
    },
    [navigate, onNavigate]
  );
  const [candidate, setCandidate] = useState<SkillCandidate | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await client.getCandidate(candidateId);
      if (!loaded) throw new Error('SKILL_CANDIDATE_NOT_FOUND');
      setCandidate(loaded);
      setDraft(toDraft(loaded));
    } catch (loadError) {
      console.error('Failed to load skill candidate:', loadError);
      setError('SKILL_CANDIDATE_LOAD_FAILED');
    } finally {
      setLoading(false);
    }
  }, [candidateId, client]);

  useEffect(() => {
    void load();
  }, [load]);

  const validation = useMemo(
    () =>
      draft
        ? validateSkillDraft({ name: draft.proposedName, description: draft.description, content: draft.content })
        : null,
    [draft]
  );
  const warnings = validation?.issues.filter((issue) => issue.severity === 'warning') ?? [];

  const buildUpdate = (): SkillCandidateUpdateInput => {
    if (!candidate || !draft) throw new Error('SKILL_CANDIDATE_NOT_LOADED');
    return { id: candidate.id, ...draft };
  };

  const save = async (): Promise<SkillCandidate> => {
    setSaving(true);
    setError(null);
    try {
      const updated = await client.updateCandidate(buildUpdate());
      setCandidate(updated);
      setDraft(toDraft(updated));
      return updated;
    } catch (saveError) {
      console.error('Failed to save skill candidate:', saveError);
      setError('SKILL_CANDIDATE_SAVE_FAILED');
      throw saveError;
    } finally {
      setSaving(false);
    }
  };

  const publishCandidate = async () => {
    if (!candidate || !draft || !validation?.valid) return;
    setPublishing(true);
    setError(null);
    try {
      const updated = await save();
      await publish({ name: updated.proposedName, content: updated.content }, () =>
        client.publishCandidate({
          candidateId: updated.id,
          installedSlug: updated.proposedName,
          content: updated.content,
          changeSummary: t('personal.skillConsolidation.initialVersion', { defaultValue: 'Published after review' }),
        })
      );
      go(`/settings/skills/detail/${encodeURIComponent(updated.proposedName)}`);
    } catch (publishError) {
      console.error('Failed to publish skill candidate:', publishError);
      setError('SKILL_CANDIDATE_PUBLISH_FAILED');
    } finally {
      setPublishing(false);
    }
  };

  const requestPublish = () => {
    if (!validation?.valid) return;
    if (!warnings.length) {
      void publishCandidate();
      return;
    }
    setConfirmation('publish-warning');
  };

  const requestReject = () => {
    if (!candidate) return;
    setConfirmation('reject');
  };

  const confirmWarningPublication = async () => {
    await publishCandidate();
    setConfirmation(null);
  };

  const rejectCandidate = async () => {
    if (!candidate) return;
    setRejecting(true);
    setError(null);
    try {
      await client.rejectCandidate(candidate.id);
      go('/settings/skills');
    } catch (rejectError) {
      console.error('Failed to reject skill candidate:', rejectError);
      setError('SKILL_CANDIDATE_REJECT_FAILED');
    } finally {
      setRejecting(false);
      setConfirmation(null);
    }
  };

  return (
    <SettingsPageWrapper>
      <div className='flex flex-col gap-16px' data-testid='skill-review-page'>
        <div className='flex items-center justify-between gap-12px'>
          <Button type='text' icon={<ArrowLeft size={16} />} onClick={() => go('/settings/skills')}>
            {t('personal.skillConsolidation.backToSkills', { defaultValue: 'All skills' })}
          </Button>
          {draft ? (
            <div className='flex items-center gap-8px'>
              <Button
                icon={<Save size={15} />}
                loading={saving}
                disabled={publishing}
                data-testid='skill-review-save'
                onClick={() => void save().catch((): undefined => undefined)}
              >
                {t('common.save', { defaultValue: 'Save' })}
              </Button>
              <Button
                type='primary'
                icon={<Check size={15} />}
                loading={publishing}
                disabled={!validation?.valid || saving}
                data-testid='skill-review-publish'
                onClick={requestPublish}
              >
                {t('personal.skillConsolidation.publish', { defaultValue: 'Publish' })}
              </Button>
            </div>
          ) : null}
        </div>

        <div>
          <h1 className='m-0 text-22px font-700 leading-tight text-t-primary'>
            {t('personal.skillConsolidation.reviewTitle', { defaultValue: 'Review skill' })}
          </h1>
          <p className='m-0 mt-6px text-13px leading-relaxed text-t-secondary'>
            {t('personal.skillConsolidation.reviewDescription', {
              defaultValue: 'Check what this skill can access, edit its instructions, then publish it when ready.',
            })}
          </p>
        </div>

        {error ? (
          <div data-testid='skill-review-error'>
            <Alert
              type='error'
              title={t(`personal.skillConsolidation.errors.${error}`, { defaultValue: error })}
              closable
              onClose={() => setError(null)}
            />
          </div>
        ) : null}

        {loading ? (
          <div className='flex min-h-320px items-center justify-center'>
            <Spin />
          </div>
        ) : !draft || !candidate ? (
          <Alert
            type='error'
            title={t('personal.skillConsolidation.notFound', {
              defaultValue: 'This candidate is no longer available.',
            })}
            action={
              <Button size='small' onClick={() => void load()}>
                {t('common.retry', { defaultValue: 'Retry' })}
              </Button>
            }
          />
        ) : (
          <div className={styles.reviewGrid}>
            <div className='min-w-0'>
              <Form layout='vertical' className='w-full'>
                <div className={styles.identityFields}>
                  <Form.Item label={t('personal.skillConsolidation.skillName', { defaultValue: 'Skill name' })}>
                    <Input
                      aria-label={t('personal.skillConsolidation.skillName', { defaultValue: 'Skill name' })}
                      value={draft.proposedName}
                      onChange={(proposedName) => setDraft((current) => current && { ...current, proposedName })}
                    />
                  </Form.Item>
                  <Form.Item
                    label={t('personal.skillConsolidation.skillDescription', { defaultValue: 'Skill description' })}
                  >
                    <Input
                      aria-label={t('personal.skillConsolidation.skillDescription', {
                        defaultValue: 'Skill description',
                      })}
                      value={draft.description}
                      onChange={(description) => setDraft((current) => current && { ...current, description })}
                    />
                  </Form.Item>
                </div>
                <Form.Item label='SKILL.md'>
                  <div className={styles.editorSurface}>
                    <CodeEditor
                      value={draft.content}
                      onChange={(content) => setDraft((current) => current && { ...current, content })}
                      fileName='SKILL.md'
                      language='markdown'
                    />
                  </div>
                </Form.Item>
              </Form>
            </div>

            <aside
              className={styles.reviewAside}
              aria-label={t('personal.skillConsolidation.validationTitle', { defaultValue: 'Checks' })}
            >
              <div>
                <h2 className='m-0 text-13px font-600 text-t-primary'>
                  {t('personal.skillConsolidation.validationTitle', { defaultValue: 'Checks' })}
                </h2>
                <p className='m-0 mt-4px text-12px leading-relaxed text-t-tertiary'>
                  {t('personal.skillConsolidation.validationDescription', {
                    defaultValue: 'Errors block publishing. Warnings require confirmation.',
                  })}
                </p>
              </div>
              <div className='flex flex-col gap-6px'>
                {!validation?.issues.length ? (
                  <Alert
                    type='success'
                    showIcon
                    content={t('personal.skillConsolidation.validationPassed', {
                      defaultValue: 'Ready to publish',
                    })}
                  />
                ) : (
                  validation.issues.map((issue) => (
                    <Alert
                      key={`${issue.code}-${issue.field}`}
                      type={issue.severity === 'error' ? 'error' : 'warning'}
                      showIcon
                      content={t(`personal.skillConsolidation.validation.${issue.code}`, {
                        defaultValue: issue.code,
                      })}
                    />
                  ))
                )}
              </div>
              <div>
                <div className='mb-6px text-11px font-500 text-t-tertiary'>
                  {t('personal.skillConsolidation.tools', { defaultValue: 'Tools' })}
                </div>
                <div className='flex flex-wrap gap-5px'>
                  {draft.requiredTools.map((tool) => (
                    <Tag key={tool} size='small'>
                      {tool}
                    </Tag>
                  ))}
                </div>
              </div>
              <div>
                <div className='mb-6px text-11px font-500 text-t-tertiary'>
                  {t('personal.skillConsolidation.permissions', { defaultValue: 'Permissions' })}
                </div>
                <div className='flex flex-wrap gap-5px'>
                  {draft.permissions.map((permission) => (
                    <Tag key={permission} size='small' color='orange'>
                      {permission}
                    </Tag>
                  ))}
                </div>
              </div>
              <Button
                type='text'
                status='danger'
                icon={<Delete size={15} />}
                data-testid='skill-review-reject'
                onClick={requestReject}
              >
                {t('personal.skillConsolidation.reject', { defaultValue: 'Do not use' })}
              </Button>
            </aside>
          </div>
        )}
      </div>
      <Modal
        visible={confirmation === 'publish-warning'}
        title={t('personal.skillConsolidation.warningConfirmTitle', { defaultValue: 'Publish with warnings?' })}
        okText={t('personal.skillConsolidation.publishAnyway', { defaultValue: 'Publish anyway' })}
        cancelText={t('common.cancel', { defaultValue: 'Cancel' })}
        confirmLoading={publishing}
        onCancel={() => setConfirmation(null)}
        onOk={confirmWarningPublication}
      >
        {t('personal.skillConsolidation.warningConfirmDescription', {
          defaultValue: 'Review the warnings before publishing this skill.',
        })}
      </Modal>
      <Modal
        visible={confirmation === 'reject'}
        title={t('personal.skillConsolidation.rejectTitle', { defaultValue: 'Do not use this candidate?' })}
        okText={t('personal.skillConsolidation.rejectConfirm', { defaultValue: 'Do not use' })}
        cancelText={t('common.cancel', { defaultValue: 'Cancel' })}
        confirmLoading={rejecting}
        okButtonProps={{ status: 'danger' }}
        onCancel={() => setConfirmation(null)}
        onOk={rejectCandidate}
      >
        {t('personal.skillConsolidation.rejectDescription', {
          defaultValue: 'The draft content will be deleted. A content-free audit record will be kept.',
        })}
      </Modal>
    </SettingsPageWrapper>
  );
};

function toDraft(candidate: SkillCandidate): Draft {
  return {
    proposedName: candidate.proposedName,
    description: candidate.description,
    content: candidate.content,
    requiredTools: candidate.requiredTools,
    permissions: candidate.permissions,
    reason: candidate.reason,
    sourceReferences: candidate.sourceReferences,
  };
}

export default SkillReviewPage;
