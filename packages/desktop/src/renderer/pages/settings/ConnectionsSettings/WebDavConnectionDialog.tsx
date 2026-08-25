import React, { useEffect, useState } from 'react';
import { Button, Form, Input, Modal, Radio } from '@arco-design/web-react';
import { CheckOne, Link, LinkCloud } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { ConnectorSyncResult, WebDavInitialSync, WebDavProvider } from '@/common/types/searcht/connectors';
import type { ConnectorSettingsClient } from './connectionsClient';
import './webdav-dialog.css';

type WebDavConnectionDialogProps = {
  visible: boolean;
  client: ConnectorSettingsClient;
  onCancel(): void;
  onConnected(result: ConnectorSyncResult): void;
};

export const WebDavConnectionDialog: React.FC<WebDavConnectionDialogProps> = ({
  visible,
  client,
  onCancel,
  onConnected,
}) => {
  const { t } = useTranslation();
  const [provider, setProvider] = useState<WebDavProvider>('jianguoyun');
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rootPath, setRootPath] = useState('/');
  const [displayName, setDisplayName] = useState('');
  const [initialSync, setInitialSync] = useState<WebDavInitialSync>('from-now');
  const [working, setWorking] = useState<'test' | 'connect' | null>(null);
  const [error, setError] = useState(false);
  const [tested, setTested] = useState(false);

  useEffect(() => {
    if (visible) return;
    setProvider('jianguoyun');
    setServerUrl('');
    setUsername('');
    setPassword('');
    setRootPath('/');
    setDisplayName('');
    setInitialSync('from-now');
    setWorking(null);
    setError(false);
    setTested(false);
  }, [visible]);

  const credentials = () => ({
    provider,
    ...(provider === 'custom-webdav' ? { serverUrl: serverUrl.trim() } : {}),
    username: username.trim(),
    password,
    rootPath: rootPath.trim() || '/',
  });

  const validate = (): boolean => {
    const valid = Boolean(
      username.trim() && password.trim() && rootPath.trim() && (provider === 'jianguoyun' || serverUrl.trim())
    );
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
      await client.testWebDav(credentials());
      setError(false);
      setTested(true);
    } catch {
      setPassword('');
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
      const result = await client.createWebDav({
        kind: 'webdav',
        ...credentials(),
        ...(name ? { displayName: name } : {}),
        initialSync,
      });
      onConnected(result);
    } catch {
      setPassword('');
      setError(true);
    } finally {
      setWorking(null);
    }
  };

  return (
    <Modal
      visible={visible}
      className='searcht-webdav-dialog'
      title={t('personal.connectors.webdav.dialogTitle')}
      footer={
        <div className='flex flex-wrap justify-end gap-8px'>
          <Button onClick={onCancel}>{t('common.cancel')}</Button>
          <Button
            icon={<Link />}
            loading={working === 'test'}
            disabled={working === 'connect'}
            onClick={testConnection}
          >
            {t('personal.connectors.webdav.test')}
          </Button>
          <Button
            type='primary'
            icon={<LinkCloud />}
            loading={working === 'connect'}
            disabled={working === 'test'}
            onClick={connect}
          >
            {t('personal.connectors.webdav.connect')}
          </Button>
        </div>
      }
      unmountOnExit={false}
      onCancel={onCancel}
    >
      <Form layout='vertical' className='mt-4px'>
        <Form.Item label={t('personal.connectors.webdav.providerLabel')}>
          <Radio.Group
            type='button'
            value={provider}
            onChange={(value) => {
              setProvider(value as WebDavProvider);
              setError(false);
              setTested(false);
            }}
          >
            <Radio value='jianguoyun'>{t('personal.connectors.webdav.provider.jianguoyun')}</Radio>
            <Radio value='custom-webdav'>{t('personal.connectors.webdav.provider.custom')}</Radio>
          </Radio.Group>
        </Form.Item>
        {provider === 'custom-webdav' ? (
          <Form.Item label={t('personal.connectors.webdav.serverUrlLabel')} required>
            <Input
              aria-label={t('personal.connectors.webdav.serverUrlLabel')}
              value={serverUrl}
              placeholder='https://dav.example.com/'
              maxLength={2048}
              onChange={updateField(setServerUrl)}
            />
          </Form.Item>
        ) : null}
        <Form.Item label={t('personal.connectors.webdav.usernameLabel')} required>
          <Input
            aria-label={t('personal.connectors.webdav.usernameLabel')}
            value={username}
            autoComplete='username'
            maxLength={4096}
            onChange={updateField(setUsername)}
          />
        </Form.Item>
        <Form.Item
          label={t('personal.connectors.webdav.passwordLabel')}
          extra={t('personal.connectors.webdav.passwordHint')}
          required
        >
          <Input.Password
            aria-label={t('personal.connectors.webdav.passwordLabel')}
            value={password}
            autoComplete='current-password'
            maxLength={4096}
            onChange={updateField(setPassword)}
          />
        </Form.Item>
        <Form.Item
          label={t('personal.connectors.webdav.rootPathLabel')}
          extra={t('personal.connectors.webdav.rootPathHint')}
          required
        >
          <Input
            aria-label={t('personal.connectors.webdav.rootPathLabel')}
            value={rootPath}
            maxLength={4096}
            onChange={updateField(setRootPath)}
          />
        </Form.Item>
        <Form.Item label={t('personal.connectors.webdav.displayNameLabel')}>
          <Input
            aria-label={t('personal.connectors.webdav.displayNameLabel')}
            value={displayName}
            maxLength={200}
            onChange={updateField(setDisplayName)}
          />
        </Form.Item>
        <Form.Item label={t('personal.connectors.webdav.initialSyncLabel')}>
          <Radio.Group value={initialSync} onChange={(value) => setInitialSync(value as WebDavInitialSync)}>
            <Radio value='from-now'>{t('personal.connectors.webdav.initialSync.fromNow')}</Radio>
            <Radio value='import-existing'>{t('personal.connectors.webdav.initialSync.importExisting')}</Radio>
          </Radio.Group>
        </Form.Item>
      </Form>
      {tested ? (
        <div className='flex items-center gap-8px text-13px text-success-6' role='status'>
          <CheckOne size={16} />
          {t('personal.connectors.webdav.testSuccess')}
        </div>
      ) : null}
      {error ? (
        <div className='border border-danger-3 bg-danger-1 px-12px py-10px rd-6px text-13px text-danger-6' role='alert'>
          {t('personal.connectors.webdav.connectionFailed')}
        </div>
      ) : null}
    </Modal>
  );
};
