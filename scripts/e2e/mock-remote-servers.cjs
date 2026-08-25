/**
 * Local HTTPS WebDAV + S3 mock for connector/cloud-sync end-to-end testing.
 *
 *   node scripts/e2e/mock-remote-servers.cjs
 *
 * WebDAV (port 8443): OPTIONS/PROPFIND/GET/PUT under /dav with basic auth
 *   (user/pass). Pre-seeds one file so WebDAV connector sync imports it.
 * S3 (port 8444): ListObjectsV2 XML + GET object for bucket "e2e-bucket"
 *   (auth headers are accepted without verification — the client-side SigV4
 *   signature is already covered by unit tests).
 * Cloud sync storage shares the WebDAV tree at /sync.
 */

const https = require('https');
const { readFileSync, existsSync, mkdirSync, writeFileSync } = require('fs');
const path = require('path');

const root = path.resolve('mock-remote-storage');
mkdirSync(path.join(root, 'dav', 'docs'), { recursive: true });
mkdirSync(path.join(root, 'sync'), { recursive: true });
if (!existsSync(path.join(root, 'dav', 'docs', 'e2e-note.md'))) {
  writeFileSync(path.join(root, 'dav', 'docs', 'e2e-note.md'), '# E2E WebDAV file\ncreated by mock server');
}

const options = {
  key: readFileSync('E:/zy/desktop/mock-remote/key.pem'),
  cert: readFileSync('E:/zy/desktop/mock-remote/cert.pem'),
};

const AUTH = `Basic ${Buffer.from('user:pass').toString('base64')}`;

function propfind(body, files) {
  const entries = files
    .map(
      (file) => `<D:response>
        <D:href>${file.href}</D:href>
        <D:propstat><D:prop>
          <D:displayname>${file.name}</D:displayname>
          <D:getcontentlength>${file.size}</D:getcontentlength>
          <D:getlastmodified>${file.modified.toUTCString()}</D:getlastmodified>
          <D:getetag>"${file.etag}"</D:getetag>
          <D:resourcetype>${file.directory ? '<D:collection/>' : ''}</D:resourcetype>
        </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`
    )
    .join('');
  return `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">${entries}</D:multistatus>`;
}

https
  .createServer(options, (request, response) => {
    const url = new URL(request.url ?? '/', 'https://localhost');
    const pathname = decodeURIComponent(url.pathname);
    console.log(`[mock] ${request.method} ${pathname}`);

    if (pathname.startsWith('/e2e-bucket')) {
      handleS3(request, response, pathname, url);
      return;
    }

    if (request.headers.authorization !== AUTH) {
      response.writeHead(401, { 'www-authenticate': 'Basic realm="e2e"' });
      response.end();
      return;
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(200, { allow: 'OPTIONS, GET, PUT, PROPFIND' });
      response.end();
      return;
    }

    if (request.method === 'PROPFIND') {
      // Real servers return stable etag/last-modified; the connector relies on
      // them to skip unchanged files, so keep them constant here.
      const fixed = new Date('2026-08-24T00:00:00Z');
      const files = [
        { href: '/dav/', name: 'dav', directory: true, size: 0, modified: fixed, etag: 'dir' },
        { href: '/dav/docs/', name: 'docs', directory: true, size: 0, modified: fixed, etag: 'dir' },
        {
          href: '/dav/docs/e2e-note.md',
          name: 'e2e-note.md',
          directory: false,
          size: 44,
          modified: fixed,
          etag: 'e2e-etag-1',
        },
      ];
      response.writeHead(207, { 'content-type': 'application/xml' });
      response.end(propfind(null, files));
      return;
    }

    // WebDAV hrefs are absolute on the server root (/dav/..., /sync/...),
    // which maps 1:1 onto the mock storage tree.
    const fsPath = path.join(root, pathname);
    if (request.method === 'GET') {
      if (!existsSync(fsPath)) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(readFileSync(fsPath));
      return;
    }
    if (request.method === 'PUT') {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        const body = Buffer.concat(chunks);
        console.log(`[mock] PUT ${pathname} bytes=${body.length}`);
        mkdirSync(path.dirname(fsPath), { recursive: true });
        writeFileSync(fsPath, body);
        response.writeHead(201);
        response.end();
      });
      return;
    }
    response.writeHead(405);
    response.end();
  })
  .listen(8443, () => console.log('[mock] webdav+sync https on 8443 (user/pass), s3 on 8443/s3'));

function handleS3(request, response, pathname, url) {
  // Treat everything under /s3/ as bucket "e2e-bucket" regardless of signature.
  const query = url.searchParams;
  if (request.method === 'GET' && query.get('list-type') === '2') {
    const prefix = query.get('prefix') ?? '';
    const body = `<?xml version="1.0"?><ListBucketResult>
      <Name>e2e-bucket</Name><Prefix>${prefix}</Prefix><KeyCount>1</KeyCount><MaxKeys>1000</MaxKeys>
      <IsTruncated>false</IsTruncated>
      <Contents><Key>e2e-bucket-file.md</Key><LastModified>2026-08-24T00:00:00.000Z</LastModified>
      <ETag>&quot;s3-etag-1&quot;</ETag><Size>32</Size></Contents>
    </ListBucketResult>`;
    response.writeHead(200, { 'content-type': 'application/xml' });
    response.end(body);
    return;
  }
  if (request.method === 'GET') {
    response.writeHead(200, { 'content-type': 'text/markdown' });
    response.end('# E2E S3 object content');
    return;
  }
  if (request.method === 'PUT') {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      mkdirSync(path.join(root, 's3'), { recursive: true });
      mkdirSync(path.join(root, 's3'), { recursive: true });
      writeFileSync(path.join(root, 's3', pathname.split('/').filter(Boolean).join('~')), Buffer.concat(chunks));
      response.writeHead(200);
      response.end();
    });
    return;
  }
  response.writeHead(405);
  response.end();
}
