import React, { useEffect, useState } from 'react';
import { Button, Form, Input, Modal, Radio } from '@arco-design/web-react';
import { Calendar, CheckOne, Link } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { CalendarIcsProvider, ConnectorSyncResult } from '@/common/types/searcht/connectors';
import type { ConnectorSettingsClient } from './connectionsClient';

type CalendarIcsConnectionDialogProps = {
  visible: boolean;
  client: ConnectorSettingsClient;
  onCancel(): void;
  onConnected(result: ConnectorSyncResult): void;
};

export const CalendarIcsConnectionDialog: React.FC<CalendarIcsConnectionDialogProps> = ({
  visible,
  client,
  onCancel,
  onConnected,
}) => {
  const { t } = useTranslation();
  const [provider, setProvider] = useState<CalendarIcsProvider>('feishu');
  const [url, setUrl] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [working, setWorking] = useState<'test' | 'connect' | null>(null);
  const [error, setError] = useState(false);
  const [tested, setTested] = useState(false);

  useEffect(() => {
    if (visible) return;
    setProvider('feishu');
    setUrl('');
    setDisplayName('');
    setWorking(null);
    setError(false);
    setTested(false);
  }, [visible]);

  const credentials = () => ({ provider, url: url.trim() });

  const validate = (): boolean => {
    const valid = Boolean(url.trim());
    setError(!valid);
    return valid;
  };

  const updateField = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setError(false);
    setTested(false);
  };

  const testConnection = async () => {
    if (!validate()) return;
    setWorking('test');
    setTested(false);
    try {
      await client.testCalendarIcs(credentials());
      setError(false);
      setTested(true);
    } catch {
      setError(true);
    } finally {
      setWorking(null);
    }
  };

  const connect = async () => {
    if (!validate()) return;
    setWorking('connect');
    setTested(false);
    try {
      const name = displayName.trim();
      const result = await client.createCalendarIcs({
        kind: 'calendar-ics',
        ...credentials(),
        ...(name ? { displayName: name } : {}),
        initialSync: 'import-existing',
      });
      onConnected(result);
    } catch {
      setError(true);
    } finally {
      setWorking(null);
    }
  };

  return (
    <Modal
      visible={visible}
      className='searcht-webdav-dialog'
      title={t('personal.connectors.ics.dialogTitle')}
      footer={
        <div className='flex flex-wrap justify-end gap-8px'>
          <Button onClick={onCancel}>{t('common.cancel')}</Button>
          <Button
            icon={<Link />}
            loading={working === 'test'}
            disabled={working === 'connect'}
            onClick={testConnection}
          >
            {t('personal.connectors.ics.test')}
          </Button>
          <Button
            type='primary'
            icon={<Calendar />}
            loading={working === 'connect'}
            disabled={working === 'test'}
            onClick={connect}
          >
            {t('personal.connectors.ics.connect')}
          </Button>
        </div>
      }
      unmountOnExit={false}
      onCancel={onCancel}
    >
      <Form layout='vertical' className='mt-4px'>
        <Form.Item label={t('personal.connectors.ics.providerLabel')}>
          <Radio.Group
            type='button'
            value={provider}
            onChange={(value) => {
              setProvider(value as CalendarIcsProvider);
              setError(false);
              setTested(false);
            }}
          >
            <Radio value='feishu'>{t('personal.connectors.ics.provider.feishu')}</Radio>
            <Radio value='outlook'>{t('personal.connectors.ics.provider.outlook')}</Radio>
            <Radio value='dingtalk'>{t('personal.connectors.ics.provider.dingtalk')}</Radio>
            <Radio value='wecom'>{t('personal.connectors.ics.provider.wecom')}</Radio>
            <Radio value='custom-ics'>{t('personal.connectors.ics.provider.custom')}</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item label={t('personal.connectors.ics.urlLabel')} extra={t('personal.connectors.ics.urlHint')} required>
          <Input
            aria-label={t('personal.connectors.ics.urlLabel')}
            value={url}
            placeholder='https://calendar.feishu.cn/...'
            maxLength={2048}
            onChange={updateField(setUrl)}
          />
        </Form.Item>
        <Form.Item label={t('personal.connectors.ics.displayNameLabel')}>
          <Input
            aria-label={t('personal.connectors.ics.displayNameLabel')}
            value={displayName}
            maxLength={200}
            onChange={updateField(setDisplayName)}
          />
        </Form.Item>
      </Form>
      {tested ? (
        <div className='flex items-center gap-8px text-13px text-success-6' role='status'>
          <CheckOne size={16} />
          {t('personal.connectors.ics.testSuccess')}
        </div>
      ) : null}
      {error ? (
        <div className='border border-danger-3 bg-danger-1 px-12px py-10px rd-6px text-13px text-danger-6' role='alert'>
          {t('personal.connectors.ics.connectionFailed')}
        </div>
      ) : null}
    </Modal>
  );
};
