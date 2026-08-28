import React, { useCallback, useEffect, useState } from 'react';
import { Button, Message, Popconfirm, Select, Spin, Switch, Tag } from '@arco-design/web-react';
import { ArrowDown, ArrowUp, DatabaseSuccess, DatabaseDownload, Refresh, Save, Undo } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ipcBridge } from '@/common';
import type { CloudSyncConfigureInput, CloudSyncReport, CloudSyncStatus } from '@/common/types/searcht/cloudSync';
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  PERSONAL_MODULE_IDS,
  type SearchtImportDiscovery,
  type SearchtImportPlan,
  type SearchtImportReport,
  type PersonalBackupResult,
  type PersonalCoreHealth,
  type PersonalModuleId,
  type WorkspacePreferences,
} from '@/common/types/searcht/workspace';
import SettingsPageHeader from './components/SettingsPageHeader';
import SettingsPageWrapper from './components/SettingsPageWrapper';
import { isElectronDesktop } from '@renderer/utils/platform';
import {
  loadWorkspacePreferences,
  saveWorkspacePreferences,
} from '@renderer/pages/personal/workspacePreferencesClient';
import WorkflowGrantSettings from '@renderer/pages/workflows/WorkflowGrantSettings';

type PersonalWorkspaceSettingsProps = {
  load?: () => Promise<WorkspacePreferences>;
  save?: (preferences: WorkspacePreferences) => Promise<WorkspacePreferences>;
  createBackup?: () => Promise<PersonalBackupResult>;
  backupAvailable?: boolean;
  importAvailable?: boolean;
  discoverImport?: () => Promise<SearchtImportDiscovery>;
  planImport?: () => Promise<SearchtImportPlan>;
  runImport?: () => Promise<SearchtImportReport>;
  rollbackImport?: (id: string) => Promise<SearchtImportReport>;
  listImports?: () => Promise<SearchtImportReport[]>;
  getSyncStatus?: () => Promise<CloudSyncStatus>;
  configureSync?: (input: CloudSyncConfigureInput) => Promise<CloudSyncStatus>;
  syncNow?: () => Promise<CloudSyncReport>;
  disableSync?: () => Promise<CloudSyncStatus>;
};

const CATEGORY_COPY: Record<string, string> = {
  models: '模型配置',
  assistants: '助手',
  skills: '技能',
  mcp: 'MCP 配置',
  conversations: '会话历史',
  workspaces: '工作区与团队',
  themes: '外观主题',
  'scheduled-tasks': '定时任务',
};

const MODULE_COPY: Record<PersonalModuleId, string> = {
  workflows: 'Workflows',
  today: '今日',
  inbox: '收件箱',
  calendar: '日程',
  tasks: '待办',
  notes: '笔记',
  knowledge: '知识库',
};

const SettingSection: React.FC<{ title: string; description?: string; children: React.ReactNode }> = ({
  title,
  description,
  children,
}) => (
  <section className='border-b border-border-2 py-22px last:border-b-0'>
    <div className='mb-14px'>
      <h2 className='m-0 text-15px font-600 leading-22px text-t-primary'>{title}</h2>
      {description ? <p className='mb-0 mt-4px text-13px leading-20px text-t-secondary'>{description}</p> : null}
    </div>
    {children}
  </section>
);

const PersonalWorkspaceSettings: React.FC<PersonalWorkspaceSettingsProps> = ({
  load = loadWorkspacePreferences,
  save = saveWorkspacePreferences,
  createBackup = () => ipcBridge.personalWorkspace.createBackup.invoke(),
  backupAvailable = isElectronDesktop(),
  importAvailable = isElectronDesktop(),
  discoverImport = () => ipcBridge.personalWorkspace.discoverSearchtImport.invoke(),
  planImport = () => ipcBridge.personalWorkspace.planSearchtImport.invoke(),
  runImport = () => ipcBridge.personalWorkspace.runSearchtImport.invoke(),
  rollbackImport = (id) => ipcBridge.personalWorkspace.rollbackSearchtImport.invoke({ id }),
  listImports = () => ipcBridge.personalWorkspace.listSearchtImports.invoke(),
  getSyncStatus = () => ipcBridge.cloudSync.getStatus.invoke(),
  configureSync = (input) => ipcBridge.cloudSync.configure.invoke(input),
  syncNow = () => ipcBridge.cloudSync.syncNow.invoke(),
  disableSync = () => ipcBridge.cloudSync.disable.invoke(),
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [preferences, setPreferences] = useState<WorkspacePreferences>(DEFAULT_WORKSPACE_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<PersonalCoreHealth | null>(null);
  const [importDiscovery, setImportDiscovery] = useState<SearchtImportDiscovery | null>(null);
  const [importPlan, setImportPlan] = useState<SearchtImportPlan | null>(null);
  const [importReport, setImportReport] = useState<SearchtImportReport | null>(null);
  const [importRunning, setImportRunning] = useState(false);
  const [backupPath, setBackupPath] = useState<string | null>(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus | null>(null);
  const [syncReport, setSyncReport] = useState<CloudSyncReport | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncForm, setSyncForm] = useState({
    mode: 'webdav' as 'webdav' | 's3',
    serverUrl: '',
    username: '',
    password: '',
    rootPath: '/searcht',
    endpoint: '',
    region: '',
    bucket: '',
    accessKeyId: '',
    secretAccessKey: '',
    passphrase: '',
  });

  useEffect(() => {
    let active = true;
    void load()
      .then((value) => {
        if (active) setPreferences(value);
      })
      .catch(() => {
        if (active) setPreferences(DEFAULT_WORKSPACE_PREFERENCES);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    if (isElectronDesktop()) {
      void ipcBridge.personalWorkspace.getHealth
        .invoke()
        .then((value) => active && setHealth(value))
        .catch(() => active && setHealth(null));
    }
    if (importAvailable) {
      void discoverImport()
        .then(async (value) => {
          if (!active) return;
          setImportDiscovery(value);
          if (value.available) {
            try {
              const reportList = await listImports();
              const latest = reportList[0];
              if (latest) setImportReport(latest);
              setImportPlan(await planImport());
            } catch {
              /* planning is best-effort */
            }
          }
        })
        .catch(() => active && setImportDiscovery({ available: false }));
    }
    if (importAvailable) {
      void getSyncStatus()
        .then((value) => {
          if (active) setSyncStatus(value);
        })
        .catch(() => {
          /* cloud sync status is informational */
        });
    }
    return () => {
      active = false;
    };
  }, [load, discoverImport, planImport, listImports, importAvailable, getSyncStatus]);

  const runMigration = useCallback(async () => {
    setImportRunning(true);
    try {
      const report = await runImport();
      setImportReport(report);
      Message.success(t('personal.import.done', { defaultValue: '导入完成' }));
    } catch (migrationError) {
      Message.error(
        migrationError instanceof Error
          ? migrationError.message
          : t('personal.import.failed', { defaultValue: '导入失败' })
      );
    } finally {
      setImportRunning(false);
    }
  }, [runImport, t]);

  const rollbackMigration = useCallback(
    async (id: string) => {
      setImportRunning(true);
      try {
        const report = await rollbackImport(id);
        setImportReport(report);
        Message.success(t('personal.import.rolledBack', { defaultValue: '已回滚此次导入' }));
      } catch (migrationError) {
        Message.error(migrationError instanceof Error ? migrationError.message : String(migrationError));
      } finally {
        setImportRunning(false);
      }
    },
    [rollbackImport, t]
  );

  const persist = async (next: WorkspacePreferences) => {
    const previous = preferences;
    setPreferences(next);
    setError(null);
    try {
      setPreferences(await save(next));
    } catch {
      setPreferences(previous);
      const message = t('personal.settings.saveFailed', { defaultValue: '保存失败，已恢复原设置' });
      setError(message);
      Message.error(message);
    }
  };

  const moveModule = (moduleId: PersonalModuleId, direction: -1 | 1) => {
    const order = [...preferences.navigationOrder];
    const from = order.indexOf(moduleId);
    const to = from + direction;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    void persist({ ...preferences, navigationOrder: order });
  };

  const runBackup = async () => {
    setBackupLoading(true);
    setBackupPath(null);
    try {
      const result = await createBackup();
      setBackupPath(result.path);
      Message.success(t('personal.settings.backupDone', { defaultValue: '备份已创建' }));
    } catch {
      Message.error(t('personal.settings.backupFailed', { defaultValue: '无法创建备份' }));
    } finally {
      setBackupLoading(false);
    }
  };

  const submitSyncConfig = useCallback(async () => {
    setSyncBusy(true);
    try {
      const connection =
        syncForm.mode === 'webdav'
          ? {
              mode: 'webdav' as const,
              serverUrl: syncForm.serverUrl.trim(),
              username: syncForm.username.trim(),
              password: syncForm.password,
              rootPath: syncForm.rootPath.trim() || '/searcht',
            }
          : {
              mode: 's3' as const,
              endpoint: syncForm.endpoint.trim(),
              region: syncForm.region.trim(),
              bucket: syncForm.bucket.trim(),
              prefix: '',
              pathStyle: true,
              accessKeyId: syncForm.accessKeyId.trim(),
              secretAccessKey: syncForm.secretAccessKey,
            };
      const status = await configureSync({ mode: syncForm.mode, passphrase: syncForm.passphrase, connection });
      setSyncStatus(status);
      Message.success(t('personal.sync.configured', { defaultValue: '云同步已开启' }));
    } catch (syncError) {
      Message.error(syncError instanceof Error ? syncError.message : String(syncError));
    } finally {
      setSyncBusy(false);
    }
  }, [configureSync, syncForm, t]);

  const runSync = useCallback(async () => {
    setSyncBusy(true);
    try {
      const report = await syncNow();
      setSyncReport(report);
      setSyncStatus(await getSyncStatus());
      if (report.errorCode) Message.error(report.errorCode);
      else Message.success(t('personal.sync.done', { defaultValue: '同步完成' }));
    } catch (syncError) {
      Message.error(syncError instanceof Error ? syncError.message : String(syncError));
    } finally {
      setSyncBusy(false);
    }
  }, [getSyncStatus, syncNow, t]);

  const turnOffSync = useCallback(async () => {
    setSyncBusy(true);
    try {
      setSyncStatus(await disableSync());
      Message.success(t('personal.sync.disabled', { defaultValue: '云同步已关闭' }));
    } finally {
      setSyncBusy(false);
    }
  }, [disableSync, t]);

  if (loading) {
    return (
      <SettingsPageWrapper>
        <div className='h-240px flex items-center justify-center'>
          <Spin />
        </div>
      </SettingsPageWrapper>
    );
  }

  return (
    <SettingsPageWrapper>
      <SettingsPageHeader
        title={t('personal.settings.title', { defaultValue: '个人工作台' })}
        description={t('personal.settings.description', {
          defaultValue: '决定SearchT显示什么，以及打开应用时先去哪里。',
        })}
        actions={
          <Button size='small' onClick={() => void navigate('/onboarding')}>
            {t('personal.settings.reopenOnboarding', { defaultValue: '重新打开首次设置' })}
          </Button>
        }
      />
      {error ? (
        <div role='alert' className='mt-16px rd-6px bg-danger-1 px-12px py-9px text-13px text-danger-6'>
          {error}
        </div>
      ) : null}

      <SettingSection title={t('personal.settings.modules', { defaultValue: '显示模块' })}>
        <div className='flex flex-col'>
          {preferences.navigationOrder.map((moduleId, index) => {
            const label = t(`personal.${moduleId}.title`, { defaultValue: MODULE_COPY[moduleId] });
            return (
              <div
                key={moduleId}
                className='min-h-44px flex items-center gap-10px border-b border-border-1 last:border-0'
              >
                <Switch
                  aria-label={label}
                  checked={preferences.visibleModules[moduleId]}
                  onChange={(checked) =>
                    void persist({
                      ...preferences,
                      visibleModules: { ...preferences.visibleModules, [moduleId]: checked },
                    })
                  }
                />
                <span className='min-w-0 flex-1 text-14px text-t-primary'>{label}</span>
                <Button
                  type='text'
                  size='small'
                  icon={<ArrowUp />}
                  aria-label={`${label}上移`}
                  disabled={index === 0}
                  onClick={() => moveModule(moduleId, -1)}
                />
                <Button
                  type='text'
                  size='small'
                  icon={<ArrowDown />}
                  aria-label={`${label}下移`}
                  disabled={index === preferences.navigationOrder.length - 1}
                  onClick={() => moveModule(moduleId, 1)}
                />
              </div>
            );
          })}
        </div>
      </SettingSection>

      <SettingSection title={t('personal.settings.startPage', { defaultValue: '打开应用时' })}>
        <Select
          aria-label={t('personal.settings.startPage', { defaultValue: '打开应用时' })}
          value={preferences.startPage}
          className='w-full max-w-320px'
          onChange={(startPage) => void persist({ ...preferences, startPage })}
          options={[
            ...PERSONAL_MODULE_IDS.map((id) => ({
              value: id,
              label: t(`personal.${id}.title`, { defaultValue: MODULE_COPY[id] }),
            })),
            { value: 'guid', label: t('personal.chat.title', { defaultValue: '聊天' }) },
          ]}
        />
      </SettingSection>

      <SettingSection title={t('personal.settings.scenePack', { defaultValue: '工作方式' })}>
        <Select
          aria-label={t('personal.settings.scenePack', { defaultValue: '工作方式' })}
          value={preferences.scenePack}
          className='w-full max-w-320px'
          onChange={(scenePack) => void persist({ ...preferences, scenePack })}
          options={[
            { value: 'general', label: t('personal.scene.general', { defaultValue: '通用' }) },
            { value: 'creator', label: t('personal.scene.creator', { defaultValue: '创作者' }) },
            { value: 'manager', label: t('personal.scene.manager', { defaultValue: '管理者' }) },
            { value: 'researcher', label: t('personal.scene.researcher', { defaultValue: '研究者' }) },
          ]}
        />
      </SettingSection>

      <SettingSection title={t('personal.settings.localData', { defaultValue: '本地数据' })}>
        <div className='flex flex-col gap-12px text-14px'>
          <div className='flex items-center justify-between gap-16px'>
            <span className='text-t-secondary'>{t('personal.settings.health', { defaultValue: '数据状态' })}</span>
            <span className='flex items-center gap-6px text-t-primary'>
              <DatabaseSuccess />
              {health?.ok
                ? t('personal.status.healthy', { defaultValue: '正常' })
                : t('personal.status.unavailable', { defaultValue: '不可用' })}
            </span>
          </div>
          <div className='flex items-center justify-between gap-16px'>
            <span className='text-t-secondary'>
              {t('personal.settings.import', { defaultValue: 'SearchT 数据' })}
            </span>
            <span className='text-t-primary'>
              {importDiscovery?.available
                ? t('personal.status.importAvailable', { defaultValue: '发现可导入的数据' })
                : t('personal.status.importUnavailable', { defaultValue: '未发现旧数据' })}
            </span>
          </div>
          {importDiscovery?.available ? (
            <div
              className='rd-6px border border-solid border-border-2 bg-bg-2 px-14px py-12px'
              data-testid='searcht-import-panel'
            >
              <div className='mb-8px flex items-center gap-8px'>
                <DatabaseDownload />
                <span className='text-14px font-500 text-t-primary'>
                  {t('personal.import.title', { defaultValue: '一键导入旧版 SearchT 数据' })}
                </span>
              </div>
              <p className='mt-0 mb-10px text-12px leading-18px text-t-secondary'>
                {t('personal.import.description', {
                  defaultValue:
                    '将模型配置、助手、技能、MCP、会话、工作区与主题一次性复制到SearchT。原 SearchT 数据不会被修改，导入后可回滚。',
                })}
              </p>
              {importPlan && importPlan.categories.length > 0 ? (
                <div className='mb-10px flex flex-wrap gap-6px' data-testid='searcht-import-plan'>
                  {importPlan.categories.map((entry) => (
                    <Tag key={entry.category} size='small'>
                      {CATEGORY_COPY[entry.category] ?? entry.category} × {entry.planned}
                    </Tag>
                  ))}
                </div>
              ) : null}
              {importReport ? (
                <div className='mb-10px flex flex-col gap-4px' data-testid='searcht-import-report'>
                  <div className='flex items-center gap-8px text-13px text-t-primary'>
                    <span>
                      {t(`personal.import.status.${importReport.status}`, {
                        defaultValue: importReport.status,
                      })}
                    </span>
                    {importReport.rollbackAvailable ? (
                      <Popconfirm
                        title={t('personal.import.rollbackConfirm', { defaultValue: '回滚将撤销此次导入的全部内容' })}
                        onOk={() => void rollbackMigration(importReport.id)}
                      >
                        <Button
                          size='mini'
                          icon={<Undo />}
                          disabled={importRunning}
                          data-testid='searcht-import-rollback'
                        >
                          {t('personal.import.rollback', { defaultValue: '回滚' })}
                        </Button>
                      </Popconfirm>
                    ) : null}
                  </div>
                  {importReport.categories.map((entry) => (
                    <div key={entry.category} className='flex items-center gap-8px text-12px text-t-secondary'>
                      <span className='min-w-72px'>{CATEGORY_COPY[entry.category] ?? entry.category}</span>
                      <span>
                        {t('personal.import.imported', { defaultValue: '导入' })} {entry.imported} ·{' '}
                        {t('personal.import.skipped', { defaultValue: '跳过' })} {entry.skipped}
                        {entry.failed > 0
                          ? ` · ${t('personal.import.failedCount', { defaultValue: '失败' })} ${entry.failed}`
                          : ''}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              <Button
                type='primary'
                loading={importRunning}
                disabled={!importPlan || importPlan.categories.length === 0}
                data-testid='searcht-import-run'
                onClick={() => void runMigration()}
              >
                {t('personal.import.run', { defaultValue: '开始导入' })}
              </Button>
            </div>
          ) : null}
          <div>
            <Button
              icon={<Save />}
              disabled={!backupAvailable}
              loading={backupLoading}
              onClick={() => void runBackup()}
            >
              {t('personal.settings.backup', { defaultValue: '创建备份' })}
            </Button>
            {backupPath ? (
              <p role='status' className='mb-0 mt-8px break-all text-12px text-t-secondary'>
                {backupPath}
              </p>
            ) : null}
          </div>
        </div>
      </SettingSection>
      <SettingSection
        title={t('personal.sync.title', { defaultValue: '云同步（端到端加密）' })}
        description={t('personal.sync.description', {
          defaultValue: '把待办、日程和笔记以端到端加密方式同步到你的 WebDAV 或 S3。服务器只保存密文。',
        })}
      >
        <div className='flex flex-col gap-12px text-14px' data-testid='cloud-sync-panel'>
          <div className='flex flex-wrap items-center gap-10px'>
            <Tag color={syncStatus?.mode === 'disabled' ? 'gray' : syncStatus?.state === 'error' ? 'red' : 'green'}>
              {syncStatus
                ? t(`personal.sync.state.${syncStatus.mode === 'disabled' ? 'disabled' : syncStatus.state}`, {
                    defaultValue: syncStatus.mode === 'disabled' ? 'disabled' : syncStatus.state,
                  })
                : t('personal.sync.state.unknown', { defaultValue: '…' })}
            </Tag>
            {syncStatus && syncStatus.mode !== 'disabled' ? (
              <span className='text-12px text-t-secondary'>
                {t('personal.sync.lastSync', { defaultValue: '最近同步' })}:{' '}
                {syncStatus.lastSyncAt ? new Date(syncStatus.lastSyncAt).toLocaleString() : '—'}
                {syncStatus.pendingOutbox > 0
                  ? ` · ${t('personal.sync.pending', { defaultValue: '待重试' })} ${syncStatus.pendingOutbox}`
                  : ''}
              </span>
            ) : null}
            <div className='ml-auto flex flex-wrap gap-8px'>
              {syncStatus && syncStatus.mode !== 'disabled' ? (
                <>
                  <Button size='small' icon={<Refresh />} loading={syncBusy} onClick={() => void runSync()}>
                    {t('personal.sync.now', { defaultValue: '立即同步' })}
                  </Button>
                  <Popconfirm
                    title={t('personal.sync.disableConfirm', { defaultValue: '关闭后本机数据保留，仅停止同步。' })}
                    onOk={() => void turnOffSync()}
                  >
                    <Button size='small' status='danger' disabled={syncBusy}>
                      {t('personal.sync.off', { defaultValue: '关闭' })}
                    </Button>
                  </Popconfirm>
                </>
              ) : null}
            </div>
          </div>
          {syncReport ? (
            <div className='text-12px text-t-secondary' data-testid='cloud-sync-report'>
              {t('personal.sync.report', {
                defaultValue: '推送 {{pushed}} · 拉取 {{pulled}} · 冲突 {{conflicts}}',
                pushed: syncReport.pushed,
                pulled: syncReport.pulled,
                conflicts: syncReport.conflicts.length,
              })}
              {syncReport.conflicts.length > 0
                ? syncReport.conflicts
                    .map(
                      (conflict) =>
                        ` [${conflict.table}:${conflict.recordId} → ${conflict.recordId}.conflict-${conflict.remoteDeviceId}]`
                    )
                    .join('')
                : ''}
            </div>
          ) : null}
          <div className='grid grid-cols-1 gap-10px md:grid-cols-2'>
            <Select
              aria-label={t('personal.sync.mode', { defaultValue: '同步目标' })}
              value={syncForm.mode}
              disabled={syncBusy || (syncStatus?.mode ?? 'disabled') !== 'disabled'}
              onChange={(mode) => setSyncForm((current) => ({ ...current, mode: mode as 'webdav' | 's3' }))}
              options={[
                { value: 'webdav', label: 'WebDAV (HTTPS)' },
                { value: 's3', label: t('personal.sync.modeS3', { defaultValue: 'S3 兼容存储' }) },
              ]}
            />
            {syncForm.mode === 'webdav' ? (
              <>
                <input
                  className='h-32px rd-4px border border-solid border-border-2 bg-transparent px-8px text-13px text-t-primary'
                  aria-label={t('personal.sync.serverUrl', { defaultValue: 'HTTPS 服务器地址' })}
                  placeholder='https://dav.example.com/dav'
                  value={syncForm.serverUrl}
                  disabled={syncBusy || (syncStatus?.mode ?? 'disabled') !== 'disabled'}
                  onChange={(event) => setSyncForm((current) => ({ ...current, serverUrl: event.target.value }))}
                />
                <input
                  className='h-32px rd-4px border border-solid border-border-2 bg-transparent px-8px text-13px text-t-primary'
                  aria-label={t('personal.sync.username', { defaultValue: '用户名' })}
                  value={syncForm.username}
                  disabled={syncBusy || (syncStatus?.mode ?? 'disabled') !== 'disabled'}
                  onChange={(event) => setSyncForm((current) => ({ ...current, username: event.target.value }))}
                />
                <input
                  className='h-32px rd-4px border border-solid border-border-2 bg-transparent px-8px text-13px text-t-primary'
                  type='password'
                  aria-label={t('personal.sync.password', { defaultValue: '应用密码' })}
                  value={syncForm.password}
                  disabled={syncBusy || (syncStatus?.mode ?? 'disabled') !== 'disabled'}
                  onChange={(event) => setSyncForm((current) => ({ ...current, password: event.target.value }))}
                />
                <input
                  className='h-32px rd-4px border border-solid border-border-2 bg-transparent px-8px text-13px text-t-primary'
                  aria-label={t('personal.sync.rootPath', { defaultValue: '同步目录' })}
                  value={syncForm.rootPath}
                  disabled={syncBusy || (syncStatus?.mode ?? 'disabled') !== 'disabled'}
                  onChange={(event) => setSyncForm((current) => ({ ...current, rootPath: event.target.value }))}
                />
              </>
            ) : (
              <>
                <input
                  className='h-32px rd-4px border border-solid border-border-2 bg-transparent px-8px text-13px text-t-primary'
                  aria-label='HTTPS endpoint'
                  placeholder='https://s3.example.com'
                  value={syncForm.endpoint}
                  disabled={syncBusy || (syncStatus?.mode ?? 'disabled') !== 'disabled'}
                  onChange={(event) => setSyncForm((current) => ({ ...current, endpoint: event.target.value }))}
                />
                <input
                  className='h-32px rd-4px border border-solid border-border-2 bg-transparent px-8px text-13px text-t-primary'
                  aria-label='Region'
                  placeholder='us-east-1'
                  value={syncForm.region}
                  disabled={syncBusy || (syncStatus?.mode ?? 'disabled') !== 'disabled'}
                  onChange={(event) => setSyncForm((current) => ({ ...current, region: event.target.value }))}
                />
                <input
                  className='h-32px rd-4px border border-solid border-border-2 bg-transparent px-8px text-13px text-t-primary'
                  aria-label='Bucket'
                  value={syncForm.bucket}
                  disabled={syncBusy || (syncStatus?.mode ?? 'disabled') !== 'disabled'}
                  onChange={(event) => setSyncForm((current) => ({ ...current, bucket: event.target.value }))}
                />
                <input
                  className='h-32px rd-4px border border-solid border-border-2 bg-transparent px-8px text-13px text-t-primary'
                  aria-label='Access Key ID'
                  value={syncForm.accessKeyId}
                  disabled={syncBusy || (syncStatus?.mode ?? 'disabled') !== 'disabled'}
                  onChange={(event) => setSyncForm((current) => ({ ...current, accessKeyId: event.target.value }))}
                />
                <input
                  className='h-32px rd-4px border border-solid border-border-2 bg-transparent px-8px text-13px text-t-primary'
                  type='password'
                  aria-label='Secret Access Key'
                  value={syncForm.secretAccessKey}
                  disabled={syncBusy || (syncStatus?.mode ?? 'disabled') !== 'disabled'}
                  onChange={(event) => setSyncForm((current) => ({ ...current, secretAccessKey: event.target.value }))}
                />
              </>
            )}
            <input
              className='h-32px rd-4px border border-solid border-border-2 bg-transparent px-8px text-13px text-t-primary'
              type='password'
              aria-label={t('personal.sync.passphrase', { defaultValue: '同步口令（至少 8 位）' })}
              value={syncForm.passphrase}
              disabled={syncBusy || (syncStatus?.mode ?? 'disabled') !== 'disabled'}
              onChange={(event) => setSyncForm((current) => ({ ...current, passphrase: event.target.value }))}
            />
          </div>
          <div>
            <Button
              type='primary'
              loading={syncBusy}
              disabled={
                syncForm.passphrase.trim().length < 8 ||
                (syncStatus?.mode ?? 'disabled') !== 'disabled' ||
                (syncForm.mode === 'webdav'
                  ? !syncForm.serverUrl.trim() || !syncForm.username.trim()
                  : !syncForm.endpoint.trim() || !syncForm.bucket.trim())
              }
              onClick={() => void submitSyncConfig()}
            >
              {t('personal.sync.enable', { defaultValue: '开启云同步' })}
            </Button>
            <p className='mb-0 mt-8px text-12px text-t-secondary'>
              {t('personal.sync.passphraseHint', {
                defaultValue: '口令只保存在本机安全存储；忘记口令将无法解密云端数据，请妥善保管。',
              })}
            </p>
          </div>
        </div>
      </SettingSection>
      <WorkflowGrantSettings />
    </SettingsPageWrapper>
  );
};

export default PersonalWorkspaceSettings;
