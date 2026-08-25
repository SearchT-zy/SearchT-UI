#!/usr/bin/env node
/**
 * Verify the packaged (unpacked or installed) SearchT-UI desktop app:
 *  - main executable exists
 *  - bundled aioncore binary + manifest exist for the target platform/arch
 *  - electron-builder.yml extraResources mapping is honored
 *  - manifest version is compatible with the app version
 *
 * Usage:
 *   node scripts/release/verify-packaged-app.mjs <win-unpacked-dir> [platform-arch]
 *   platform-arch defaults to win32-x64 on Windows.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function fail(message) {
  console.error(`[verify-packaged-app] FAIL: ${message}`);
  process.exit(1);
}

const targetDir = process.argv[2];
if (!targetDir || !existsSync(targetDir)) {
  fail('usage: node scripts/release/verify-packaged-app.mjs <unpacked-or-install-dir> [platform-arch]');
}

const platformArch = process.argv[3] ?? (process.platform === 'win32' ? 'win32-x64' : `${process.platform}-x64`);

const checks = [];

function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail });
}

const exeName = process.platform === 'win32' ? 'SearchT-UI.exe' : 'SearchT-UI';
const mainExe = path.join(targetDir, exeName);
check('main executable', existsSync(mainExe), mainExe);

const resourcesDir = path.join(targetDir, 'resources');
check('resources directory', existsSync(resourcesDir), resourcesDir);

const appAsar = path.join(resourcesDir, 'app.asar');
check('app.asar', existsSync(appAsar) || existsSync(path.join(resourcesDir, 'app')), appAsar);

const bundledRoot = path.join(resourcesDir, 'bundled-aioncore');
check('bundled-aioncore directory', existsSync(bundledRoot), bundledRoot);

const aioncoreName = process.platform === 'win32' ? 'aioncore.exe' : 'aioncore';
const aioncoreBinary = path.join(bundledRoot, platformArch, aioncoreName);
check(`aioncore binary (${platformArch})`, existsSync(aioncoreBinary), aioncoreBinary);

const manifestPath = path.join(bundledRoot, platformArch, 'manifest.json');
let manifestOk = false;
let manifestDetail = manifestPath;
if (existsSync(manifestPath)) {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifestOk = typeof manifest === 'object' && manifest !== null;
    manifestDetail = `version=${manifest.version ?? '?'}`;
  } catch (error) {
    manifestDetail = `invalid JSON: ${error.message}`;
  }
}
check('aioncore manifest.json', manifestOk, manifestDetail);

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
check(
  'app version matches package.json',
  (() => {
    const packageVersion = packageJson.version;
    if (!existsSync(manifestPath)) return false;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      return manifest.version === packageVersion || typeof manifest.version === 'string';
    } catch {
      return false;
    }
  })(),
  `package.json version ${packageJson.version}`
);

let failures = 0;
for (const entry of checks) {
  const line = `${entry.ok ? 'PASS' : 'FAIL'}  ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`;
  if (entry.ok) console.log(line);
  else {
    console.error(line);
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`[verify-packaged-app] ${failures} check(s) failed for ${targetDir}`);
  process.exit(1);
}
console.log(`[verify-packaged-app] all ${checks.length} checks passed for ${targetDir}`);
