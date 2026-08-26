/**
 * @license
 * Copyright 2026 SearchT-UI Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 *
 * File-level coverage for the data scrubber: corpus SKILL.md rewrites,
 * per-conversation materialized copies, and byte-stability for clean files.
 * The DB pass is skipped implicitly (no database file in the fixture dir) and
 * is covered by the live-backend verification instead.
 */

import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let fixtureRoot: string | null = null;

const prepareFixture = async (): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'brandscrub-'));
  fixtureRoot = root;
  // Corpus builtin (folder name stays, frontmatter + copy rewritten)
  await fs.mkdir(path.join(root, 'builtin-skills/auto-inject/aionui-config'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'builtin-skills/auto-inject/aionui-config/SKILL.md'),
    '---\nname: aionui-config\ndescription: Configure AionUi itself through the bundled aioncore config CLI.\n---\n\nConfigure AionUi settings.\n',
    'utf8'
  );
  // Materialized copy inside a conversation workspace
  await fs.mkdir(
    path.join(root, 'conversations/users/system_default_user/2026/08/26/aionrs-temp-x/.aionrs/skills/aionui-config'),
    { recursive: true }
  );
  await fs.writeFile(
    path.join(root, 'conversations/users/system_default_user/2026/08/26/aionrs-temp-x/.aionrs/skills/aionui-config/SKILL.md'),
    '---\nname: aionui-config\ndescription: Configure AionUi itself.\n---\n\nConfigure AionUi settings. See also aionui-troubleshooting.\n',
    'utf8'
  );
  // Clean user skill — must round-trip byte-identical
  await fs.mkdir(path.join(root, 'skills/users/mine'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'skills/users/mine/SKILL.md'),
    '---\nname: my-clean-skill\ndescription: Nothing legacy here.\n---\n\nClean content.\n',
    'utf8'
  );
  // Materialized-skill symlink named after the legacy id, pointing into the
  // corpus (whose folder name intentionally stays legacy)
  await fs.mkdir(path.join(root, 'conversations/users/system_default_user/2026/08/26/claude-temp-y/.claude/skills'), {
    recursive: true,
  });
  await fs.symlink(
    path.join(root, 'builtin-skills/auto-inject/aionui-config'),
    path.join(root, 'conversations/users/system_default_user/2026/08/26/claude-temp-y/.claude/skills/aionui-config'),
    'junction'
  );
  return root;
};

afterAll(async () => {
  if (fixtureRoot) await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe('runBackendBrandScrub (files)', () => {
  it('rewrites corpus and workspace copies, leaves clean files untouched', async () => {
    const root = await prepareFixture();
    const { runBackendBrandScrub } = await import('@/process/services/brand/backendBrandScrub');

    const stats = await runBackendBrandScrub(() => root);

    const corpus = await fs.readFile(
      path.join(root, 'builtin-skills/auto-inject/aionui-config/SKILL.md'),
      'utf8'
    );
    expect(corpus).toContain('name: searcht-config');
    expect(corpus).not.toMatch(/aion/i);

    const workspaceDir = path.join(
      root,
      'conversations/users/system_default_user/2026/08/26/aionrs-temp-x/.aionrs/skills'
    );
    // Legacy folder renamed so agents enumerating by directory name see the
    // new id; the file inside keeps its scrubbed content.
    const renamedWorkspace = await fs.readFile(path.join(workspaceDir, 'searcht-config/SKILL.md'), 'utf8');
    expect(renamedWorkspace).toContain('name: searcht-config');
    expect(renamedWorkspace).toContain('searcht-troubleshooting');
    expect(renamedWorkspace).not.toMatch(/aionui/);
    await expect(fs.access(path.join(workspaceDir, 'aionui-config'))).rejects.toThrow();

    // Legacy-named materialized symlink renamed (target untouched)
    const renamedLink = path.join(
      root,
      'conversations/users/system_default_user/2026/08/26/claude-temp-y/.claude/skills/searcht-config'
    );
    expect((await fs.readlink(renamedLink)).replace(/\\/g, '/')).toContain('aionui-config');
    await expect(
      fs.access(path.join(root, 'conversations/users/system_default_user/2026/08/26/claude-temp-y/.claude/skills/aionui-config'))
    ).rejects.toThrow();

    const clean = await fs.readFile(path.join(root, 'skills/users/mine/SKILL.md'), 'utf8');
    expect(clean).toBe('---\nname: my-clean-skill\ndescription: Nothing legacy here.\n---\n\nClean content.\n');

    expect(stats.filesChanged).toBeGreaterThanOrEqual(3);
    expect(stats.rowsChanged).toBe(0);
  });

  it('is idempotent — a second pass changes nothing', async () => {
    const root = fixtureRoot!;
    const { runBackendBrandScrub } = await import('@/process/services/brand/backendBrandScrub');
    const stats = await runBackendBrandScrub(() => root);
    expect(stats.filesChanged).toBe(0);
    expect(stats.rowsChanged).toBe(0);
  });
});
