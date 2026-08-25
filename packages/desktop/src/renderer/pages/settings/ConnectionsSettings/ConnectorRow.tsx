import React from 'react';
import { Button, Tag } from '@arco-design/web-react';
import {
  Calendar,
  CloudStorage,
  FolderOpen,
  LinkBreak,
  LinkCloud,
  Mail,
  PauseOne,
  Play,
  Refresh,
} from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { ConnectorAccount, ConnectorSyncResult } from '@/common/types/searcht/connectors';

type ConnectorRowProps = {
  account: ConnectorAccount;
  result?: ConnectorSyncResult;
  working: boolean;
  onSync(): void;
  onToggleState(): void;
  onDisconnect(): void;
};

export const ConnectorRow: React.FC<ConnectorRowProps> = ({
  account,
  result,
  working,
  onSync,
  onToggleState,
  onDisconnect,
}) => {
  const { t } = useTranslation();
  const detail =
    account.kind === 'local-folder'
      ? account.config.path
      : account.kind === 'email-imap'
        ? account.config.emailAddress
        : account.kind === 's3'
          ? `s3://${account.config.bucket}${account.config.prefix}`
          : account.kind === 'calendar-ics'
            ? t(`personal.connectors.ics.provider.${account.config.provider}`)
            : account.config.rootPath;
  const errorMessage = connectorErrorMessage(account, t);
  return (
    <div
      data-testid={`connector-row-${account.id}`}
      className='flex flex-col gap-12px py-16px sm:flex-row sm:items-center'
    >
      <div className='min-w-0 flex flex-1 items-start gap-12px'>
        <div className='mt-1px h-34px w-34px shrink-0 flex items-center justify-center bg-fill-2 rd-6px text-t-secondary'>
          {account.kind === 'email-imap' ? (
            <Mail size={18} />
          ) : account.kind === 'webdav' ? (
            <LinkCloud size={18} />
          ) : account.kind === 's3' ? (
            <CloudStorage size={18} />
          ) : account.kind === 'calendar-ics' ? (
            <Calendar size={18} />
          ) : (
            <FolderOpen size={18} />
          )}
        </div>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-8px'>
            <span className='truncate text-14px font-600 text-t-primary'>{account.displayName}</span>
            <ConnectorStateTag account={account} />
            {account.kind === 'email-imap' ? (
              <Tag size='small'>
                {account.config.provider === 'qq-mail'
                  ? t('personal.connectors.email.provider.qqMail')
                  : t('personal.connectors.email.provider.netease163')}
              </Tag>
            ) : account.kind === 'webdav' ? (
              <Tag size='small'>
                {account.config.provider === 'jianguoyun'
                  ? t('personal.connectors.webdav.provider.jianguoyun')
                  : t('personal.connectors.webdav.provider.custom')}
              </Tag>
            ) : account.kind === 's3' ? (
              <Tag size='small'>
                {account.config.provider === 'aws-s3'
                  ? t('personal.connectors.s3.provider.aws')
                  : account.config.provider === 'cloudflare-r2'
                    ? t('personal.connectors.s3.provider.r2')
                    : t('personal.connectors.s3.provider.custom')}
              </Tag>
            ) : account.kind === 'calendar-ics' ? (
              <Tag size='small'>{t(`personal.connectors.ics.provider.${account.config.provider}`)}</Tag>
            ) : null}
          </div>
          <div title={detail} className='mt-4px truncate text-12px text-t-secondary'>
            {detail}
          </div>
          <div className='mt-5px flex flex-wrap gap-x-12px gap-y-3px text-11px text-t-tertiary'>
            <span>
              {t('personal.connectors.lastSync')}:{' '}
              {account.lastSyncAt
                ? new Date(account.lastSyncAt).toLocaleString()
                : t('personal.connectors.neverSynced')}
            </span>
            {result ? (
              <span role='status'>
                {t('personal.connectors.syncResult', {
                  scanned: result.scanned,
                  imported: result.imported,
                  skipped: result.skipped,
                })}
              </span>
            ) : null}
          </div>
          {errorMessage ? <div className='mt-6px text-12px text-danger-6'>{errorMessage}</div> : null}
        </div>
      </div>
      <div className='flex shrink-0 flex-wrap items-center gap-6px sm:justify-end'>
        <Button
          type='text'
          size='small'
          icon={<Refresh />}
          loading={working}
          disabled={account.state === 'paused'}
          onClick={onSync}
        >
          {t('personal.connectors.actions.sync')}
        </Button>
        <Button
          type='text'
          size='small'
          icon={account.state === 'paused' ? <Play /> : <PauseOne />}
          disabled={working}
          onClick={onToggleState}
        >
          {account.state === 'paused'
            ? t('personal.connectors.actions.resume')
            : t('personal.connectors.actions.pause')}
        </Button>
        <Button type='text' size='small' status='danger' icon={<LinkBreak />} disabled={working} onClick={onDisconnect}>
          {t('personal.connectors.actions.disconnect')}
        </Button>
      </div>
    </div>
  );
};

const ConnectorStateTag: React.FC<{ account: ConnectorAccount }> = ({ account }) => {
  const { t } = useTranslation();
  return (
    <Tag size='small' color={account.state === 'active' ? 'green' : account.state === 'paused' ? 'gray' : 'red'}>
      {t(`personal.connectors.status.${account.state}`)}
    </Tag>
  );
};

function connectorErrorMessage(account: ConnectorAccount, t: (key: string) => string): string | null {
  if (account.lastErrorCode === 'CONNECTOR_FOLDER_UNAVAILABLE') return t('personal.connectors.folderUnavailable');
  if (account.lastErrorCode === 'CONNECTOR_EMAIL_MAILBOX_RESET') return t('personal.connectors.email.mailboxReset');
  if (account.lastErrorCode === 'CONNECTOR_EMAIL_CREDENTIAL_MISSING') {
    return t('personal.connectors.email.credentialMissing');
  }
  if (account.kind === 'email-imap' && account.state === 'error') {
    return t('personal.connectors.email.connectionFailed');
  }
  if (account.lastErrorCode === 'CONNECTOR_WEBDAV_CREDENTIAL_MISSING') {
    return t('personal.connectors.webdav.credentialMissing');
  }
  if (account.kind === 'webdav' && account.state === 'error') {
    return t('personal.connectors.webdav.connectionFailed');
  }
  if (account.lastErrorCode === 'CONNECTOR_S3_CREDENTIAL_MISSING') {
    return t('personal.connectors.s3.credentialMissing');
  }
  if (account.kind === 's3' && account.state === 'error') {
    return t('personal.connectors.s3.connectionFailed');
  }
  if (account.lastErrorCode === 'CONNECTOR_ICS_CREDENTIAL_MISSING') {
    return t('personal.connectors.ics.credentialMissing');
  }
  if (account.kind === 'calendar-ics' && account.state === 'error') {
    return t('personal.connectors.ics.connectionFailed');
  }
  return null;
}
