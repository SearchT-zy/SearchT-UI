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
// Resolves via the vitest alias to the Node-ABI shadow copy; the app itself
// loads the Electron-ABI entity. See vitest.config.ts.
import Database from 'better-sqlite3';
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
  // Agent session state carrying the pre-rename skill manifest reminder
  await fs.mkdir(path.join(root, 'aionrs-sessions/sessions/conv-old'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'aionrs-sessions/sessions/conv-old/state.json'),
    '{"reminder":"skills from the system reminder are:\\n- aionui-config\\n- aionui-troubleshooting","path":"x/.aionrs/skills"}',
    'utf8'
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

    // Session state rewritten: legacy manifest names gone, runtime paths kept
    const state = await fs.readFile(path.join(root, 'aionrs-sessions/sessions/conv-old/state.json'), 'utf8');
    expect(state).toContain('searcht-config');
    expect(state).toContain('.aionrs/skills');
    expect(state).not.toContain('aionui-');

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

  it('installs triggers that scrub rows the backend writes at RUNTIME', async () => {
    // The butler's rule text is injected by the backend when a NEW
    // conversation is created — long after the boot scrub. Triggers must
    // rewrite such writes atomically.
    const root = fixtureRoot!;
    const db = new Database(path.join(root, 'aionui-backend.db'));
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, extra TEXT);
      CREATE TABLE IF NOT EXISTS conversation_assistant_snapshots (conversation_id TEXT PRIMARY KEY, rules_content TEXT);
    `);
    // Seed a legacy row so the pass scrub has something to clean, then run
    // the scrubber (which also installs the triggers).
    db.prepare("INSERT INTO conversations (id, extra) VALUES ('c1', ?)").run(
      '{"preset_rules":"# AionUi Butler\\nYou are AionUi\'s butler"}'
    );
    db.close();

    const { runBackendBrandScrub } = await import('@/process/services/brand/backendBrandScrub');
    await runBackendBrandScrub(() => root);

    const db2 = new Database(path.join(root, 'aionui-backend.db'));
    const boot = db2.prepare("SELECT extra FROM conversations WHERE id='c1'").get() as { extra: string };
    expect(boot.extra).not.toMatch(/AionUi/);

    // Runtime INSERT with the embedded legacy rule — trigger scrubs it.
    db2
      .prepare('INSERT INTO conversations (id, extra) VALUES (?, ?)')
      .run('c2', '{"preset_rules":"# AionUi Butler\\nUse the aionui-config skill"}');
    const ins = db2.prepare("SELECT extra FROM conversations WHERE id='c2'").get() as { extra: string };
    expect(ins.extra).toContain('SearchT-UI Butler');
    expect(ins.extra).toContain('searcht-config');
    expect(ins.extra).not.toMatch(/aionui/i);

    // Snapshot rules injected at creation — trigger on the second table.
    db2
      .prepare('INSERT INTO conversation_assistant_snapshots (conversation_id, rules_content) VALUES (?, ?)')
      .run('c2', 'You are AionUi管家. Use aionui-troubleshooting.');
    const snap = db2
      .prepare("SELECT rules_content FROM conversation_assistant_snapshots WHERE conversation_id='c2'")
      .get() as { rules_content: string };
    expect(snap.rules_content).toContain('SearchT-UI 管家');
    expect(snap.rules_content).toContain('searcht-troubleshooting');

    // Clean rows pass through byte-identical; NULL survives.
    db2.prepare("INSERT INTO conversations (id, extra) VALUES ('c3', ?)").run('{"workspace":"x/.aionrs/tmp"}');
    const clean = db2.prepare("SELECT extra FROM conversations WHERE id='c3'").get() as { extra: string };
    expect(clean.extra).toBe('{"workspace":"x/.aionrs/tmp"}');
    db2.prepare("INSERT INTO conversations (id, extra) VALUES ('c4', NULL)").run();
    const nullable = db2.prepare("SELECT extra FROM conversations WHERE id='c4'").get() as { extra: string | null };
    expect(nullable.extra).toBeNull();

    // UPDATE writing legacy text back is scrubbed again (self-healing).
    db2.prepare("UPDATE conversations SET extra = ? WHERE id = 'c3'").run('{"note":"aionui-config again"}');
    const upd = db2.prepare("SELECT extra FROM conversations WHERE id='c3'").get() as { extra: string };
    expect(upd.extra).toContain('searcht-config');

    db2.close();
  });
});
