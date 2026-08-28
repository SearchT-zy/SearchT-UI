#!/usr/bin/env node
/**
 * Stage a SearchT release for the generic (electron-updater CDN) update feed.
 *
 * Generates/refreshes latest.yml next to the staged installer so the feed
 * directory can be uploaded to any static host and pointed at via
 * SEARCHT_UPDATE_BASE_URL (see packages/desktop/src/process/services/updateFeed.ts).
 *
 * Usage:
 *   node scripts/release/publish-update.mjs <release-dir> <installer.exe> [blockmap]
 *
 * The installer is copied into <release-dir>/ and latest.yml is written with
 * sha512 digests in the electron-updater schema.
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function fail(message) {
  console.error(`[publish-update] FAIL: ${message}`);
  process.exit(1);
}

const releaseDir = process.argv[2];
const installerPath = process.argv[3];
const blockmapPath = process.argv[4];

if (!releaseDir || !installerPath || !existsSync(installerPath)) {
  fail('usage: node scripts/release/publish-update.mjs <release-dir> <installer.exe> [blockmap]');
}

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const version = packageJson.version;

const fileName = path.basename(installerPath);
const stagedInstaller = path.join(releaseDir, fileName);
copyFileSync(installerPath, stagedInstaller);

const sha512 = (file) => createHash('sha512').update(readFileSync(file)).digest('base64');
const size = (file) => readFileSync(file).byteLength;

const files = [{ url: fileName, sha512: sha512(stagedInstaller), size: size(stagedInstaller) }];
if (blockmapPath && existsSync(blockmapPath)) {
  const blockmapName = path.basename(blockmapPath);
  copyFileSync(blockmapPath, path.join(releaseDir, blockmapName));
  files.push({
    url: blockmapName,
    sha512: sha512(path.join(releaseDir, blockmapName)),
    size: size(path.join(releaseDir, blockmapName)),
  });
}

const releaseDate = new Date().toISOString();

// Path-based digest matches electron-builder's nsis latest.yml layout.
const manifest = {
  version,
  path: fileName,
  fileName,
  sha512: files[0].sha512,
  releaseDate,
  files,
};

const yml = [
  `version: ${manifest.version}`,
  `path: ${manifest.path}`,
  `sha512: ${manifest.sha512}`,
  `releaseDate: ${manifest.releaseDate}`,
  'files:',
  ...files.flatMap((file) => [`  - url: ${file.url}`, `    sha512: ${file.sha512}`, `    size: ${file.size}`]),
  '',
].join('\n');

writeFileSync(path.join(releaseDir, 'latest.yml'), yml, 'utf8');
console.log(`[publish-update] staged ${fileName} (v${version}) and latest.yml in ${releaseDir}`);
console.log('[publish-update] point clients at this directory via SEARCHT_UPDATE_BASE_URL=<https-url-of-release-dir>');
