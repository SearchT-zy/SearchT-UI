import type { WebDavProvider } from '@/common/types/searcht/connectors';

export type WebDavConnectionCredentials = {
  provider: WebDavProvider;
  serverUrl: string;
  username: string;
  password: string;
  rootPath: string;
};

export type WebDavRemoteFile = {
  path: string;
  name: string;
  sizeBytes: number;
  modifiedAt: number | null;
  etag: string | null;
};

export type WebDavFileStat = {
  filename: string;
  basename: string;
  type: 'file' | 'directory';
  size: number;
  lastmod: string;
  etag: string | null;
};

export type WebDavTransport = {
  getDirectoryContents(path: string): Promise<WebDavFileStat[]>;
  createReadStream(path: string): NodeJS.ReadableStream;
};

export type WebDavTransportFactory = (
  serverUrl: string,
  options: { username: string; password: string; redirect: 'error' }
) => WebDavTransport;
