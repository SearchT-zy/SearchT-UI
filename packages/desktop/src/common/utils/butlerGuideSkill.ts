/**
 * @license
 * Copyright 2026 SearchT-UI Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared identity of the desktop-managed "app guide" skill that gives the
 * built-in butler assistant its knowledge of SearchT-UI's own feature set.
 *
 * The butler's built-in rule and its `aionui-*` skills are locked inside the
 * upstream backend binary (renames and rule writes are rejected), so this fork
 * ships a custom skill instead: the main process stages/uploads it into the
 * backend's skill corpus at startup ({@link process/services/butler}), and the
 * renderer merges it into the butler's default skill set when a butler
 * conversation is created. Bump {@link BUTLER_GUIDE_SKILL_VERSION} whenever the
 * guide content changes — the uploader re-imports on version drift.
 */

export const BUTLER_GUIDE_SKILL_NAME = 'searcht-app-guide';

/** Content version of the staged guide; parsed by the uploader, not the agent. */
export const BUTLER_GUIDE_SKILL_VERSION = 2;
