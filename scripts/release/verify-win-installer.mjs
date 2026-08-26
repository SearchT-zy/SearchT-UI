#!/usr/bin/env node
/**
 * Windows NSIS installer smoke test.
 *
 * Runs the built installer silently (/S), verifies the installed layout and
 * uninstall registry entry, launches the app briefly, then uninstalls
 * silently and verifies cleanup. Intended for release sign-off on a Windows
 * VM or CI runner with a real GUI session.
 *
 * Usage:
 *   node scripts/release/verify-win-installer.mjs <path-to-SearchT-UI-Setup-x.y.z.exe> [--keep]
 *
 * Flags:
 *   --keep  keep the installation after the run (skip uninstall phase)
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

function fail(message) {
  console.error(`[verify-win-installer] FAIL: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: 'pipe', encoding: 'utf8', ...options });
}

const installer = process.argv[2];
const keep = process.argv.includes('--keep');
if (!installer || !existsSync(installer)) {
  fail('usage: node scripts/release/verify-win-installer.mjs <SearchT-UI-Setup.exe> [--keep]');
}
if (process.platform !== 'win32') {
  fail('this smoke test must run on Windows');
}

const perUserInstall = !process.argv.includes('--all-users');
const installDir = perUserInstall
  ? path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'SearchT-UI')
  : path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'SearchT-UI');

console.log(`[verify-win-installer] installing ${installer} silently to ${installDir}`);
// Assisted NSIS installers built with perMachine=false already default to a
// per-user install; only pass the scope flag when it is explicitly requested
// because older installer builds reject unknown switches with exit code 2.
run(installer, ['/S', ...(perUserInstall ? [] : ['/allusers'])], { timeout: 10 * 60_000 });

const mainExe = path.join(installDir, 'SearchT-UI.exe');
if (!existsSync(mainExe)) fail(`SearchT-UI.exe missing after install: ${mainExe}`);
console.log(`PASS  SearchT-UI.exe installed: ${mainExe}`);

const bundledBackend = path.join(installDir, 'resources', 'bundled-backend');
if (!existsSync(bundledBackend)) fail(`bundled-backend missing after install: ${bundledBackend}`);
console.log(`PASS  bundled-backend present`);

const backendBinary = path.join(bundledBackend, 'win32-x64', 'searcht-backend.exe');
const archFallback = existsSync(backendBinary)
  ? backendBinary
  : path.join(bundledBackend, 'win32-arm64', 'searcht-backend.exe');
if (!existsSync(archFallback)) fail(`searcht-backend.exe missing for any arch under ${bundledBackend}`);
console.log(`PASS  searcht-backend.exe present: ${archFallback}`);

// Uninstall registry entry (NSIS oneClick/perMachine writes these keys).
const registryHive = perUserInstall ? 'HKCU' : 'HKLM';
const uninstallKey = `${registryHive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SearchT-UI`;
let registryOk = false;
try {
  const output = run('reg', ['query', uninstallKey, '/v', 'DisplayName']);
  registryOk = output.includes('SearchT-UI');
} catch {
  registryOk = false;
}
if (!registryOk) fail(`uninstall registry entry missing: ${uninstallKey}`);
console.log(`PASS  uninstall registry entry: ${uninstallKey}`);

// Launch smoke: start the app, give it time to create the window, then stop it.
console.log('[verify-win-installer] launching SearchT-UI.exe for a 12s smoke window');
const launched = spawn(mainExe, ['--smoke-test'], { detached: true, stdio: 'ignore' });
launched.unref();
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 12_000);
try {
  process.kill(launched.pid);
  console.log('PASS  app launched and was stopped cleanly');
} catch {
  // The app may have exited on its own; only a crash-at-startup is a failure.
  if (launched.exitCode !== null && launched.exitCode !== 0) {
    fail(`app exited during smoke launch with code ${launched.exitCode}`);
  }
  console.log('PASS  app exited on its own during the smoke window');
}

if (keep) {
  console.log('[verify-win-installer] --keep set; leaving the installation in place');
  process.exit(0);
}

const uninstaller = path.join(installDir, 'Uninstall SearchT-UI.exe');
if (!existsSync(uninstaller)) fail(`uninstaller missing: ${uninstaller}`);
console.log('[verify-win-installer] running silent uninstall');
run(uninstaller, ['/S', '--force-run'], { timeout: 5 * 60_000 });

// NSIS uninstall is asynchronous; poll briefly for removal.
let removed = false;
for (let attempt = 0; attempt < 30; attempt += 1) {
  if (!existsSync(mainExe)) {
    removed = true;
    break;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2_000);
}
if (!removed) {
  rmSync(installDir, { recursive: true, force: true });
  fail(`installation was not removed by silent uninstall: ${installDir}`);
}
console.log('PASS  silent uninstall removed the installation');
console.log('[verify-win-installer] all installer smoke checks passed');
