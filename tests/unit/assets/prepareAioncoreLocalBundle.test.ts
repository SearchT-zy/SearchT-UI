import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { prepareBackend } = require('../../../packages/shared-scripts/src/prepare-aioncore');

describe('prepare-backend local bundle input', () => {
  it('hard fails local bundle input that lacks managed-resources manifest', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aionui-local-bundle-'));
    const projectRoot = join(tmp, 'project');
    const localBundle = join(tmp, 'bundle');
    mkdirSync(join(localBundle, 'managed-resources'), { recursive: true });
    // Legacy-named binary: prepare must accept the old archive name too.
    writeFileSync(join(localBundle, 'aioncore.exe'), '');

    const previous = process.env.SEARCHT_BACKEND_LOCAL_BUNDLE_DIR;
    process.env.SEARCHT_BACKEND_LOCAL_BUNDLE_DIR = localBundle;
    try {
      expect(() =>
        prepareBackend({
          projectRoot,
          platform: 'win32',
          arch: 'x64',
          version: 'v0.1.46',
        })
      ).toThrow(/managed-resources\/manifest\.json/);
    } finally {
      if (previous === undefined) delete process.env.SEARCHT_BACKEND_LOCAL_BUNDLE_DIR;
      else process.env.SEARCHT_BACKEND_LOCAL_BUNDLE_DIR = previous;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
