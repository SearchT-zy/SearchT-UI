#!/usr/bin/env node
/**
 * Minimal static file server for SearchT update feeds and staged installers.
 *
 * Serves one directory over HTTP with correct Content-Type for the
 * electron-updater feed files (latest.yml, .exe, .blockmap). Intended for
 * LAN staging and internal update testing before uploading to a real CDN.
 *
 * Usage:
 *   node scripts/release/update-server.mjs [port] [directory]
 *   port defaults to 8787, directory defaults to ./release-stage
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';

const port = Number(process.argv[2] ?? 8787);
const root = path.resolve(process.argv[3] ?? 'release-stage');

if (!existsSync(root)) {
  console.error(`[update-server] directory not found: ${root}`);
  process.exit(1);
}

const CONTENT_TYPES = {
  '.yml': 'text/yaml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.exe': 'application/octet-stream',
  '.blockmap': 'application/octet-stream',
  '.zip': 'application/octet-stream',
  '.dmg': 'application/octet-stream',
  '.AppImage': 'application/octet-stream',
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
  // Only flat or nested GET requests under the root are allowed; decode and
  // confine the resolved path to the served directory.
  const requested = path.normalize(decodeURIComponent(url.pathname)).replaceAll('\\', '/');
  const resolved = path.resolve(root, `.${requested.startsWith('/') ? requested : `/${requested}`}`);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    response.writeHead(403);
    response.end('forbidden');
    return;
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    response.writeHead(404);
    response.end('not found');
    return;
  }
  const contentType = CONTENT_TYPES[path.extname(resolved).toLowerCase()] ?? 'application/octet-stream';
  response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-cache' });
  createReadStream(resolved).pipe(response);
});

server.listen(port, () => {
  console.log(`[update-server] serving ${root} at http://127.0.0.1:${port}/`);
  console.log('[update-server] set SEARCHT_UPDATE_BASE_URL to this URL (https in production) for client updates');
});
