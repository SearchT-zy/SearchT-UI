/**
 * @license
 * Copyright 2026 SearchT-UI Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserWindow, WebContentsView } from 'electron';
import { emit } from '@/common/platform/bridge';

/**
 * Multi-tab embedded browser on WebContentsView.
 *
 * Each tab owns its own WebContentsView; only the active tab's view is
 * attached with real bounds — inactive views are sized 0 and detached, so
 * background tabs cost nothing visually. Input goes to the active view
 * natively (the old <webview> input-routing bug does not apply).
 */

export type BrowserTabState = {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};

export type BrowserTabsSnapshot = {
  tabs: BrowserTabState[];
  activeTabId: string | null;
};

const STATE_EVENT = 'browser-view.state';

const isHttpUrl = (rawUrl: string): boolean => {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

let nextTabSeq = 1;

class BrowserViewManager {
  private views = new Map<string, WebContentsView>();
  private hostWindow: BrowserWindow | null = null;
  private bounds: Electron.Rectangle = { x: 0, y: 0, width: 0, height: 0 };
  private visible = false;
  private activeTabId: string | null = null;
  private cleanup: Array<() => void> = [];

  private ensureView(win: BrowserWindow, tabId: string): WebContentsView {
    const existing = this.views.get(tabId);
    if (existing && this.hostWindow === win && !win.isDestroyed()) return existing;

    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.views.set(tabId, view);
    this.hostWindow = win;
    win.contentView.addChildView(view);

    const wc = view.webContents;
    const pushState = (): void => this.pushState();
    const events: Array<[string, () => void]> = [
      ['did-start-loading', pushState],
      ['did-stop-loading', pushState],
      ['did-navigate', pushState],
      ['did-navigate-in-page', pushState],
      ['page-title-updated', pushState],
    ];
    for (const [name, handler] of events) wc.on(name as never, handler as never);
    this.cleanup.push(() => {
      for (const [name, handler] of events) wc.off(name as never, handler as never);
    });

    wc.setWindowOpenHandler(({ url }: Electron.HandlerDetails): { action: 'deny' } => {
      if (isHttpUrl(url)) void wc.loadURL(url).catch((): undefined => undefined);
      return { action: 'deny' };
    });

    // Hidden until bounds arrive for an active tab.
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    return view;
  }

  private tabState(tabId: string): BrowserTabState {
    const view = this.views.get(tabId);
    const wc = view?.webContents;
    if (!wc || wc.isDestroyed()) {
      return { id: tabId, url: '', title: '', loading: false, canGoBack: false, canGoForward: false };
    }
    return {
      id: tabId,
      url: wc.getURL(),
      title: wc.getTitle(),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    };
  }

  private pushState(): void {
    emit(STATE_EVENT, this.snapshot());
  }

  snapshot(): BrowserTabsSnapshot {
    return {
      tabs: Array.from(this.views.keys()).map((id) => this.tabState(id)),
      activeTabId: this.activeTabId,
    };
  }

  /** Create a tab (optionally navigating); make it active. */
  createTab(win: BrowserWindow, url?: string): BrowserTabsSnapshot {
    const tabId = `t${nextTabSeq++}`;
    const view = this.ensureView(win, tabId);
    if (url && isHttpUrl(url)) {
      void view.webContents.loadURL(url).catch((): undefined => undefined);
    }
    this.activeTabId = tabId;
    this.applyVisibility();
    this.pushState();
    return this.snapshot();
  }

  closeTab(tabId: string): BrowserTabsSnapshot {
    const view = this.views.get(tabId);
    if (view) {
      try {
        this.hostWindow?.contentView.removeChildView(view);
        view.webContents.close();
      } catch {
        // Already gone.
      }
      this.views.delete(tabId);
    }
    if (this.activeTabId === tabId) {
      const remaining = Array.from(this.views.keys());
      this.activeTabId = remaining[remaining.length - 1] ?? null;
    }
    this.applyVisibility();
    this.pushState();
    return this.snapshot();
  }

  switchTab(tabId: string): BrowserTabsSnapshot {
    if (!this.views.has(tabId)) return this.snapshot();
    this.activeTabId = tabId;
    this.applyVisibility();
    this.pushState();
    return this.snapshot();
  }

  private activeView(): WebContentsView | null {
    return this.activeTabId ? (this.views.get(this.activeTabId) ?? null) : null;
  }

  setBounds(rect: { x: number; y: number; width: number; height: number }): void {
    this.bounds = { ...rect };
    this.applyVisibility();
  }

  show(): void {
    this.visible = true;
    this.applyVisibility();
  }

  hide(): void {
    this.visible = false;
    this.applyVisibility();
  }

  /** Only the active tab gets real bounds; every other view collapses. */
  private applyVisibility(): void {
    const hasSize = this.bounds.width > 0 && this.bounds.height > 0;
    for (const [tabId, view] of this.views) {
      const isActive = tabId === this.activeTabId;
      const show = isActive && this.visible && hasSize;
      try {
        if (show) {
          view.setBounds({ ...this.bounds });
        } else {
          view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        }
      } catch {
        // Window tearing down; ignore.
      }
    }
  }

  navigate(rawUrl: string): BrowserTabsSnapshot {
    const view = this.activeView();
    if (view && isHttpUrl(rawUrl)) {
      void view.webContents.loadURL(rawUrl).catch((): undefined => undefined);
    }
    return this.snapshot();
  }

  goBack(): BrowserTabsSnapshot {
    const wc = this.activeView()?.webContents;
    if (wc && !wc.isDestroyed() && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    return this.snapshot();
  }

  goForward(): BrowserTabsSnapshot {
    const wc = this.activeView()?.webContents;
    if (wc && !wc.isDestroyed() && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    return this.snapshot();
  }

  reload(): BrowserTabsSnapshot {
    const wc = this.activeView()?.webContents;
    if (wc && !wc.isDestroyed()) wc.reload();
    return this.snapshot();
  }

  async execute<T>(script: string): Promise<T | null> {
    const wc = this.activeView()?.webContents;
    if (!wc || wc.isDestroyed()) return null;
    try {
      return (await wc.executeJavaScript(script, true)) as T;
    } catch {
      return null;
    }
  }

  destroy(): void {
    for (const fn of this.cleanup.splice(0)) fn();
    for (const view of this.views.values()) {
      try {
        this.hostWindow?.contentView.removeChildView(view);
        view.webContents.close();
      } catch {
        // Already gone.
      }
    }
    this.views.clear();
    this.activeTabId = null;
    this.bounds = { x: 0, y: 0, width: 0, height: 0 };
    this.visible = false;
    this.hostWindow = null;
  }
}

export const browserViewManager = new BrowserViewManager();
