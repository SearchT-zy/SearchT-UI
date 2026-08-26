/**
 * @license
 * Copyright 2025 SearchT-UI Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Theme } from '@/common/theme/types';
import { LIGHT_THEME_ID, DARK_THEME_ID } from '@/common/theme/constants';

import {
  misakaMikotoCover,
  helloKittyCover,
  retroWindowsCover,
  y2kJpCover,
  retromaObsidianBookCover,
} from '@renderer/pages/settings/AppearanceSettings/themeCovers';

import misakaMikotoCss from '@renderer/pages/settings/AppearanceSettings/presets/misaka-mikoto.css?raw';
import helloKittyCss from '@renderer/pages/settings/AppearanceSettings/presets/hello-kitty.css?raw';
import retroWindowsCss from '@renderer/pages/settings/AppearanceSettings/presets/retro-windows.css?raw';
import retromaY2kCss from '@renderer/pages/settings/AppearanceSettings/presets/retroma-y2k.css?raw';
import retromaObsidianBookCss from '@renderer/pages/settings/AppearanceSettings/presets/retroma-obsidian-book.css?raw';
import discourseHorizonCss from '@renderer/pages/settings/AppearanceSettings/presets/discourse-horizon.css?raw';
import glitteringInputFieldCss from '@renderer/pages/settings/AppearanceSettings/presets/glittering-input-field.css?raw';
import deepSpaceCss from '@renderer/pages/settings/AppearanceSettings/presets/deep-space.css?raw';
import quantumVioletCss from '@renderer/pages/settings/AppearanceSettings/presets/quantum-violet.css?raw';
import carbonAmberCss from '@renderer/pages/settings/AppearanceSettings/presets/carbon-amber.css?raw';
import auroraTealCss from '@renderer/pages/settings/AppearanceSettings/presets/aurora-teal.css?raw';
import dawnBlueCss from '@renderer/pages/settings/AppearanceSettings/presets/dawn-blue.css?raw';
import nebulaDriftCss from '@renderer/pages/settings/AppearanceSettings/presets/nebula-drift.css?raw';
import sunsetRidgeCss from '@renderer/pages/settings/AppearanceSettings/presets/sunset-ridge.css?raw';
import emeraldMeshCss from '@renderer/pages/settings/AppearanceSettings/presets/emerald-mesh.css?raw';

const T0 = 0;

const decorative = (id: string, name: string, appearance: Theme['appearance'], css: string, cover?: string): Theme => ({
  id,
  name,
  appearance,
  css,
  cover,
  builtin: true,
  created_at: T0,
  updated_at: T0,
});

export const BUILTIN_THEMES: Theme[] = [
  // 'Light' removed by product decision — Dark is the default; light surfaces
  // remain available via the light-appearance decorative themes below.
  { id: DARK_THEME_ID, name: 'Dark', appearance: 'dark', builtin: true, created_at: T0, updated_at: T0 },
  decorative('misaka-mikoto-theme', 'Misaka Mikoto Theme', 'light', misakaMikotoCss, misakaMikotoCover),
  decorative('hello-kitty', 'Hello Kitty', 'light', helloKittyCss, helloKittyCover),
  decorative('retro-windows', 'Retro Windows', 'light', retroWindowsCss, retroWindowsCover),
  decorative('retroma-y2k-jp-v42-pure', 'Y2K电子账本 by 椰树女王', 'light', retromaY2kCss, y2kJpCover),
  decorative(
    'retroma-obsidian-book',
    'Retroma Obsidian Book',
    'dark',
    retromaObsidianBookCss,
    retromaObsidianBookCover
  ),
  decorative('discourse-horizon', 'Discourse Horizon', 'light', discourseHorizonCss),
  decorative('glittering-input-field', 'Glittering Input Field', 'light', glitteringInputFieldCss),
  decorative('deep-space', '深空科技 Deep Space', 'dark', deepSpaceCss),
  decorative('quantum-violet', '量子紫 Quantum', 'dark', quantumVioletCss),
  decorative('carbon-amber', '碳纤琥珀 Carbon', 'dark', carbonAmberCss),
  decorative('aurora-teal', '极光翠 Aurora', 'dark', auroraTealCss),
  decorative('dawn-blue', '曙光蓝 Dawn', 'light', dawnBlueCss),
  decorative('nebula-drift', '星云漫游 Nebula（图片）', 'dark', nebulaDriftCss),
  decorative('sunset-ridge', '落日山脊 Sunset（图片）', 'dark', sunsetRidgeCss),
  decorative('emerald-mesh', '翡翠网格 Mesh（图片）', 'dark', emeraldMeshCss),
];

export const BUILTIN_THEME_IDS = new Set(BUILTIN_THEMES.map((t) => t.id));
