export const PET_STATES = [
  'idle',
  'thinking',
  'working',
  'done',
  'happy',
  'error',
  'dragging',
  'attention',
  'poke-left',
  'poke-right',
  'notification',
  'random-look',
  'random-read',
  'yawning',
  'dozing',
  'sleeping',
  'waking',
  'sweeping',
  'juggling',
  'building',
  'carrying',
] as const;

export type PetState = (typeof PET_STATES)[number];

export type StateChangeCallback = (state: PetState, prev: PetState) => void;

export type PetSize = 200 | 280 | 360;

export type HitBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type EyeMoveData = {
  eyeDx: number;
  eyeDy: number;
  bodyDx: number;
  bodyRotate: number;
};

export const STATE_PRIORITY: Record<PetState, number> = {
  dragging: 10,
  error: 8,
  notification: 7,
  sweeping: 6,
  done: 5,
  happy: 5,
  attention: 5,
  carrying: 4,
  juggling: 4,
  building: 4,
  working: 3,
  thinking: 2,
  waking: 2,
  'poke-left': 2,
  'poke-right': 2,
  idle: 1,
  'random-look': 1,
  'random-read': 1,
  yawning: 0,
  dozing: 0,
  sleeping: 0,
};

export const MIN_DISPLAY_MS: Partial<Record<PetState, number>> = {
  done: 3500,
  happy: 3000,
  error: 5000,
  attention: 3000,
  notification: 2500,
  'poke-left': 2500,
  'poke-right': 2500,
  waking: 1500,
  sweeping: 5000,
  building: 4000,
  juggling: 4000,
  carrying: 3000,
  'random-look': 4000,
  'random-read': 6000,
  yawning: 3000,
  thinking: 1000,
  working: 1000,
};

export type AutoReturnConfig = {
  target: PetState;
  delayMs: number;
};

export const AUTO_RETURN: Partial<Record<PetState, AutoReturnConfig>> = {
  done: { target: 'idle', delayMs: 4000 },
  happy: { target: 'idle', delayMs: 4000 },
  error: { target: 'idle', delayMs: 5000 },
  attention: { target: 'idle', delayMs: 3000 },
  notification: { target: 'idle', delayMs: 3500 },
  'poke-left': { target: 'idle', delayMs: 2500 },
  'poke-right': { target: 'idle', delayMs: 2500 },
  waking: { target: 'idle', delayMs: 1500 },
  sweeping: { target: 'idle', delayMs: 5500 },
  building: { target: 'idle', delayMs: 5000 },
  juggling: { target: 'idle', delayMs: 5000 },
  carrying: { target: 'idle', delayMs: 4000 },
  'random-look': { target: 'idle', delayMs: 6000 },
  'random-read': { target: 'idle', delayMs: 8000 },
  yawning: { target: 'dozing', delayMs: 3500 },
};

/**
 * Pet characters — palette re-skins over the shared state SVG geometry.
 * The base SVGs draw the classic blue-and-orange buddy; a character maps the
 * base hex fills onto its own palette, applied at load time in the pet window
 * (all 22 states recolor consistently).
 */
export type PetCharacterId =
  | 'classic'
  | 'stone-guardian'
  | 'shadow-assassin'
  | 'frost-mage'
  | 'magma-core'
  | 'void-sprite';

export type PetCharacter = {
  id: PetCharacterId;
  /** Display name (zh) shown in the picker. */
  name: string;
  /** Preview swatches: [body, accent] */
  swatch: [string, string];
  /** Base-hex → character-hex replacements applied to every state SVG. */
  palette: Record<string, string>;
};

const character = (
  id: PetCharacterId,
  name: string,
  swatch: [string, string],
  body: [string, string, string],
  accent: [string, string, string]
): PetCharacter => ({
  id,
  name,
  swatch,
  palette: {
    // Body blues (dark → light) keep relative ordering in each palette.
    '#8891b8': body[0],
    '#9098b8': body[0],
    '#97A0C5': body[1],
    '#94BDFF': body[2],
    // Orange accents (main → deep).
    '#e8714a': accent[0],
    '#FF6B35': accent[1],
    '#FF5B24': accent[2],
  },
});

export const PET_CHARACTERS: PetCharacter[] = [
  { id: 'classic', name: '经典蓝宝', swatch: ['#8891b8', '#e8714a'], palette: {} },
  character('stone-guardian', '磐石卫士', ['#8a8f98', '#7ba05b'], ['#8a8f98', '#a5abb5', '#c4c9d1'], ['#7ba05b', '#95c37a', '#5f8a47']),
  character('shadow-assassin', '暗影刺客', ['#3d3a52', '#a78bfa'], ['#3d3a52', '#4a4663', '#5d5980'], ['#a78bfa', '#c4b5fd', '#8b5cf6']),
  character('frost-mage', '寒冰法师', ['#a8d8ea', '#38bdf8'], ['#a8d8ea', '#c4e8f5', '#dff2fa'], ['#38bdf8', '#7dd3fc', '#0ea5e9']),
  character('magma-core', '熔岩核芯', ['#4a3c39', '#f59e0b'], ['#4a3c39', '#5d4c48', '#72605b'], ['#f59e0b', '#fbbf24', '#d97706']),
  character('void-sprite', '虚空精灵', ['#6f47a8', '#e879f9'], ['#6f47a8', '#8259bd', '#9a77ce'], ['#e879f9', '#f0abfc', '#c026d3']),
];

export const DEFAULT_PET_CHARACTER: PetCharacterId = 'classic';

export const resolvePetCharacter = (id: string | undefined | null): PetCharacter =>
  PET_CHARACTERS.find((c) => c.id === id) ?? PET_CHARACTERS[0];
