import { Alert, Button, Empty, Modal, Spin, Tag } from '@arco-design/web-react';
import { Check, CloseOne, Refresh } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SkillCandidate, SkillLifecycleClient } from '@/common/types/searcht/skillConsolidation';
import { skillLifecycleClient } from './skillLifecycleClient';
import styles from './SkillConsolidation.module.css';

type SkillCandidateListProps = {
  client?: SkillLifecycleClient;
  onOpen: (id: string) => void;
  onCountChange?: (count: number) => void;
};

const SkillCandidateList: React.FC<SkillCandidateListProps> = ({
  client = skillLifecycleClient,
  onOpen,
  onCountChange,
}) => {
  const { t } = useTranslation();
  const [candidates, setCandidates] = useState<SkillCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<SkillCandidate | null>(null);
  const [rejecting, setRejecting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.listCandidates({ limit: 200 });
      setCandidates(result.candidates);
      onCountChange?.(result.total);
    } catch (loadError) {
      console.error('Failed to load skill candidates:', loadError);
      setError('SKILL_CANDIDATES_LOAD_FAILED');
    } finally {
      setLoading(false);
    }
  }, [client, onCountChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const rejectSelectedCandidate = async () => {
    if (!rejectTarget) return;
    setRejecting(true);
    try {
      await client.rejectCandidate(rejectTarget.id);
      setRejectTarget(null);
      await load();
    } catch (rejectError) {
      console.error('Failed to reject skill candidate:', rejectError);
      setRejectTarget(null);
      setError('SKILL_CANDIDATE_REJECT_FAILED');
    } finally {
      setRejecting(false);
    }
  };

  if (loading) {
    return (
      <div className='flex min-h-240px items-center justify-center' data-testid='skill-candidates-loading'>
        <Spin />
      </div>
    );
  }

  if (error) {
    return (
      <Alert
        type='error'
        title={t('personal.skillConsolidation.loadFailed', { defaultValue: 'Candidates could not be loaded' })}
        content={t('personal.skillConsolidation.loadFailedHint', {
          defaultValue: 'Check the local workspace service, then try again.',
        })}
        action={
          <Button
            size='small'
            icon={<Refresh size={14} />}
            data-testid='skill-candidates-retry'
            onClick={() => void load()}
          >
            {t('common.retry', { defaultValue: 'Retry' })}
          </Button>
        }
      />
    );
  }

  if (!candidates.length) {
    return (
      <div className='py-48px'>
        <Empty
          description={t('personal.skillConsolidation.empty', {
            defaultValue: 'No skills are waiting for review.',
          })}
        />
      </div>
    );
  }

  return (
    <>
      <div className={styles.candidateList} data-testid='skill-candidate-list'>
        {candidates.map((candidate) => {
          const errors = candidate.validation.issues.filter((issue) => issue.severity === 'error').length;
          const warnings = candidate.validation.issues.filter((issue) => issue.severity === 'warning').length;
          return (
            <div key={candidate.id} className={styles.candidateRow} data-testid={`skill-candidate-${candidate.id}`}>
              <div className={styles.candidateMain}>
                <div className='flex min-w-0 flex-wrap items-center gap-8px'>
                  <h3 className='m-0 min-w-0 truncate text-14px font-600 text-t-primary'>{candidate.proposedName}</h3>
                  {errors > 0 ? (
                    <Tag color='red' size='small'>
                      {t('personal.skillConsolidation.errorCount', {
                        count: errors,
                        defaultValue: '{{count}} errors',
                      })}
                    </Tag>
                  ) : warnings > 0 ? (
                    <Tag color='orange' size='small'>
                      {t('personal.skillConsolidation.warningCount', {
                        count: warnings,
                        defaultValue: '{{count}} warnings',
                      })}
                    </Tag>
                  ) : (
                    <Tag color='green' size='small'>
                      {t('personal.skillConsolidation.ready', { defaultValue: 'Ready to review' })}
                    </Tag>
                  )}
                </div>
                <p className='m-0 text-13px leading-relaxed text-t-secondary'>{candidate.description}</p>
                <div className={styles.inspectionGrid}>
                  <InspectionGroup
                    label={t('personal.skillConsolidation.sources', { defaultValue: 'Sources' })}
                    values={candidate.sourceReferences.map((source) => source.label || `${source.kind}: ${source.id}`)}
                  />
                  <InspectionGroup
                    label={t('personal.skillConsolidation.tools', { defaultValue: 'Tools' })}
                    values={candidate.requiredTools}
                  />
                  <InspectionGroup
                    label={t('personal.skillConsolidation.permissions', { defaultValue: 'Permissions' })}
                    values={candidate.permissions}
                  />
                </div>
              </div>
              <div className={styles.candidateActions}>
                <Button
                  type='primary'
                  size='small'
                  icon={<Check size={14} />}
                  data-testid={`skill-candidate-review-${candidate.id}`}
                  onClick={() => onOpen(candidate.id)}
                >
                  {t('personal.skillConsolidation.review', { defaultValue: 'Review' })}
                </Button>
                <Button
                  type='text'
                  size='small'
                  status='danger'
                  icon={<CloseOne size={14} />}
                  data-testid={`skill-candidate-reject-${candidate.id}`}
                  onClick={() => setRejectTarget(candidate)}
                >
                  {t('personal.skillConsolidation.reject', { defaultValue: 'Do not use' })}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      <Modal
        visible={rejectTarget !== null}
        title={t('personal.skillConsolidation.rejectTitle', { defaultValue: 'Do not use this candidate?' })}
        okText={t('personal.skillConsolidation.rejectConfirm', { defaultValue: 'Do not use' })}
        cancelText={t('common.cancel', { defaultValue: 'Cancel' })}
        confirmLoading={rejecting}
        okButtonProps={{ status: 'danger' }}
        onCancel={() => setRejectTarget(null)}
        onOk={rejectSelectedCandidate}
      >
        {t('personal.skillConsolidation.rejectDescription', {
          name: rejectTarget?.proposedName,
          defaultValue: 'The draft content will be deleted. A content-free audit record will be kept.',
        })}
      </Modal>
    </>
  );
};

const InspectionGroup: React.FC<{ label: string; values: string[] }> = ({ label, values }) => (
  <div className='min-w-0'>
    <div className='mb-5px text-11px font-500 text-t-tertiary'>{label}</div>
    <div className='flex min-h-22px flex-wrap gap-5px'>
      {values.length ? (
        values.map((value) => (
          <Tag key={value} size='small' className='max-w-full'>
            <span className='block max-w-220px truncate' title={value}>
              {value}
            </span>
          </Tag>
        ))
      ) : (
        <span className='text-12px text-t-quaternary'>-</span>
      )}
    </div>
  </div>
);

export default SkillCandidateList;
