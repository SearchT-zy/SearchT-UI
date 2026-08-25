import type { S3Provider } from '@/common/types/searcht/connectors';

export type S3ConnectionCredentials = {
  provider: S3Provider;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
  pathStyle: boolean;
};

export type S3RemoteObject = {
  key: string;
  name: string;
  sizeBytes: number;
  modifiedAt: number | null;
  etag: string | null;
};

export type S3FetchResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type S3Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string> }
) => Promise<S3FetchResponse>;

export type S3TransportFactory = (credentials: S3ConnectionCredentials) => S3Transport;

export type S3Transport = {
  requestObject(
    credentials: S3ConnectionCredentials,
    key: string,
    query: Record<string, string>
  ): Promise<S3FetchResponse>;
};
