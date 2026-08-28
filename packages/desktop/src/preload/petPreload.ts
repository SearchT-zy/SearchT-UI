/**
 * @license
 * Copyright 2025 SearchT Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('petAPI', {
  onStateChange: (cb: (state: string) => void) => {
    ipcRenderer.on('pet:state-changed', (_e, state: string) => cb(state));
  },
  onCharacterChanged: (cb: (characterId: string) => void) => {
    ipcRenderer.on('pet:character-changed', (_e, characterId: string) => cb(characterId));
  },
  onEyeMove: (cb: (data: { eyeDx: number; eyeDy: number; bodyDx: number; bodyRotate: number }) => void) => {
    ipcRenderer.on('pet:eye-move', (_e, data) => cb(data));
  },
  onResize: (cb: (size: number) => void) => {
    ipcRenderer.on('pet:resize', (_e, size: number) => cb(size));
  },
});
