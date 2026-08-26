/**
 * Resolve the SearchT backend binary path.
 *
 * Search order:
 *  1. Bundled with app (production)
 *  2. System PATH
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const BINARY_NAME = 'searcht-backend';
// Legacy binary name from before the rebrand. Dev machines may still carry an
// externally installed binary under this name, so the PATH lookup falls back to it.
const LEGACY_BINARY_NAME = 'aioncore';
const MAX_DIR_ENTRIES = 20;
const MAX_LOOKUP_TEXT_LENGTH = 1000;

type BackendBinaryResolveDiagnostics = {
  resourcesPath?: string;
  runtimeKey: string;
  binaryName: string;
  checkedBundledPath?: string;
  bundledDirExists?: boolean;
  runtimeDirExists?: boolean;
  resourcesDirEntries?: string[];
  runtimeDirEntries?: string[];
  pathLookupCommand: string;
  pathLookupResult?: string;
  pathLookupError?: string;
};

class BackendBinaryResolveError extends Error {
  readonly diagnostics: BackendBinaryResolveDiagnostics;

  constructor(message: string, diagnostics: BackendBinaryResolveDiagnostics) {
    super(message);
    this.name = 'BackendBinaryResolveError';
    this.diagnostics = diagnostics;
  }
}

function getBinaryName(): string {
  return process.platform === 'win32' ? `${BINARY_NAME}.exe` : BINARY_NAME;
}

function getRuntimeKey(): string {
  return `${process.platform}-${process.arch}`;
}

function listDirEntries(dirPath: string): string[] | undefined {
  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .slice(0, MAX_DIR_ENTRIES)
      .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`);
  } catch {
    return undefined;
  }
}

function trimLookupText(text: string): string {
  return text.trim().slice(0, MAX_LOOKUP_TEXT_LENGTH);
}

/**
 * Resolve the SearchT backend binary path.
 * Returns the absolute path to the binary, or throws if not found.
 */
export function resolveBinaryPath(): string {
  const runtimeKey = getRuntimeKey();
  const binaryName = getBinaryName();
  const lookupCommands = getPathLookupCommands();
  const diagnostics: BackendBinaryResolveDiagnostics = {
    runtimeKey,
    binaryName,
    pathLookupCommand: lookupCommands.join('; '),
  };

  const bundled = bundledPath(runtimeKey, binaryName, diagnostics);
  if (bundled) return bundled;

  const fromPath = resolveFromSystemPATH(lookupCommands, diagnostics);
  if (fromPath) return fromPath;

  throw new BackendBinaryResolveError(
    `Cannot find "${BINARY_NAME}" binary. Checked bundled location and system PATH (${BINARY_NAME}, legacy ${LEGACY_BINARY_NAME}).`,
    diagnostics
  );
}

/**
 * Check bundled binary in resources directory.
 * Layout: bundled-backend/{platform}-{arch}/searcht-backend[.exe]
 */
function bundledPath(
  runtimeKey: string,
  binaryName: string,
  diagnostics: BackendBinaryResolveDiagnostics
): string | null {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (!resourcesPath) return null;
  diagnostics.resourcesPath = resourcesPath;

  const bundledDir = join(resourcesPath, 'bundled-backend');
  const runtimeDir = join(bundledDir, runtimeKey);
  const candidate = join(runtimeDir, binaryName);
  diagnostics.checkedBundledPath = candidate;
  diagnostics.bundledDirExists = existsSync(bundledDir);
  diagnostics.runtimeDirExists = existsSync(runtimeDir);
  diagnostics.resourcesDirEntries = listDirEntries(resourcesPath);
  diagnostics.runtimeDirEntries = listDirEntries(runtimeDir);

  if (existsSync(candidate)) return candidate;
  return null;
}

/**
 * Build the PATH lookup command list: searcht-backend first, then the legacy
 * aioncore name so dev machines with an old external install keep working.
 */
function getPathLookupCommands(): string[] {
  const tool = process.platform === 'win32' ? 'where' : 'which';
  return [BINARY_NAME, LEGACY_BINARY_NAME].map((name) => `${tool} ${name}`);
}

/**
 * Try to find the binary on the system PATH.
 */
function resolveFromSystemPATH(lookupCommands: string[], diagnostics: BackendBinaryResolveDiagnostics): string | null {
  const errors: string[] = [];
  for (const command of lookupCommands) {
    try {
      const result = execSync(command, { encoding: 'utf-8', timeout: 5000 }).trim();
      diagnostics.pathLookupResult = trimLookupText(result);
      const firstMatch = result.split(/\r?\n/).find((line) => line.trim());
      if (firstMatch && existsSync(firstMatch.trim())) return firstMatch.trim();
    } catch (error) {
      errors.push(error instanceof Error ? trimLookupText(error.message) : String(error));
    }
  }
  if (errors.length > 0) {
    diagnostics.pathLookupError = trimLookupText(errors.join('; '));
  }
  return null;
}

export type { BackendBinaryResolveDiagnostics };
