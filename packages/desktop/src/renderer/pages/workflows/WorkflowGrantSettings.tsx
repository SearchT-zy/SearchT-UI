import React, { useEffect, useState } from 'react';
import { Button, Message, Spin } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { WorkflowClient, WorkflowGrant, WorkflowListResult } from '@/common/types/searcht/workflow';
import { workflowClient } from './workflowClient';

type WorkflowGrantSettingsProps = {
  client?: Pick<WorkflowClient, 'list' | 'listGrants' | 'revokeGrant'>;
};

const WorkflowGrantSettings: React.FC<WorkflowGrantSettingsProps> = ({ client = workflowClient }) => {
  const { t } = useTranslation();
  const [message, messageContext] = Message.useMessage();
  const [grants, setGrants] = useState<WorkflowGrant[]>([]);
  const [workflowNames, setWorkflowNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      client.listGrants(),
      client.list().catch((): WorkflowListResult => ({ workflows: [], total: 0 })),
    ])
      .then(([items, workflowResult]) => {
        if (!active) return;
        setGrants(items.filter((grant) => grant.revokedAt === null));
        setWorkflowNames(Object.fromEntries(workflowResult.workflows.map((workflow) => [workflow.id, workflow.name])));
      })
      .catch(() => active && setGrants([]))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [client]);

  const revoke = async (id: string) => {
    setBusyId(id);
    try {
      await client.revokeGrant(id);
      setGrants((current) => current.filter((grant) => grant.id !== id));
      message.success(t('personal.workflows.grants.revoked'));
    } catch {
      message.error(t('personal.workflows.errors.revokeGrant'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className='border-b border-border-2 py-22px last:border-b-0'>
      {messageContext}
      <div className='mb-14px'>
        <h2 className='m-0 text-15px font-600 leading-22px text-t-primary'>
          {t('personal.workflows.grants.settingsTitle')}
        </h2>
        <p className='mb-0 mt-4px text-13px leading-20px text-t-secondary'>
          {t('personal.workflows.grants.settingsDescription')}
        </p>
      </div>
      {loading ? (
        <Spin />
      ) : grants.length === 0 ? (
        <div className='text-13px text-t-secondary'>{t('personal.workflows.grants.empty')}</div>
      ) : (
        <div className='flex flex-col'>
          {grants.map((grant) => (
            <div
              key={grant.id}
              className='min-h-72px flex items-center gap-12px border-b border-border-1 py-10px last:border-0'
            >
              <div className='min-w-0 flex-1'>
                <div className='flex flex-wrap items-center gap-x-8px gap-y-3px text-13px font-500 text-t-primary'>
                  <span>{workflowNames[grant.workflowId] ?? t('personal.workflows.grants.unknownWorkflow')}</span>
                  <span>{grant.action}</span>
                </div>
                <div className='mt-3px break-all text-12px text-t-secondary'>{grant.resource}</div>
                <div className='mt-3px text-12px text-t-secondary'>
                  {t('personal.workflows.grants.constraints')}: {formatConstraints(grant.constraints)}
                </div>
                <div className='mt-3px flex flex-wrap gap-x-12px gap-y-3px text-12px text-t-secondary'>
                  <span>
                    {t('personal.workflows.grants.expires')}:{' '}
                    {grant.expiresAt
                      ? new Date(grant.expiresAt).toLocaleDateString()
                      : t('personal.workflows.grants.noExpiry')}
                  </span>
                  <span>
                    {t('personal.workflows.grants.lastUsed')}:{' '}
                    {grant.lastUsedAt
                      ? new Date(grant.lastUsedAt).toLocaleDateString()
                      : t('personal.workflows.grants.neverUsed')}
                  </span>
                </div>
                <div className='mt-3px break-all text-11px text-t-tertiary'>
                  {t('personal.workflows.grants.workflowId')}: {grant.workflowId}
                </div>
              </div>
              <Button
                type='text'
                status='danger'
                size='small'
                loading={busyId === grant.id}
                onClick={() => void revoke(grant.id)}
              >
                {t('personal.workflows.grants.revoke')}
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

function formatConstraints(constraints: WorkflowGrant['constraints']): string {
  const entries = Object.entries(constraints);
  if (entries.length === 0) return '-';
  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
    .join('; ');
}

export default WorkflowGrantSettings;
