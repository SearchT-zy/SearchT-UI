import { describe, expect, it } from 'vitest';
import { resolveS3Connection, normalizeS3Prefix } from '@process/services/personal-core/connectors/s3/providerPresets';

describe('S3 provider presets', () => {
  it('fills the AWS endpoint from region and defaults to virtual-host style', () => {
    const credentials = resolveS3Connection({
      provider: 'aws-s3',
      region: 'us-east-1',
      bucket: 'MyBucket',
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
    });
    expect(credentials).toMatchObject({
      provider: 'aws-s3',
      endpoint: 'https://s3.us-east-1.amazonaws.com',
      region: 'us-east-1',
      bucket: 'mybucket',
      pathStyle: false,
      prefix: '',
    });
  });

  it('requires an HTTPS endpoint for custom and R2 providers', () => {
    expect(() =>
      resolveS3Connection({
        provider: 'custom-s3',
        region: 'us-east-1',
        bucket: 'bucket',
        accessKeyId: 'AKIA',
        secretAccessKey: 'secret',
      })
    ).toThrow('CONNECTOR_S3_ENDPOINT_REQUIRED');
    expect(() =>
      resolveS3Connection({
        provider: 'custom-s3',
        endpoint: 'http://s3.example.com',
        region: 'us-east-1',
        bucket: 'bucket',
        accessKeyId: 'AKIA',
        secretAccessKey: 'secret',
      })
    ).toThrow('CONNECTOR_S3_ENDPOINT_INVALID');
    expect(
      resolveS3Connection({
        provider: 'cloudflare-r2',
        endpoint: 'https://abc.r2.cloudflarestorage.com',
        region: 'auto',
        bucket: 'bucket',
        accessKeyId: 'AKIA',
        secretAccessKey: 'secret',
      }).pathStyle
    ).toBe(true);
  });

  it('rejects malformed buckets, regions, and prefixes', () => {
    const base = {
      provider: 'custom-s3' as const,
      endpoint: 'https://s3.example.com',
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
    };
    expect(() => resolveS3Connection({ ...base, region: 'us east 1', bucket: 'bucket' })).toThrow(
      'CONNECTOR_S3_REGION_INVALID'
    );
    expect(() => resolveS3Connection({ ...base, region: 'us-east-1', bucket: 'a' })).toThrow(
      'CONNECTOR_S3_BUCKET_INVALID'
    );
    expect(() => resolveS3Connection({ ...base, region: 'us-east-1', bucket: 'bucket', prefix: '../etc' })).toThrow(
      'CONNECTOR_S3_PREFIX_INVALID'
    );
    expect(normalizeS3Prefix('/notes/sub/')).toBe('notes/sub/');
    expect(normalizeS3Prefix('')).toBe('');
  });
});
