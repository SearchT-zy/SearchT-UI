import React, { useEffect, useState } from 'react';
import { Button, Form, Input, Modal, Radio } from '@arco-design/web-react';
import { CheckOne, Link, Mail } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { ConnectorSyncResult, EmailInitialSync, EmailProvider } from '@/common/types/searcht/connectors';
import type { ConnectorSettingsClient } from './connectionsClient';

type EmailConnectionDialogProps = {
  visible: boolean;
  client: ConnectorSettingsClient;
  onCancel(): void;
  onConnected(result: ConnectorSyncResult): void;
};

export const EmailConnectionDialog: React.FC<EmailConnectionDialogProps> = ({
  visible,
  client,
  onCancel,
  onConnected,
}) => {
  const { t } = useTranslation();
  const [provider, setProvider] = useState<EmailProvider>('qq-mail');
  const [emailAddress, setEmailAddress] = useState('');
  const [authorizationCode, setAuthorizationCode] = useState('');
  const [initialSync, setInitialSync] = useState<EmailInitialSync>('from-now');
  const [working, setWorking] = useState<'test' | 'connect' | null>(null);
  const [error, setError] = useState(false);
  const [tested, setTested] = useState(false);

  useEffect(() => {
    if (visible) return;
    setProvider('qq-mail');
    setEmailAddress('');
    setAuthorizationCode('');
    setInitialSync('from-now');
    setWorking(null);
    setError(false);
    setTested(false);
  }, [visible]);

  const credentials = () => ({ provider, emailAddress: emailAddress.trim(), authorizationCode });

  const validate = (): boolean => {
    const valid = Boolean(emailAddress.trim() && authorizationCode.trim());
    setError(!valid);
    return valid;
  };

  const testConnection = async () => {
    if (!validate()) return;
    setWorking('test');
    setTested(false);
    try {
      await client.testEmail(credentials());
      setError(false);
      setTested(true);
    } catch {
      setAuthorizationCode('');
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
      const result = await client.createEmail({ kind: 'email-imap', ...credentials(), initialSync });
      onConnected(result);
    } catch {
      setAuthorizationCode('');
      setError(true);
    } finally {
      setWorking(null);
    }
  };

  return (
    <Modal
      visible={visible}
      title={t('personal.connectors.email.dialogTitle')}
      footer={
        <div className='flex flex-wrap justify-end gap-8px'>
          <Button onClick={onCancel}>{t('common.cancel')}</Button>
          <Button
            icon={<Link />}
            loading={working === 'test'}
            disabled={working === 'connect'}
            onClick={testConnection}
          >
            {t('personal.connectors.email.test')}
          </Button>
          <Button
            type='primary'
            icon={<Mail />}
            loading={working === 'connect'}
            disabled={working === 'test'}
            onClick={connect}
          >
            {t('personal.connectors.email.connect')}
          </Button>
        </div>
      }
      unmountOnExit={false}
      onCancel={onCancel}
    >
      <Form layout='vertical' className='mt-4px'>
        <Form.Item label={t('personal.connectors.email.providerLabel')}>
          <Radio.Group value={provider} onChange={(value) => setProvider(value as EmailProvider)}>
            <Radio value='qq-mail'>{t('personal.connectors.email.provider.qqMail')}</Radio>
            <Radio value='netease-163'>{t('personal.connectors.email.provider.netease163')}</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item label={t('personal.connectors.email.addressLabel')} required>
          <Input
            aria-label={t('personal.connectors.email.addressLabel')}
            value={emailAddress}
            autoComplete='username'
            maxLength={254}
            onChange={(value) => {
              setEmailAddress(value);
              setError(false);
              setTested(false);
            }}
          />
        </Form.Item>
        <Form.Item
          label={t('personal.connectors.email.authorizationCodeLabel')}
          extra={t('personal.connectors.email.authorizationCodeHint')}
          required
        >
          <Input.Password
            aria-label={t('personal.connectors.email.authorizationCodeLabel')}
            value={authorizationCode}
            autoComplete='current-password'
            maxLength={4096}
            onChange={(value) => {
              setAuthorizationCode(value);
              setError(false);
              setTested(false);
            }}
          />
        </Form.Item>
        <Form.Item label={t('personal.connectors.email.initialSyncLabel')}>
          <Radio.Group value={initialSync} onChange={(value) => setInitialSync(value as EmailInitialSync)}>
            <Radio value='from-now'>{t('personal.connectors.email.initialSync.fromNow')}</Radio>
            <Radio value='last-7-days'>{t('personal.connectors.email.initialSync.last7Days')}</Radio>
          </Radio.Group>
        </Form.Item>
      </Form>
      {tested ? (
        <div className='flex items-center gap-8px text-13px text-success-6' role='status'>
          <CheckOne size={16} />
          {t('personal.connectors.email.testSuccess')}
        </div>
      ) : null}
      {error ? (
        <div className='border border-danger-3 bg-danger-1 px-12px py-10px rd-6px text-13px text-danger-6' role='alert'>
          {t('personal.connectors.email.connectionFailed')}
        </div>
      ) : null}
    </Modal>
  );
};
