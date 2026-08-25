import { describe, expect, it, vi } from 'vitest';
import {
  S3ReadClient,
  buildAuthorizationHeader,
  buildRequestTarget,
} from '@process/services/personal-core/connectors/s3/S3ReadClient';
import type { S3ConnectionCredentials, S3FetchResponse } from '@process/services/personal-core/connectors/s3/types';

function makeTestCredentials(): S3ConnectionCredentials {
  return {
    provider: 'custom-s3',
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    bucket: 'bucket',
    accessKeyId: process.env.SEARCHT_UNIT_TEST_S3_ACCESS_KEY_ID ?? 'unit-test-access-key-id',
    secretAccessKey: process.env.SEARCHT_UNIT_TEST_S3_SECRET_ACCESS_KEY ?? 'unit-test-secret-access-key',
    prefix: '',
    pathStyle: true,
  };
}

function jsonResponse(body: string, status = 200): S3FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer,
  };
}

describe('S3 SigV4 client', () => {
  it('signs list requests with a deterministic authorization header', () => {
    const credentials = makeTestCredentials();
    const target = buildRequestTarget(credentials, '', { 'list-type': '2', prefix: 'notes/' });
    expect(target.host).toBe('s3.example.com');
    expect(target.canonicalUri).toBe('/bucket');
    expect(target.canonicalQuery).toBe('list-type=2&prefix=notes%2F');

    const { headers } = buildAuthorizationHeader(credentials, target, '20260824T000000Z', '20260824');
    expect(headers.authorization).toMatch(
      new RegExp(
        `^AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/20260824/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$`
      )
    );
  });

  it('uses virtual-host addressing when path style is disabled', () => {
    const target = buildRequestTarget({ ...makeTestCredentials(), pathStyle: false }, 'docs/file.txt', {});
    expect(target.host).toBe('bucket.s3.example.com');
    expect(target.canonicalUri).toBe('/docs/file.txt');
  });

  it('lists objects across continuation pages and normalizes entries', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('continuation-token=PAGE2')) {
        return jsonResponse(
          '<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>' +
            '<Contents><Key>notes/b.md</Key><Size>20</Size><LastModified>2026-08-01T00:00:00.000Z</LastModified><ETag>&quot;b2&quot;</ETag></Contents>' +
            '</ListBucketResult>'
        );
      }
      return jsonResponse(
        '<?xml version="1.0"?><ListBucketResult><IsTruncated>true</IsTruncated>' +
          '<NextContinuationToken>PAGE2</NextContinuationToken>' +
          '<Contents><Key>notes/a.md</Key><Size>10</Size><LastModified>2026-08-01T00:00:00.000Z</LastModified><ETag>&quot;a1&quot;</ETag></Contents>' +
          '</ListBucketResult>'
      );
    });
    const client = new S3ReadClient(() => ({
      requestObject: async (creds, key, query) =>
        fetchImpl(`https://${creds.endpoint}/${key}?${new URLSearchParams(query)}`),
    }));

    const objects = await client.listObjects({ ...makeTestCredentials(), prefix: 'notes/' }, 100);

    expect(objects.map((object) => object.key)).toEqual(['notes/a.md', 'notes/b.md']);
    expect(objects[0]).toMatchObject({ name: 'a.md', sizeBytes: 10, etag: 'a1' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('surfaces HTTP failures as stable connector error codes', async () => {
    const client = new S3ReadClient(() => ({
      requestObject: async () => jsonResponse('<Error/>', 403),
    }));
    await expect(client.test(makeTestCredentials())).rejects.toThrow('CONNECTOR_S3_HTTP_403');
  });
});
