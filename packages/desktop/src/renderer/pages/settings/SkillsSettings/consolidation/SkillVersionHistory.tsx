import { ipcBridge } from '@/common';
import type { ManagedSkill, SkillLifecycleClient, SkillVersion } from '@/common/types/searcht/skillConsolidation';
import { Alert, Button, Empty, Modal, Spin, Tag } from '@arco-design/web-react';
import { Check, CloseOne, PreviewOpen, Refresh, Undo } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { skillLifecycleClient } from './skillLifecycleClient';
import {
  publishSkillDraft,
  type SkillDraftPublication,
  type SkillPublicationResult,
  type VerifiedSkillPublication,
} from './skillPublisher';
import styles from './SkillConsolidation.module.css';

export type ManagedSkillPublisher = <T>(
  draft: SkillDraftPublication,
  commit: (publication: VerifiedSkillPublication) => Promise<T>
) => Promise<SkillPublicationResult<T>>;

type Confirmation = { action: 'disable' } | { action: 'enable' } | { action: 'rollback'; version: SkillVersion } | null;

type SkillVersionHistoryProps = {
  managedSkill: ManagedSkill;
  client?: SkillLifecycleClient;
  publish?: ManagedSkillPublisher;
  removeSkill?: (slug: string) => Promise<void>;
  onChanged?: (skill: ManagedSkill) => void | Promise<void>;
};

const defaultPublish: ManagedSkillPublisher = (draft, commit) => publishSkillDraft(draft, commit);
const defaultRemoveSkill = (slug: string) => ipcBridge.fs.deleteSkill.invoke({ skill_name: slug });

const SkillVersionHistory: React.FC<SkillVersionHistoryProps> = ({
  managedSkill: initialManagedSkill,
  client = skillLifecycleClient,
  publish = defaultPublish,
  removeSkill = defaultRemoveSkill,
  onChanged,
}) => {
  const { t, i18n } = useTranslation();
  const [managedSkill, setManagedSkill] = useState(initialManagedSkill);
  const [versions, setVersions] = useState<SkillVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SkillVersion | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);

  useEffect(() => {
    setManagedSkill(initialManagedSkill);
  }, [initialManagedSkill]);

  const loadVersions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.listVersions(initialManagedSkill.id);
      setVersions(result.versions.toSorted((left, right) => right.versionNumber - left.versionNumber));
    } catch (loadError) {
      console.error('Failed to load managed skill versions:', loadError);
      setError('SKILL_VERSIONS_LOAD_FAILED');
    } finally {
      setLoading(false);
    }
  }, [client, initialManagedSkill.id]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  const activeVersion = useMemo(
    () => versions.find((version) => version.id === managedSkill.activeVersionId) ?? null,
    [managedSkill.activeVersionId, versions]
  );

  const applyManagedSkill = async (next: ManagedSkill) => {
    setManagedSkill(next);
    await onChanged?.(next);
  };

  const restoreRuntimeVersion = async (version: SkillVersion) => {
    await publish({ name: managedSkill.slug, content: version.content }, async (): Promise<void> => undefined);
  };

  const disableSkill = async () => {
    if (!activeVersion) throw new Error('SKILL_ACTIVE_VERSION_NOT_FOUND');
    let removed = false;
    try {
      await removeSkill(managedSkill.slug);
      removed = true;
      const next = await client.updateState({ skillId: managedSkill.id, state: 'disabled' });
      await applyManagedSkill(next);
    } catch (actionError) {
      if (removed) await restoreRuntimeVersion(activeVersion).catch((): undefined => undefined);
      throw actionError;
    }
  };

  const enableSkill = async () => {
    if (!activeVersion) throw new Error('SKILL_ACTIVE_VERSION_NOT_FOUND');
    const result = await publish({ name: managedSkill.slug, content: activeVersion.content }, () =>
      client.updateState({ skillId: managedSkill.id, state: 'active' })
    );
    await applyManagedSkill(result.commitResult);
  };

  const rollbackSkill = async (version: SkillVersion) => {
    if (!activeVersion) throw new Error('SKILL_ACTIVE_VERSION_NOT_FOUND');
    try {
      const result = await publish({ name: managedSkill.slug, content: version.content }, () =>
        client.rollback({
          skillId: managedSkill.id,
          versionId: version.id,
          installedSlug: managedSkill.slug,
          changeSummary: t('personal.skillConsolidation.rollbackSummary', {
            number: version.versionNumber,
            defaultValue: 'Rolled back to version {{number}}',
          }),
        })
      );
      await applyManagedSkill(result.commitResult.skill);
      setVersions((current) =>
        [result.commitResult.version, ...current.filter((item) => item.id !== result.commitResult.version.id)].toSorted(
          (left, right) => right.versionNumber - left.versionNumber
        )
      );
    } catch (actionError) {
      if (activeVersion.id !== version.id) {
        await restoreRuntimeVersion(activeVersion).catch((recoveryError) => {
          console.error('Failed to restore active skill version after rollback failure:', recoveryError);
        });
      }
      throw actionError;
    }
  };

  const confirmAction = async () => {
    if (!confirmation) return;
    setBusy(true);
    setError(null);
    try {
      if (confirmation.action === 'disable') await disableSkill();
      else if (confirmation.action === 'enable') await enableSkill();
      else await rollbackSkill(confirmation.version);
    } catch (actionError) {
      console.error('Managed skill action failed:', actionError);
      setError(`SKILL_${confirmation.action.toUpperCase()}_FAILED`);
    } finally {
      setBusy(false);
      setConfirmation(null);
    }
  };

  const confirmationText = getConfirmationText(confirmation, t);

  return (
    <section className='flex flex-col gap-14px' data-testid='skill-version-history'>
      <div className='flex flex-wrap items-center justify-between gap-10px'>
        <div className='flex items-center gap-8px'>
          <h2 className='m-0 text-14px font-600 text-t-primary'>
            {t('personal.skillConsolidation.versionHistory', { defaultValue: 'Version history' })}
          </h2>
          <Tag color={managedSkill.state === 'active' ? 'green' : 'gray'} data-testid='skill-managed-state'>
            {managedSkill.state === 'active'
              ? t('personal.skillConsolidation.stateActive', { defaultValue: 'Active' })
              : t('personal.skillConsolidation.stateDisabled', { defaultValue: 'Disabled' })}
          </Tag>
        </div>
        <Button
          size='small'
          type='text'
          status={managedSkill.state === 'active' ? 'danger' : 'default'}
          icon={managedSkill.state === 'active' ? <CloseOne size={14} /> : <Check size={14} />}
          loading={busy}
          disabled={loading || !activeVersion}
          data-testid={managedSkill.state === 'active' ? 'skill-managed-disable' : 'skill-managed-enable'}
          onClick={() => setConfirmation({ action: managedSkill.state === 'active' ? 'disable' : 'enable' })}
        >
          {managedSkill.state === 'active'
            ? t('personal.skillConsolidation.disable', { defaultValue: 'Disable' })
            : t('personal.skillConsolidation.enable', { defaultValue: 'Enable' })}
        </Button>
      </div>

      {error ? (
        <div data-testid='skill-version-error'>
          <Alert
            type='error'
            title={t(`personal.skillConsolidation.errors.${error}`, { defaultValue: error })}
            action={
              <Button size='small' icon={<Refresh size={14} />} onClick={() => void loadVersions()}>
                {t('common.retry', { defaultValue: 'Retry' })}
              </Button>
            }
          />
        </div>
      ) : null}

      {loading ? (
        <div className='flex min-h-120px items-center justify-center'>
          <Spin />
        </div>
      ) : versions.length === 0 ? (
        <Empty description={t('personal.skillConsolidation.noVersions', { defaultValue: 'No versions yet.' })} />
      ) : (
        <div className={styles.versionList}>
          {versions.map((version) => {
            const isActive = version.id === managedSkill.activeVersionId;
            return (
              <div key={version.id} className={styles.versionRow} data-testid={`skill-version-${version.id}`}>
                <div className={styles.versionMain}>
                  <div className='flex flex-wrap items-center gap-7px'>
                    <span className='text-13px font-600 text-t-primary'>
                      {t('personal.skillConsolidation.versionNumber', {
                        number: version.versionNumber,
                        defaultValue: 'Version {{number}}',
                      })}
                    </span>
                    {isActive ? (
                      <Tag size='small' color='green'>
                        {t('personal.skillConsolidation.currentVersion', { defaultValue: 'Active' })}
                      </Tag>
                    ) : null}
                    <span className='text-11px text-t-tertiary'>
                      {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
                        version.publishedAt
                      )}
                    </span>
                  </div>
                  <span className='text-12px leading-relaxed text-t-secondary'>{version.changeSummary}</span>
                </div>
                <div className={styles.versionActions}>
                  <Button
                    size='mini'
                    type='text'
                    icon={<PreviewOpen size={13} />}
                    data-testid={`skill-version-preview-${version.id}`}
                    onClick={() => setPreview(version)}
                  >
                    {t('personal.skillConsolidation.preview', { defaultValue: 'Preview' })}
                  </Button>
                  {!isActive && managedSkill.state === 'active' ? (
                    <Button
                      size='mini'
                      type='text'
                      icon={<Undo size={13} />}
                      disabled={busy}
                      data-testid={`skill-version-rollback-${version.id}`}
                      onClick={() => setConfirmation({ action: 'rollback', version })}
                    >
                      {t('personal.skillConsolidation.rollback', { defaultValue: 'Roll back' })}
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        visible={preview !== null}
        title={
          preview
            ? t('personal.skillConsolidation.previewVersion', {
                number: preview.versionNumber,
                defaultValue: 'Version {{number}} content',
              })
            : undefined
        }
        footer={null}
        unmountOnExit
        onCancel={() => setPreview(null)}
      >
        <pre className={styles.versionPreview}>{preview?.content}</pre>
      </Modal>

      <Modal
        visible={confirmation !== null}
        title={confirmationText.title}
        okText={confirmationText.okText}
        cancelText={t('common.cancel', { defaultValue: 'Cancel' })}
        confirmLoading={busy}
        okButtonProps={confirmation?.action === 'disable' ? { status: 'danger' } : undefined}
        onCancel={() => setConfirmation(null)}
        onOk={confirmAction}
      >
        {confirmationText.description}
      </Modal>
    </section>
  );
};

function getConfirmationText(
  confirmation: Confirmation,
  t: ReturnType<typeof useTranslation>['t']
): { title: string; description: string; okText: string } {
  if (confirmation?.action === 'disable') {
    return {
      title: t('personal.skillConsolidation.disableTitle', { defaultValue: 'Disable this skill?' }),
      description: t('personal.skillConsolidation.disableDescription', {
        defaultValue: 'The skill will stop being available to new conversations. Its version history stays intact.',
      }),
      okText: t('personal.skillConsolidation.disable', { defaultValue: 'Disable' }),
    };
  }
  if (confirmation?.action === 'enable') {
    return {
      title: t('personal.skillConsolidation.enableTitle', { defaultValue: 'Enable this skill?' }),
      description: t('personal.skillConsolidation.enableDescription', {
        defaultValue: 'The active version will be installed and made available again.',
      }),
      okText: t('personal.skillConsolidation.enable', { defaultValue: 'Enable' }),
    };
  }
  if (confirmation?.action === 'rollback') {
    return {
      title: t('personal.skillConsolidation.rollbackTitle', {
        number: confirmation.version.versionNumber,
        defaultValue: 'Roll back to version {{number}}?',
      }),
      description: t('personal.skillConsolidation.rollbackDescription', {
        defaultValue: 'A new version will be created. Existing history will not be changed.',
      }),
      okText: t('personal.skillConsolidation.rollback', { defaultValue: 'Roll back' }),
    };
  }
  return { title: '', description: '', okText: '' };
}

export default SkillVersionHistory;
