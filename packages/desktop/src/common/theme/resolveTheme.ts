/**
 * @license
 * Copyright 2025 SearchT-UI Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Theme } from './types';
import { LIGHT_THEME_ID, DARK_THEME_ID, SYSTEM_THEME_ID } from './constants';

/**
 * Pure: caller supplies the full theme list (builtins + user). Falls back to
 * Dark, then any light-appearance theme, then first.
 * `system` resolves via `prefersDark` (callers pass the `prefers-color-scheme`
 * media query result; this module must stay DOM-free): dark → the built-in
 * Dark theme; light → the first light-appearance theme (the built-in Light was
 * removed; decorative light themes cover this).
 */
export function resolveActiveTheme(activeId: string, themes: Theme[], prefersDark?: boolean): Theme {
  let targetId = activeId;
  if (activeId === SYSTEM_THEME_ID) {
    targetId = prefersDark ? DARK_THEME_ID : LIGHT_THEME_ID;
  }
  return (
    themes.find((t) => t.id === targetId) ??
    themes.find((t) => t.id === DARK_THEME_ID) ??
    themes.find((t) => t.appearance === 'light') ??
    themes[0]
  );
}
