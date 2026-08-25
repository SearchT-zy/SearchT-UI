import React, { useEffect, useState } from 'react';
import { Button, Form, Input, Modal, Radio, Switch } from '@arco-design/web-react';
import { CheckOne, Link, LinkCloud } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { ConnectorSyncResult, S3InitialSync, S3Provider } from '@/common/types/searcht/connectors';
import type { ConnectorSettingsClient } from './connectionsClient';

type S3ConnectionDialogProps = {
  visible: boolean;
  client: ConnectorSettingsClient;
  onCancel(): void;
  onConnected(result: ConnectorSyncResult): void;
};

export const S3ConnectionDialog: React.FC<S3ConnectionDialogProps> = ({ visible, client, onCancel, onConnected }) => {
  const { t } = useTranslation();
  const [provider, setProvider] = useState<S3Provider>('custom-s3');
  const [endpoint, setEndpoint] = useState('');
  const [region, setRegion] = useState('');
  const [bucket, setBucket] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [prefix, setPrefix] = useState('');
  const [pathStyle, setPathStyle] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [initialSync, setInitialSync] = useState<S3InitialSync>('from-now');
  const [working, setWorking] = useState<'test' | 'connect' | null>(null);
  const [error, setError] = useState(false);
  const [tested, setTested] = useState(false);

  useEffect(() => {
    if (visible) return;
    setProvider('custom-s3');
    setEndpoint('');
    setRegion('');
    setBucket('');
    setAccessKeyId('');
    setSecretAccessKey('');
    setPrefix('');
    setPathStyle(true);
    setDisplayName('');
    setInitialSync('from-now');
    setWorking(null);
    setError(false);
    setTested(false);
  }, [visible]);

  const credentials = () => ({
    provider,
    ...(provider === 'aws-s3' && endpoint.trim() ? { endpoint: endpoint.trim() } : {}),
    ...(provider !== 'aws-s3' ? { endpoint: endpoint.trim() } : {}),
    region: region.trim(),
    bucket: bucket.trim(),
    accessKeyId: accessKeyId.trim(),
    secretAccessKey,
    ...(prefix.trim() ? { prefix: prefix.trim() } : {}),
    pathStyle: provider === 'aws-s3' ? pathStyle : true,
  });

  const validate = (): boolean => {
    const endpointRequired = provider !== 'aws-s3';
    const valid = Boolean(
      region.trim() &&
      bucket.trim() &&
      accessKeyId.trim() &&
      secretAccessKey.trim() &&
      (!endpointRequired || endpoint.trim())
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
      await client.testS3(credentials());
      setError(false);
      setTested(true);
    } catch {
      setSecretAccessKey('');
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
      const result = await client.createS3({
        kind: 's3',
        ...credentials(),
        ...(name ? { displayName: name } : {}),
        initialSync,
      });
      onConnected(result);
    } catch {
      setSecretAccessKey('');
      setError(true);
    } finally {
      setWorking(null);
    }
  };

  return (
    <Modal
      visible={visible}
      className='searcht-webdav-dialog'
      title={t('personal.connectors.s3.dialogTitle')}
      footer={
        <div className='flex flex-wrap justify-end gap-8px'>
          <Button onClick={onCancel}>{t('common.cancel')}</Button>
          <Button
            icon={<Link />}
            loading={working === 'test'}
            disabled={working === 'connect'}
            onClick={testConnection}
          >
            {t('personal.connectors.s3.test')}
          </Button>
          <Button
            type='primary'
            icon={<LinkCloud />}
            loading={working === 'connect'}
            disabled={working === 'test'}
            onClick={connect}
          >
            {t('personal.connectors.s3.connect')}
          </Button>
        </div>
      }
      unmountOnExit={false}
      onCancel={onCancel}
    >
      <Form layout='vertical' className='mt-4px'>
        <Form.Item label={t('personal.connectors.s3.providerLabel')}>
          <Radio.Group
            type='button'
            value={provider}
            onChange={(value) => {
              setProvider(value as S3Provider);
              setError(false);
              setTested(false);
            }}
          >
            <Radio value='custom-s3'>{t('personal.connectors.s3.provider.custom')}</Radio>
            <Radio value='aws-s3'>{t('personal.connectors.s3.provider.aws')}</Radio>
            <Radio value='cloudflare-r2'>{t('personal.connectors.s3.provider.r2')}</Radio>
          </Radio.Group>
        </Form.Item>
        {provider !== 'aws-s3' ? (
          <Form.Item label={t('personal.connectors.s3.endpointLabel')} required>
            <Input
              aria-label={t('personal.connectors.s3.endpointLabel')}
              value={endpoint}
              placeholder='https://s3.example.com'
              maxLength={2048}
              onChange={updateField(setEndpoint)}
            />
          </Form.Item>
        ) : null}
        <Form.Item label={t('personal.connectors.s3.regionLabel')} required>
          <Input
            aria-label={t('personal.connectors.s3.regionLabel')}
            value={region}
            placeholder='us-east-1'
            maxLength={64}
            onChange={updateField(setRegion)}
          />
        </Form.Item>
        <Form.Item label={t('personal.connectors.s3.bucketLabel')} required>
          <Input
            aria-label={t('personal.connectors.s3.bucketLabel')}
            value={bucket}
            maxLength={63}
            onChange={updateField(setBucket)}
          />
        </Form.Item>
        <Form.Item label={t('personal.connectors.s3.accessKeyIdLabel')} required>
          <Input
            aria-label={t('personal.connectors.s3.accessKeyIdLabel')}
            value={accessKeyId}
            maxLength={4096}
            onChange={updateField(setAccessKeyId)}
          />
        </Form.Item>
        <Form.Item label={t('personal.connectors.s3.secretAccessKeyLabel')} required>
          <Input.Password
            aria-label={t('personal.connectors.s3.secretAccessKeyLabel')}
            value={secretAccessKey}
            maxLength={4096}
            onChange={updateField(setSecretAccessKey)}
          />
        </Form.Item>
        <Form.Item label={t('personal.connectors.s3.prefixLabel')} extra={t('personal.connectors.s3.prefixHint')}>
          <Input
            aria-label={t('personal.connectors.s3.prefixLabel')}
            value={prefix}
            maxLength={1024}
            onChange={updateField(setPrefix)}
          />
        </Form.Item>
        {provider === 'aws-s3' ? (
          <Form.Item label={t('personal.connectors.s3.pathStyleLabel')}>
            <Switch checked={pathStyle} onChange={setPathStyle} />
          </Form.Item>
        ) : null}
        <Form.Item label={t('personal.connectors.s3.displayNameLabel')}>
          <Input
            aria-label={t('personal.connectors.s3.displayNameLabel')}
            value={displayName}
            maxLength={200}
            onChange={updateField(setDisplayName)}
          />
        </Form.Item>
        <Form.Item label={t('personal.connectors.s3.initialSyncLabel')}>
          <Radio.Group value={initialSync} onChange={(value) => setInitialSync(value as S3InitialSync)}>
            <Radio value='from-now'>{t('personal.connectors.s3.initialSync.fromNow')}</Radio>
            <Radio value='import-existing'>{t('personal.connectors.s3.initialSync.importExisting')}</Radio>
          </Radio.Group>
        </Form.Item>
      </Form>
      {tested ? (
        <div className='flex items-center gap-8px text-13px text-success-6' role='status'>
          <CheckOne size={16} />
          {t('personal.connectors.s3.testSuccess')}
        </div>
      ) : null}
      {error ? (
        <div className='border border-danger-3 bg-danger-1 px-12px py-10px rd-6px text-13px text-danger-6' role='alert'>
          {t('personal.connectors.s3.connectionFailed')}
        </div>
      ) : null}
    </Modal>
  );
};
