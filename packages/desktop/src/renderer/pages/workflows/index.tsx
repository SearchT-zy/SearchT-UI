import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Empty, Input, Message, Modal, Radio, Spin, Switch, Tabs, Tag } from '@arco-design/web-react';
import { Branch, Delete, Edit, Play, Refresh, Repair, Return, Time } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { ICreateCronJobParams } from '@/common/adapter/ipcBridge';
import type {
  WorkflowClient,
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowRun,
} from '@/common/types/searcht/workflow';
import { getBuiltinWorkflowTemplates } from '@/common/searcht/workflows/catalog';
import { compileWorkflowPrompt } from '@/common/searcht/workflows/validation';
import PersonalPageShell from '@renderer/pages/personal/PersonalPageShell';
import CreateTaskDialog from '@renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog';
import { workflowClient } from './workflowClient';
import { createWorkflowRuntime } from './workflowRuntime';
import WorkflowGrantModal from './WorkflowGrantModal';
import styles from './Workflows.module.css';

const TabPane = Tabs.TabPane;

const defaultRuntime = createWorkflowRuntime({
  client: workflowClient,
  cron: {
    addJob: (input) => ipcBridge.cron.addJob.invoke(input),
    removeJob: (jobId) => ipcBridge.cron.removeJob.invoke({ job_id: jobId }),
    runNow: (jobId) => ipcBridge.cron.runNow.invoke({ job_id: jobId }),
    updateJob: (jobId, enabled) => ipcBridge.cron.updateJob.invoke({ job_id: jobId, updates: { enabled } }),
    listJobs: () => ipcBridge.cron.listJobs.invoke(),
    getJob: (jobId) => ipcBridge.cron.getJob.invoke({ job_id: jobId }),
  },
});

type WorkflowPageRuntime = Pick<
  ReturnType<typeof createWorkflowRuntime>,
  'bindCreatedJob' | 'runNow' | 'resumeRun' | 'setEnabled' | 'repair' | 'reconcile' | 'handleExecuted'
>;

type WorkflowsPageProps = {
  client?: WorkflowClient;
  runtime?: WorkflowPageRuntime;
};

const WorkflowsPage: React.FC<WorkflowsPageProps> = ({ client = workflowClient, runtime = defaultRuntime }) => {
  const { t } = useTranslation();
  const [message, messageContext] = Message.useMessage();
  const [workflows, setWorkflows] = useState<WorkflowInstance[]>([]);
  const [deletedWorkflows, setDeletedWorkflows] = useState<WorkflowInstance[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowDefinition | null>(null);
  const [mineView, setMineView] = useState<'active' | 'trash'>('active');
  const [editing, setEditing] = useState<{ workflow: WorkflowInstance; name: string; description: string } | null>(
    null
  );
  const [removalCandidate, setRemovalCandidate] = useState<WorkflowInstance | null>(null);
  const [approvalRequest, setApprovalRequest] = useState<{ workflow: WorkflowInstance; run: WorkflowRun } | null>(null);
  const templates = useMemo(() => getBuiltinWorkflowTemplates(), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await runtime.reconcile();
      const [workflowResult, deletedResult, runResult] = await Promise.all([
        client.list(),
        client.listDeleted(),
        client.listRuns(),
      ]);
      setWorkflows(workflowResult.workflows);
      setDeletedWorkflows(deletedResult.workflows);
      setRuns(runResult.runs);
      const workflowsById = new Map(
        [...workflowResult.workflows, ...deletedResult.workflows].map((workflow) => [workflow.id, workflow])
      );
      const versionLists = await Promise.all(
        [...workflowsById.values()].map(
          async (workflow) => [workflow.id, await client.listVersions(workflow.id)] as const
        )
      );
      setVersions(Object.fromEntries(versionLists.map(([id, items]) => [id, items[0]?.versionNumber ?? 1])));
      setLoadFailed(false);
    } catch (error) {
      console.error('[WorkflowsPage] Failed to load workflows', error);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [client, runtime]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () =>
      ipcBridge.cron.onJobExecuted.on((event) => {
        void runtime
          .handleExecuted(event)
          .then(load)
          .catch((): undefined => undefined);
      }),
    [load, runtime]
  );

  const runNow = async (workflow: WorkflowInstance) => {
    setBusyId(workflow.id);
    try {
      const run = await runtime.runNow(workflow, { source: 'manual' });
      message.success(
        run.state === 'waiting-approval'
          ? t('personal.workflows.messages.approvalRequired')
          : t('personal.workflows.messages.runStarted')
      );
      if (run.state === 'waiting-approval') setApprovalRequest({ workflow, run });
      await load();
    } catch {
      message.error(t('personal.workflows.errors.run'));
    } finally {
      setBusyId(null);
    }
  };

  const setEnabled = async (workflow: WorkflowInstance, enabled: boolean) => {
    setBusyId(workflow.id);
    try {
      await runtime.setEnabled(workflow, enabled);
      await load();
    } catch {
      message.error(t('personal.workflows.errors.state'));
    } finally {
      setBusyId(null);
    }
  };

  const repair = async (workflow: WorkflowInstance) => {
    setBusyId(workflow.id);
    try {
      const version = (await client.listVersions(workflow.id))[0];
      if (!version) throw new Error('WORKFLOW_VERSION_NOT_FOUND');
      await runtime.repair(workflow, createCronDraft(version.definition, version.compiledPrompt));
      await load();
    } catch {
      message.error(t('personal.workflows.errors.repair'));
    } finally {
      setBusyId(null);
    }
  };

  const saveVersion = async () => {
    if (!editing) return;
    setBusyId(editing.workflow.id);
    try {
      const current = (await client.listVersions(editing.workflow.id))[0];
      if (!current) throw new Error('WORKFLOW_VERSION_NOT_FOUND');
      const definition = {
        ...current.definition,
        version: current.versionNumber + 1,
        name: editing.name.trim(),
        description: editing.description.trim(),
      };
      await client.createVersion({
        workflowId: editing.workflow.id,
        definition,
        compiledPrompt: compileWorkflowPrompt(definition),
        changeSummary: t('personal.workflows.version.userUpdate'),
      });
      setEditing(null);
      await load();
    } catch {
      message.error(t('personal.workflows.errors.version'));
    } finally {
      setBusyId(null);
    }
  };

  const removeWorkflow = async () => {
    if (!removalCandidate) return;
    setBusyId(removalCandidate.id);
    try {
      if (removalCandidate.state === 'active') await runtime.setEnabled(removalCandidate, false);
      await client.remove(removalCandidate.id);
      setRemovalCandidate(null);
      await load();
    } catch {
      message.error(t('personal.workflows.errors.remove'));
    } finally {
      setBusyId(null);
    }
  };

  const restoreWorkflow = async (workflow: WorkflowInstance) => {
    setBusyId(workflow.id);
    try {
      await client.restore(workflow.id);
      await load();
    } catch {
      message.error(t('personal.workflows.errors.restore'));
    } finally {
      setBusyId(null);
    }
  };

  if (loading && workflows.length === 0 && !loadFailed) {
    return (
      <PersonalPageShell title={t('personal.workflows.title')} description={t('personal.workflows.description')}>
        <div className='flex justify-center py-64px'>
          <Spin />
        </div>
      </PersonalPageShell>
    );
  }

  return (
    <PersonalPageShell title={t('personal.workflows.title')} description={t('personal.workflows.description')}>
      {messageContext}
      {loadFailed ? (
        <div role='alert' className='flex flex-col items-center gap-12px py-56px text-t-secondary'>
          <span>{t('personal.workflows.errors.load')}</span>
          <Button icon={<Refresh size='16' />} onClick={() => void load()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : (
        <Tabs defaultActiveTab='catalog' className={styles.tabs} destroyOnHide={false}>
          <TabPane key='catalog' title={t('personal.workflows.tabs.catalog')}>
            <div className={styles.catalogGrid}>
              {templates.map((template) => (
                <section key={template.id} className={styles.templateItem}>
                  <div className='min-w-0 flex-1'>
                    <div className='flex flex-wrap items-center gap-8px'>
                      <Branch size='17' />
                      <h2 className='m-0 text-15px font-600'>
                        {t(template.nameKey ?? 'personal.workflows.untitled', { defaultValue: template.name })}
                      </h2>
                      <RiskTag risk={template.risk} />
                    </div>
                    <p className='mb-0 mt-7px text-13px leading-20px text-t-secondary'>
                      {t(template.descriptionKey ?? 'personal.workflows.untitled', {
                        defaultValue: template.description,
                      })}
                    </p>
                    <div className='mt-10px flex flex-wrap gap-6px'>
                      {template.steps.map((step) => (
                        <Tag key={step.id} size='small'>
                          {step.title}
                        </Tag>
                      ))}
                    </div>
                  </div>
                  <Button type='primary' size='small' onClick={() => setSelectedTemplate(template)}>
                    {t('personal.workflows.actions.useTemplate')}
                  </Button>
                </section>
              ))}
            </div>
          </TabPane>
          <TabPane key='mine' title={t('personal.workflows.tabs.mine')}>
            <Radio.Group
              type='button'
              value={mineView}
              onChange={(value) => setMineView(value as 'active' | 'trash')}
              className='mb-12px'
            >
              <Radio value='active'>{t('personal.workflows.views.active')}</Radio>
              <Radio value='trash'>{t('personal.workflows.views.trash')}</Radio>
            </Radio.Group>
            {(mineView === 'active' ? workflows : deletedWorkflows).length === 0 ? (
              <Empty
                description={t(
                  mineView === 'active' ? 'personal.workflows.empty.mine' : 'personal.workflows.empty.trash'
                )}
              />
            ) : (
              <div className='flex flex-col'>
                {(mineView === 'active' ? workflows : deletedWorkflows).map((workflow) => (
                  <section key={workflow.id} className={styles.workflowRow}>
                    <div className='min-w-0 flex-1'>
                      <div className='flex flex-wrap items-center gap-8px'>
                        <h2 className='m-0 text-15px font-600'>{workflow.name}</h2>
                        <StateTag state={workflow.state} />
                        <Tag size='small'>v{versions[workflow.id] ?? 1}</Tag>
                      </div>
                      <p className='mb-0 mt-5px line-clamp-2 text-13px leading-20px text-t-secondary'>
                        {workflow.description}
                      </p>
                    </div>
                    <div data-testid='workflow-actions' className={`workflowActions ${styles.workflowActions}`}>
                      {mineView === 'trash' ? (
                        <Button
                          size='small'
                          icon={<Return size='15' />}
                          loading={busyId === workflow.id}
                          onClick={() => void restoreWorkflow(workflow)}
                        >
                          {t('personal.workflows.actions.restore')}
                        </Button>
                      ) : workflow.state === 'needs-repair' ? (
                        <Button
                          size='small'
                          icon={<Repair size='15' />}
                          loading={busyId === workflow.id}
                          onClick={() => void repair(workflow)}
                        >
                          {t('personal.workflows.actions.repair')}
                        </Button>
                      ) : (
                        <>
                          <Button
                            type='primary'
                            size='small'
                            icon={<Play size='15' />}
                            disabled={workflow.state !== 'active'}
                            loading={busyId === workflow.id}
                            onClick={() => void runNow(workflow)}
                          >
                            {t('personal.workflows.actions.runNow')}
                          </Button>
                          <Switch
                            checked={workflow.state === 'active'}
                            aria-label={t('personal.workflows.actions.enabled')}
                            onChange={(enabled) => void setEnabled(workflow, enabled)}
                          />
                          <Button
                            type='text'
                            size='small'
                            icon={<Edit size='16' />}
                            aria-label={t('personal.workflows.actions.edit')}
                            onClick={() =>
                              setEditing({ workflow, name: workflow.name, description: workflow.description })
                            }
                          />
                          <Button
                            type='text'
                            status='danger'
                            size='small'
                            icon={<Delete size='16' />}
                            aria-label={t('common.delete')}
                            onClick={() => setRemovalCandidate(workflow)}
                          />
                        </>
                      )}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </TabPane>
          <TabPane key='history' title={t('personal.workflows.tabs.history')}>
            {runs.length === 0 ? (
              <Empty description={t('personal.workflows.empty.history')} />
            ) : (
              <div className='flex flex-col'>
                {runs.map((run) => (
                  <section key={run.id} className={styles.runRow}>
                    <Time size='16' />
                    <div className='min-w-0 flex-1'>
                      <div className='text-13px font-500'>
                        {workflows.find((item) => item.id === run.workflowId)?.name}
                      </div>
                      <div className='mt-3px text-12px text-t-secondary'>
                        {new Date(run.createdAt).toLocaleString()} · {run.workflowVersionId}
                      </div>
                    </div>
                    <Tag size='small'>{t(`personal.workflows.runStates.${run.state}`)}</Tag>
                  </section>
                ))}
              </div>
            )}
          </TabPane>
        </Tabs>
      )}
      {selectedTemplate ? (
        <CreateTaskDialog
          visible
          onClose={() => setSelectedTemplate(null)}
          initialDraft={{
            name: t(selectedTemplate.nameKey ?? 'personal.workflows.untitled', {
              defaultValue: selectedTemplate.name,
            }),
            prompt: compileWorkflowPrompt(selectedTemplate),
            schedule: toCronSchedule(selectedTemplate),
            executionMode: 'new_conversation',
            queueEnabled: false,
          }}
          onCreated={async (job) => {
            await runtime.bindCreatedJob(selectedTemplate, job);
            setSelectedTemplate(null);
            await load();
          }}
        />
      ) : null}
      <Modal
        visible={editing !== null}
        title={t('personal.workflows.version.editTitle')}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        confirmLoading={Boolean(editing && busyId === editing.workflow.id)}
        onOk={() => void saveVersion()}
        onCancel={() => setEditing(null)}
        unmountOnExit
      >
        <div className='flex flex-col gap-12px'>
          <Input
            value={editing?.name ?? ''}
            aria-label={t('personal.workflows.version.name')}
            onChange={(name) => setEditing((current) => (current ? { ...current, name } : current))}
          />
          <Input.TextArea
            value={editing?.description ?? ''}
            aria-label={t('personal.workflows.version.description')}
            autoSize={{ minRows: 3, maxRows: 6 }}
            onChange={(description) => setEditing((current) => (current ? { ...current, description } : current))}
          />
        </div>
      </Modal>
      {approvalRequest ? (
        <WorkflowGrantModal
          visible
          workflow={approvalRequest.workflow}
          run={approvalRequest.run}
          client={client}
          runtime={runtime}
          onClose={() => setApprovalRequest(null)}
          onCompleted={async () => {
            setApprovalRequest(null);
            await load();
          }}
        />
      ) : null}
      <Modal
        visible={removalCandidate !== null}
        title={t('personal.workflows.remove.title')}
        okText={t('personal.workflows.remove.confirm')}
        cancelText={t('common.cancel')}
        confirmLoading={Boolean(removalCandidate && busyId === removalCandidate.id)}
        onOk={() => void removeWorkflow()}
        onCancel={() => setRemovalCandidate(null)}
        unmountOnExit
      >
        {t('personal.workflows.remove.description', { name: removalCandidate?.name ?? '' })}
      </Modal>
    </PersonalPageShell>
  );
};

const RiskTag: React.FC<{ risk: WorkflowDefinition['risk'] }> = ({ risk }) => (
  <Tag size='small' color={risk === 'external-write' ? 'red' : risk === 'local-write' ? 'orange' : 'green'}>
    {risk}
  </Tag>
);

const StateTag: React.FC<{ state: WorkflowInstance['state'] }> = ({ state }) => (
  <Tag size='small' color={state === 'active' ? 'green' : state === 'needs-repair' ? 'orange' : 'gray'}>
    {state}
  </Tag>
);

function toCronSchedule(definition: WorkflowDefinition): Extract<ICreateCronJobParams['schedule'], { kind: 'cron' }> {
  return definition.suggestedSchedule.kind === 'cron'
    ? {
        kind: 'cron',
        expr: definition.suggestedSchedule.expr,
        tz: definition.suggestedSchedule.timezone,
        description: definition.suggestedSchedule.description,
      }
    : { kind: 'cron', expr: '', description: 'Manual' };
}

function createCronDraft(definition: WorkflowDefinition, prompt: string): ICreateCronJobParams {
  return {
    name: definition.name,
    schedule: toCronSchedule(definition),
    prompt,
    conversation_id: '',
    created_by: 'user',
    execution_mode: 'new_conversation',
    queue_enabled: false,
  };
}

export default WorkflowsPage;
