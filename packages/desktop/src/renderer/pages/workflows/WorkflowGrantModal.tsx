import React, { useEffect, useState } from 'react';
import { Alert, Modal, Radio, Select, Spin } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type {
  WorkflowApproval,
  WorkflowClient,
  WorkflowGrantConstraintValue,
  WorkflowInstance,
  WorkflowRun,
} from '@/common/types/searcht/workflow';
import type { createWorkflowRuntime } from './workflowRuntime';

type GrantRuntime = Pick<ReturnType<typeof createWorkflowRuntime>, 'resumeRun'>;

type WorkflowGrantModalProps = {
  visible: boolean;
  workflow: WorkflowInstance;
  run: WorkflowRun;
  client: WorkflowClient;
  runtime: GrantRuntime;
  onClose: () => void;
  onCompleted: () => void | Promise<void>;
};

const WorkflowGrantModal: React.FC<WorkflowGrantModalProps> = ({
  visible,
  workflow,
  run,
  client,
  runtime,
  onClose,
  onCompleted,
}) => {
  const { t } = useTranslation();
  const [approvals, setApprovals] = useState<WorkflowApproval[]>([]);
  const [mode, setMode] = useState<'once' | 'persistent'>('once');
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    void client
      .listApprovals(run.id)
      .then(setApprovals)
      .finally(() => setLoading(false));
  }, [client, run.id, visible]);

  const approve = async () => {
    setSubmitting(true);
    try {
      const now = Date.now();
      await Promise.all(
        approvals
          .filter((item) => item.state === 'pending')
          .map(async (approval) => {
            if (mode === 'persistent') {
              await client.saveGrant({
                id: globalThis.crypto.randomUUID(),
                workflowId: workflow.id,
                resource: approval.resource,
                action: approval.action,
                constraints: normalizeConstraints(run.inputSnapshot),
                expiresAt: now + days * 86_400_000,
                revokedAt: null,
                createdAt: now,
                lastUsedAt: null,
              });
            }
            return client.decideApproval(approval.id, 'approved');
          })
      );
      const approvedRun = (await client.listRuns(workflow.id)).runs.find((item) => item.id === run.id);
      if (!approvedRun) throw new Error('WORKFLOW_RUN_NOT_FOUND');
      await runtime.resumeRun(workflow, approvedRun);
      await onCompleted();
    } finally {
      setSubmitting(false);
    }
  };

  const reject = async () => {
    setSubmitting(true);
    try {
      await Promise.all(
        approvals
          .filter((item) => item.state === 'pending')
          .map((approval) => client.decideApproval(approval.id, 'rejected'))
      );
      await onCompleted();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      title={t('personal.workflows.grants.title')}
      okText={t('personal.workflows.grants.allow')}
      cancelText={t('personal.workflows.grants.reject')}
      confirmLoading={submitting}
      onOk={() => void approve()}
      onCancel={() => void reject().finally(onClose)}
      closable={!submitting}
      maskClosable={false}
      unmountOnExit
    >
      {loading ? (
        <div className='flex justify-center py-32px'>
          <Spin />
        </div>
      ) : (
        <div className='flex flex-col gap-14px'>
          <Alert type='warning' content={t('personal.workflows.grants.description', { name: workflow.name })} />
          <div className='flex flex-col gap-8px'>
            {approvals.map((approval) => (
              <div key={approval.id} className='rd-6px bg-fill-2 px-12px py-10px'>
                <div className='text-13px font-500'>{approval.action}</div>
                <div className='mt-3px break-all text-12px text-t-secondary'>{approval.resource}</div>
              </div>
            ))}
          </div>
          <Radio.Group value={mode} onChange={(value) => setMode(value as 'once' | 'persistent')}>
            <Radio value='once'>{t('personal.workflows.grants.once')}</Radio>
            <Radio value='persistent'>{t('personal.workflows.grants.remember')}</Radio>
          </Radio.Group>
          {mode === 'persistent' ? (
            <Select
              aria-label={t('personal.workflows.grants.expiry')}
              value={days}
              onChange={setDays}
              options={[
                { value: 7, label: t('personal.workflows.grants.days', { count: 7 }) },
                { value: 30, label: t('personal.workflows.grants.days', { count: 30 }) },
              ]}
            />
          ) : null}
        </div>
      )}
    </Modal>
  );
};

function normalizeConstraints(input: Record<string, unknown>): Record<string, WorkflowGrantConstraintValue> {
  return Object.fromEntries(
    Object.entries(input).filter(
      (entry): entry is [string, WorkflowGrantConstraintValue] =>
        typeof entry[1] === 'string' ||
        typeof entry[1] === 'number' ||
        typeof entry[1] === 'boolean' ||
        (Array.isArray(entry[1]) && entry[1].every((item) => typeof item === 'string'))
    )
  );
}

export default WorkflowGrantModal;
