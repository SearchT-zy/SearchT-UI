/**
 * @license
 * Copyright 2026 SearchT-UI Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Direct data-level brand scrub for the backend's own storage.
 *
 * The upstream backend seeds its catalog with legacy names (skill corpus
 * `aionui-*`, butler row "AionUi Butler", generated agent row "Aion CLI") and
 * re-seeds missing skill folders on every boot, so display-layer mapping was
 * used first. Per product decision the data itself is now rewritten instead:
 *
 * - Skill folders keep their on-disk directory names (renaming them makes the
 *   backend re-seed duplicates) but their SKILL.md frontmatter names and copy
 *   are rewritten, which is what the corpus is served under.
 * - The backend SQLite catalog (skills / assistant_definitions /
 *   conversations / snapshots / preferences) gets the same replacements so
 *   every reference resolves under the new names.
 *
 * The pass is idempotent and runs on every boot after the backend is up —
 * cheap (a handful of small updates) and self-healing after backend upgrades
 * that re-seed old rows.
 */

import { rebrandLegacyText, rebrandSkillName } from '@/common/utils/legacyBrandRebrand';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

/** SKILL.md locations of the four upstream aionui-* builtins (dir names stay). */
const LEGACY_SKILL_FILES = [
  'builtin-skills/auto-inject/aionui-config/SKILL.md',
  'builtin-skills/aionui-troubleshooting/SKILL.md',
  'builtin-skills/aionui-webui-public/SKILL.md',
  'builtin-skills/aionui-webui-setup/SKILL.md',
];

/**
 * Resolve a whitelisted corpus-relative path under the backend data root
 * (`{userData}/searcht`, what getDataPath() returns), refusing anything that
 * escapes that root (defense-in-depth: the list above is a fixed constant,
 * but the join is still validated).
 */
function resolveUnderCorpusRoot(dataDir: string, relative: string): string | null {
  const root = path.resolve(dataDir);
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

/** Frontmatter line rewrite for a skill whose on-disk folder kept the old id. */
const rebrandFrontmatterName = (content: string): string =>
  content.replace(/^(name:\s*)aionui-([\w-]+)$/m, (_m, prefix: string, suffix: string) => {
    const rebranded = rebrandSkillName(`aionui-${suffix}`);
    return `${prefix}${rebranded}`;
  });

async function scrubSkillFiles(dataDir: string): Promise<number> {
  let changed = 0;
  for (const relative of LEGACY_SKILL_FILES) {
    const file = resolveUnderCorpusRoot(dataDir, relative);
    if (!file) continue;
    try {
      const original = await fs.readFile(file, 'utf8');
      let next = rebrandFrontmatterName(original);
      next = rebrandLegacyText(next) ?? next;
      if (next !== original) {
        await fs.writeFile(file, next, 'utf8');
        changed += 1;
      }
    } catch {
      // Missing skill (corpus layout changed upstream) — nothing to scrub.
    }
  }
  return changed;
}

/**
 * Trees that hold per-conversation materialized copies of skills (the agent
 * reads THESE, not the corpus, when answering "what skills do I have") plus
 * the custom-skill store. Every SKILL.md under them gets the same rewrite,
 * so existing conversations report the new names on their next turn.
 */
const WORKSPACE_SKILL_ROOTS = ['conversations', 'aionrs-sessions', 'skills'];

async function walkSkillFiles(root: string, depth: number, out: string[]): Promise<void> {
  if (depth > 10) return;
  let entries: Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await walkSkillFiles(child, depth + 1, out);
    } else if (entry.isFile() && entry.name === 'SKILL.md') {
      out.push(child);
    }
  }
}

/**
 * Materialized skills in conversation workspaces are SYMLINKS named after
 * the skill id, pointing into the corpus (the corpus folders keep legacy
 * names by design). The backend now creates them under the new ids, but
 * links created before the rename linger and agents enumerate by link name.
 * Rename legacy-named links; their targets are untouched.
 */
async function scrubWorkspaceSkillSymlinks(dataDir: string): Promise<number> {
  let changed = 0;
  for (const relative of WORKSPACE_SKILL_ROOTS) {
    const root = resolveUnderCorpusRoot(dataDir, relative);
    if (!root) continue;
    const links: string[] = [];
    await walkLegacySymlinks(root, 0, links);
    for (const link of links) {
      const renamed = rebrandSkillName(path.basename(link));
      const target = path.join(path.dirname(link), renamed);
      try {
        await fs.access(target);
        await fs.rm(link, { force: true });
      } catch {
        await fs.rename(link, target);
      }
      changed += 1;
    }
  }
  return changed;
}

async function walkLegacySymlinks(root: string, depth: number, out: string[]): Promise<void> {
  if (depth > 10) return;
  let entries: Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const child = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      if (/^aionui-/.test(entry.name)) out.push(child);
      continue;
    }
    if (entry.isDirectory()) {
      await walkLegacySymlinks(child, depth + 1, out);
    }
  }
}

async function scrubWorkspaceSkillCopies(dataDir: string): Promise<number> {
  let changed = 0;
  for (const relative of WORKSPACE_SKILL_ROOTS) {
    const root = resolveUnderCorpusRoot(dataDir, relative);
    if (!root) continue;
    const files: string[] = [];
    await walkSkillFiles(root, 0, files);
    for (const file of files) {
      try {
        const original = await fs.readFile(file, 'utf8');
        // Only rewrite files that still carry replaceable legacy strings —
        // user-authored skills must round-trip byte-identical. Runtime tool
        // paths like `.aionrs/` and `~/.aionui/tools/` are real on-disk
        // locations and must survive verbatim.
        const probe = rebrandLegacyText(original) ?? original;
        if (probe !== original || /^name:\s*aionui-/m.test(original)) {
          let next = rebrandFrontmatterName(original);
          next = rebrandLegacyText(next) ?? next;
          if (next !== original) {
            await fs.writeFile(file, next, 'utf8');
            changed += 1;
          }
        }
        // Agents enumerate materialized skills by FOLDER name; rename legacy
        // folders independently of content (already-clean files still sit in
        // legacy folders from earlier passes). These copies are never
        // re-seeded, so renaming is safe here (unlike the corpus). If the
        // renamed folder already exists, drop the stale one — the backend
        // re-materializes from the catalog on demand.
        const dir = path.dirname(file);
        const dirName = path.basename(dir);
        if (/^aionui-/.test(dirName)) {
          const renamed = rebrandSkillName(dirName);
          const target = path.join(path.dirname(dir), renamed);
          try {
            await fs.access(target);
            await fs.rm(dir, { recursive: true, force: true });
          } catch {
            await fs.rename(dir, target);
          }
          changed += 1;
        }
      } catch {
        // Unreadable/unwritable copy — next boot retries.
      }
    }
  }
  return changed;
}

type ScrubStats = { filesChanged: number; rowsChanged: number };

/** Text columns per table whose contents may carry legacy names or copy. */
const TEXT_COLUMNS: Record<string, string[]> = {
  skills: ['name', 'description'],
  assistant_definitions: [
    'name',
    'name_i18n',
    'description',
    'description_i18n',
    'recommended_prompts',
    'recommended_prompts_i18n',
    'default_skill_ids',
    'custom_skill_names',
    'default_disabled_builtin_skill_ids',
    'default_mcp_ids',
  ],
  conversations: ['extra'],
  conversation_assistant_snapshots: ['rules_content'],
  client_preferences: ['preferences'],
  assistant_preferences: ['preferences'],
};

function scrubValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  // JSON arrays of skill ids need per-item id mapping, not prose replacement.
  if (value.startsWith('[') && value.includes('"')) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')) {
        return JSON.stringify(parsed.map((entry) => rebrandSkillName(entry)));
      }
    } catch {
      // fall through to prose replacement
    }
  }
  if ((value.startsWith('{') || value.startsWith('[')) && value.includes('"')) {
    // JSON objects: rebrand string leaves in place.
    try {
      const parsed = JSON.parse(value) as unknown;
      const visit = (node: unknown): unknown => {
        if (typeof node === 'string') return rebrandLegacyText(node) ?? node;
        if (Array.isArray(node)) return node.map(visit);
        if (node && typeof node === 'object') {
          return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, visit(v)]));
        }
        return node;
      };
      return JSON.stringify(visit(parsed));
    } catch {
      // fall through to prose replacement
    }
  }
  return rebrandLegacyText(value) ?? value;
}

async function scrubDatabase(dbPath: string): Promise<number> {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(dbPath);
  try {
    db.pragma('busy_timeout = 5000');
    db.pragma('journal_mode = WAL');

    // skills.name is UNIQUE: an earlier partial pass (or a re-seeded corpus)
    // can leave both the legacy row and a renamed row behind. Drop the legacy
    // row so the rename below has a free target — its folder is the one that
    // still exists on disk, the renamed row usually points at a stale path.
    try {
      const legacy = db
        .prepare("SELECT rowid AS rid, name FROM skills WHERE name LIKE 'aionui-%'")
        .all() as Array<{ rid: number; name: string }>;
      for (const row of legacy) {
        const renamed = rebrandSkillName(row.name);
        if (renamed === row.name) continue;
        const clash = db
          .prepare('SELECT COUNT(*) AS c FROM skills WHERE name = ? AND rowid != ?')
          .get(renamed, row.rid) as { c: number };
        if (clash.c > 0) {
          db.prepare('DELETE FROM skills WHERE rowid = ?').run(row.rid);
        }
      }
    } catch {
      // Table missing on a fresh install — nothing to reconcile.
    }

    let rows = 0;
    for (const [table, columns] of Object.entries(TEXT_COLUMNS)) {
      let existing: string[] = [];
      try {
        existing = db
          .prepare(`SELECT name FROM pragma_table_info('${table}')`)
          .all()
          .map((r) => (r as { name: string }).name);
      } catch {
        continue;
      }
      const usable = columns.filter((column) => existing.includes(column));
      if (usable.length === 0) continue;
      const select = `SELECT rowid AS __rid, ${usable.join(', ')} FROM "${table}"`;
      const update = `UPDATE "${table}" SET ${usable.map((c) => `"${c}" = ?`).join(', ')} WHERE rowid = ?`;
      const selectStmt = db.prepare(select);
      const updateStmt = db.prepare(update);
      for (const row of selectStmt.all() as Array<Record<string, unknown>>) {
        let dirty = false;
        const next = usable.map((column) => {
          const scrubbed = scrubValue(row[column]);
          if (scrubbed !== row[column]) dirty = true;
          return scrubbed;
        });
        if (dirty) {
          try {
            updateStmt.run(...next, row.__rid as number);
            rows += 1;
          } catch (error) {
            console.error(`[SearchT-UI] Brand scrub row update failed (${table}):`, error);
          }
        }
      }
    }
    return rows;
  } finally {
    db.close();
  }
}

export async function runBackendBrandScrub(getDataDir: () => string): Promise<ScrubStats> {
  const dataDir = getDataDir();
  const filesChanged =
    (await scrubSkillFiles(dataDir)) +
    (await scrubWorkspaceSkillCopies(dataDir)) +
    (await scrubWorkspaceSkillSymlinks(dataDir));
  let rowsChanged = 0;
  try {
    rowsChanged = await scrubDatabase(path.join(dataDir, 'aionui-backend.db'));
  } catch (error) {
    // Backend owns the DB; a busy/locked window just defers to the next boot.
    console.error('[SearchT-UI] Backend brand scrub DB pass failed:', error);
  }
  if (filesChanged > 0 || rowsChanged > 0) {
    console.info(`[SearchT-UI] Backend brand scrub: ${filesChanged} skill file(s), ${rowsChanged} row(s) updated`);
  }
  return { filesChanged, rowsChanged };
}
