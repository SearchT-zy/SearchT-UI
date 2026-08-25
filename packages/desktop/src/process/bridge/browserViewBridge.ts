/**
 * @license
 * Copyright 2026 SearchT-UI Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserWindow } from 'electron';
import { ipcBridge } from '@/common';
import { browserViewManager, type BrowserViewState } from '@process/services/browserViewService';

/** Resolve the host window for browser-view commands (single main window app). */
const hostWindow = (): BrowserWindow | null => {
  const windows = BrowserWindow.getAllWindows();
  return windows.find((win) => !win.isDestroyed()) ?? null;
};

export function initBrowserViewBridge(): void {
  ipcBridge.browserView.ensure.provider(async (input) =>
    browserViewManager.ensure(hostWindow() ?? ({ isDestroyed: () => true } as unknown as BrowserWindow), input?.url)
  );
  ipcBridge.browserView.setBounds.provider(async (input) => {
    browserViewManager.setBounds(input);
    browserViewManager.show();
    return true;
  });
  ipcBridge.browserView.navigate.provider(async (input) => browserViewManager.navigate(input.url));
  ipcBridge.browserView.back.provider(async () => browserViewManager.goBack());
  ipcBridge.browserView.forward.provider(async () => browserViewManager.goForward());
  ipcBridge.browserView.reload.provider(async () => browserViewManager.reload());
  ipcBridge.browserView.execute.provider(async (input) => browserViewManager.execute<unknown>(input.script));
  ipcBridge.browserView.hide.provider(async () => {
    browserViewManager.hide();
    return true;
  });
}

export type { BrowserViewState };
