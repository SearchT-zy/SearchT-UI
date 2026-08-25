import React, { useEffect, useState } from 'react';
import { Button, Empty, Message, Modal, Spin, Switch } from '@arco-design/web-react';
import { Calendar, CloudStorage, FolderOpen, FolderPlus, LinkCloud, Mail } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { ConnectorAccount, ConnectorSyncResult } from '@/common/types/searcht/connectors';
import { isElectronDesktop } from '@renderer/utils/platform';
import SettingsPageHeader from '../components/SettingsPageHeader';
import SettingsPageWrapper from '../components/SettingsPageWrapper';
import { ConnectorRow } from './ConnectorRow';
import { EmailConnectionDialog } from './EmailConnectionDialog';
import { WebDavConnectionDialog } from './WebDavConnectionDialog';
import { S3ConnectionDialog } from './S3ConnectionDialog';
import { CalendarIcsConnectionDialog } from './CalendarIcsConnectionDialog';
import { connectorSettingsClient, type ConnectorSettingsClient } from './connectionsClient';

export type { ConnectorSettingsClient } from './connectionsClient';

type ConnectionsSettingsProps = {
  desktop?: boolean;
  client?: ConnectorSettingsClient;
  pickFolder?: () => Promise<string | null>;
};

const ConnectionsSettings: React.FC<ConnectionsSettingsProps> = ({
  desktop = isElectronDesktop(),
  client = connectorSettingsClient,
  pickFolder = selectFolder,
}) => {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<ConnectorAccount[]>([]);
  const [loading, setLoading] = useState(desktop);
  const [includeSubfolders, setIncludeSubfolders] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  const [emailDialogVisible, setEmailDialogVisible] = useState(false);
  const [webDavDialogVisible, setWebDavDialogVisible] = useState(false);
  const [s3DialogVisible, setS3DialogVisible] = useState(false);
  const [calendarIcsDialogVisible, setCalendarIcsDialogVisible] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [results, setResults] = useState<Record<string, ConnectorSyncResult>>({});
  const [disconnecting, setDisconnecting] = useState<ConnectorAccount | null>(null);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void client
      .list()
      .then((value) => {
        if (!active) return;
        setAccounts(value);
        setLoadError(false);
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, desktop]);

  const replaceAccount = (account: ConnectorAccount) => {
    setAccounts((current) => current.map((value) => (value.id === account.id ? account : value)));
  };

  const recordResult = (result: ConnectorSyncResult) => {
    setAccounts((current) => [...current.filter((value) => value.id !== result.connector.id), result.connector]);
    setResults((current) => ({ ...current, [result.connector.id]: result }));
  };

  const addFolder = async () => {
    const folderPath = await pickFolder();
    if (!folderPath) return;
    setAddingFolder(true);
    try {
      recordResult(await client.create({ kind: 'local-folder', path: folderPath, includeSubfolders }));
    } catch {
      Message.error(t('personal.connectors.actionFailed'));
    } finally {
      setAddingFolder(false);
    }
  };

  const sync = async (id: string) => {
    setWorkingId(id);
    try {
      const result = await client.sync(id);
      replaceAccount(result.connector);
      setResults((current) => ({ ...current, [id]: result }));
    } catch {
      Message.error(t('personal.connectors.actionFailed'));
      void client
        .list()
        .then(setAccounts)
        .catch(() => {
          // Keep the last visible state when the follow-up refresh is unavailable.
        });
    } finally {
      setWorkingId(null);
    }
  };

  const toggleState = async (account: ConnectorAccount) => {
    setWorkingId(account.id);
    try {
      replaceAccount(
        await client.setState({ id: account.id, state: account.state === 'paused' ? 'active' : 'paused' })
      );
    } catch {
      Message.error(t('personal.connectors.actionFailed'));
    } finally {
      setWorkingId(null);
    }
  };

  const confirmDisconnect = async () => {
    if (!disconnecting) return;
    setWorkingId(disconnecting.id);
    try {
      await client.disconnect(disconnecting.id);
      setAccounts((current) => current.filter((value) => value.id !== disconnecting.id));
      setDisconnecting(null);
    } catch {
      Message.error(t('personal.connectors.actionFailed'));
    } finally {
      setWorkingId(null);
    }
  };

  const folders = accounts.filter((account) => account.kind === 'local-folder');
  const emailAccounts = accounts.filter((account) => account.kind === 'email-imap');
  const webDavAccounts = accounts.filter((account) => account.kind === 'webdav');
  const s3Accounts = accounts.filter((account) => account.kind === 's3');
  const calendarIcsAccounts = accounts.filter((account) => account.kind === 'calendar-ics');

  return (
    <SettingsPageWrapper>
      <div className='flex flex-col gap-20px'>
        <SettingsPageHeader
          title={t('personal.connectors.title')}
          description={t('personal.connectors.description')}
          actions={
            desktop ? (
              <div className='flex flex-wrap justify-end gap-8px'>
                <Button icon={<LinkCloud />} onClick={() => setWebDavDialogVisible(true)}>
                  {t('personal.connectors.addWebDav')}
                </Button>
                <Button icon={<CloudStorage />} onClick={() => setS3DialogVisible(true)}>
                  {t('personal.connectors.addS3')}
                </Button>
                <Button icon={<Calendar />} onClick={() => setCalendarIcsDialogVisible(true)}>
                  {t('personal.connectors.addCalendarIcs')}
                </Button>
                <Button icon={<Mail />} onClick={() => setEmailDialogVisible(true)}>
                  {t('personal.connectors.addEmail')}
                </Button>
                <Button type='primary' icon={<FolderPlus />} loading={addingFolder} onClick={() => void addFolder()}>
                  {t('personal.connectors.addFolder')}
                </Button>
              </div>
            ) : null
          }
        />

        {desktop ? (
          <div className='flex items-center justify-between gap-16px border-b border-border-2 pb-14px'>
            <div className='min-w-0'>
              <div className='text-13px font-500 text-t-primary'>{t('personal.connectors.includeSubfolders')}</div>
              <div className='mt-3px text-12px leading-18px text-t-secondary'>
                {t('personal.connectors.includeSubfoldersHint')}
              </div>
            </div>
            <Switch
              aria-label={t('personal.connectors.includeSubfolders')}
              checked={includeSubfolders}
              onChange={setIncludeSubfolders}
            />
          </div>
        ) : null}

        {!desktop ? (
          <div className='flex items-start gap-12px border border-border-2 bg-2 px-16px py-14px rd-8px'>
            <FolderOpen className='mt-2px shrink-0 text-t-secondary' size={20} />
            <p className='m-0 text-13px leading-20px text-t-secondary'>{t('personal.connectors.desktopOnlyAll')}</p>
          </div>
        ) : loading ? (
          <div className='h-180px flex items-center justify-center'>
            <Spin />
          </div>
        ) : loadError ? (
          <div
            role='alert'
            className='border border-danger-3 bg-danger-1 px-14px py-12px rd-8px text-13px text-danger-6'
          >
            {t('personal.connectors.loadFailed')}
          </div>
        ) : accounts.length === 0 ? (
          <div className='border border-border-2 border-dashed py-36px rd-8px'>
            <Empty
              icon={<FolderOpen size={36} className='text-t-tertiary' />}
              description={
                <div>
                  <div className='text-14px font-500 text-t-primary'>{t('personal.connectors.emptyAllTitle')}</div>
                  <div className='mt-5px text-12px text-t-secondary'>
                    {t('personal.connectors.emptyAllDescription')}
                  </div>
                </div>
              }
            />
          </div>
        ) : (
          <div className='flex flex-col gap-24px'>
            <ConnectorSection
              title={t('personal.connectors.webdav.sectionTitle')}
              description={t('personal.connectors.webdav.sectionDescription')}
              accounts={webDavAccounts}
              results={results}
              workingId={workingId}
              onSync={sync}
              onToggleState={toggleState}
              onDisconnect={setDisconnecting}
            />
            <ConnectorSection
              title={t('personal.connectors.s3.sectionTitle')}
              description={t('personal.connectors.s3.sectionDescription')}
              accounts={s3Accounts}
              results={results}
              workingId={workingId}
              onSync={sync}
              onToggleState={toggleState}
              onDisconnect={setDisconnecting}
            />
            <ConnectorSection
              title={t('personal.connectors.ics.sectionTitle')}
              description={t('personal.connectors.ics.sectionDescription')}
              accounts={calendarIcsAccounts}
              results={results}
              workingId={workingId}
              onSync={sync}
              onToggleState={toggleState}
              onDisconnect={setDisconnecting}
            />
            <ConnectorSection
              title={t('personal.connectors.email.sectionTitle')}
              description={t('personal.connectors.email.sectionDescription')}
              accounts={emailAccounts}
              results={results}
              workingId={workingId}
              onSync={sync}
              onToggleState={toggleState}
              onDisconnect={setDisconnecting}
            />
            <section>
              <div className='border-b border-border-2 pb-12px'>
                <div className='min-w-0'>
                  <h3 className='m-0 text-14px font-600 text-t-primary'>
                    {t('personal.connectors.folder.sectionTitle')}
                  </h3>
                  <p className='m-0 mt-3px text-12px leading-18px text-t-secondary'>
                    {t('personal.connectors.folder.sectionDescription')}
                  </p>
                </div>
              </div>
              <ConnectorRows
                accounts={folders}
                results={results}
                workingId={workingId}
                onSync={sync}
                onToggleState={toggleState}
                onDisconnect={setDisconnecting}
              />
            </section>
          </div>
        )}

        {desktop ? (
          <EmailConnectionDialog
            visible={emailDialogVisible}
            client={client}
            onCancel={() => setEmailDialogVisible(false)}
            onConnected={(result) => {
              recordResult(result);
              setEmailDialogVisible(false);
            }}
          />
        ) : null}
        {desktop ? (
          <WebDavConnectionDialog
            visible={webDavDialogVisible}
            client={client}
            onCancel={() => setWebDavDialogVisible(false)}
            onConnected={(result) => {
              recordResult(result);
              setWebDavDialogVisible(false);
            }}
          />
        ) : null}
        {desktop ? (
          <S3ConnectionDialog
            visible={s3DialogVisible}
            client={client}
            onCancel={() => setS3DialogVisible(false)}
            onConnected={(result) => {
              recordResult(result);
              setS3DialogVisible(false);
            }}
          />
        ) : null}
        {desktop ? (
          <CalendarIcsConnectionDialog
            visible={calendarIcsDialogVisible}
            client={client}
            onCancel={() => setCalendarIcsDialogVisible(false)}
            onConnected={(result) => {
              recordResult(result);
              setCalendarIcsDialogVisible(false);
            }}
          />
        ) : null}
        <Modal
          visible={Boolean(disconnecting)}
          title={
            disconnecting?.kind === 'email-imap'
              ? t('personal.connectors.email.disconnectTitle')
              : disconnecting?.kind === 'webdav'
                ? t('personal.connectors.webdav.disconnectTitle')
                : disconnecting?.kind === 's3'
                  ? t('personal.connectors.s3.disconnectTitle')
                  : disconnecting?.kind === 'calendar-ics'
                    ? t('personal.connectors.ics.disconnectTitle')
                    : t('personal.connectors.disconnectTitle')
          }
          okText={t('personal.connectors.disconnectConfirm')}
          cancelText={t('common.cancel')}
          okButtonProps={{ status: 'danger' }}
          confirmLoading={Boolean(disconnecting && workingId === disconnecting.id)}
          onCancel={() => setDisconnecting(null)}
          onOk={() => void confirmDisconnect()}
        >
          <p>
            {disconnecting?.kind === 'email-imap'
              ? t('personal.connectors.email.disconnectDescription')
              : disconnecting?.kind === 'webdav'
                ? t('personal.connectors.webdav.disconnectDescription')
                : disconnecting?.kind === 's3'
                  ? t('personal.connectors.s3.disconnectDescription')
                  : disconnecting?.kind === 'calendar-ics'
                    ? t('personal.connectors.ics.disconnectDescription')
                    : t('personal.connectors.disconnectDescription')}
          </p>
        </Modal>
      </div>
    </SettingsPageWrapper>
  );
};

type SectionProps = {
  title: string;
  description: string;
  accounts: ConnectorAccount[];
  results: Record<string, ConnectorSyncResult>;
  workingId: string | null;
  onSync(id: string): void;
  onToggleState(account: ConnectorAccount): void;
  onDisconnect(account: ConnectorAccount): void;
};

const ConnectorSection: React.FC<SectionProps> = ({ title, description, ...rows }) => (
  <section>
    <div className='border-b border-border-2 pb-12px'>
      <h3 className='m-0 text-14px font-600 text-t-primary'>{title}</h3>
      <p className='m-0 mt-3px text-12px leading-18px text-t-secondary'>{description}</p>
    </div>
    <ConnectorRows {...rows} />
  </section>
);

const ConnectorRows: React.FC<Omit<SectionProps, 'title' | 'description'>> = ({
  accounts,
  results,
  workingId,
  onSync,
  onToggleState,
  onDisconnect,
}) => (
  <div className='flex flex-col divide-y divide-border-2'>
    {accounts.map((account) => (
      <ConnectorRow
        key={account.id}
        account={account}
        result={results[account.id]}
        working={workingId === account.id}
        onSync={() => onSync(account.id)}
        onToggleState={() => onToggleState(account)}
        onDisconnect={() => onDisconnect(account)}
      />
    ))}
  </div>
);

async function selectFolder(): Promise<string | null> {
  const folders = await ipcBridge.dialog.showOpen.invoke({ properties: ['openDirectory', 'createDirectory'] });
  return folders?.[0] ?? null;
}

export default ConnectionsSettings;
