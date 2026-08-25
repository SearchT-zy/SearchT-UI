/**
 * @license
 * Copyright 2026 SearchT-UI Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserWindow, WebContentsView } from 'electron';
import { emit } from '@/common/platform/bridge';

/**
 * Embedded browser implementation on WebContentsView.
 *
 * Replaces the <webview> tag: on Windows the tag's guest input routing drops
 * real (OS-level) mouse events — clicks visibly do nothing while synthetic
 * (CDP) input works. WebContentsView is attached to the window as a native
 * view, so the OS routes input to it directly and the webview input bug is
 * bypassed entirely.
 */

export type BrowserViewState = {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
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

class BrowserViewManager {
  private view: WebContentsView | null = null;
  private hostWindow: BrowserWindow | null = null;
  private bounds: Electron.Rectangle = { x: 0, y: 0, width: 0, height: 0 };
  private visible = false;
  private cleanup: Array<() => void> = [];

  private ensureView(win: BrowserWindow): WebContentsView {
    if (this.view && this.hostWindow === win && !win.isDestroyed()) return this.view;
    this.destroyView();

    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // The embedded browser loads untrusted web pages — same hardening the
        // old will-attach-webview handler applied to <webview> guests.
      },
    });
    this.view = view;
    this.hostWindow = win;
    win.contentView.addChildView(view);

    const wc = view.webContents;
    const pushState = () => this.pushState();
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

    // Route target=_blank / window.open into the same view instead of popping
    // a separate window (matches the old new-window handler behavior).
    wc.setWindowOpenHandler(({ url }: Electron.HandlerDetails): { action: 'deny' } => {
      if (isHttpUrl(url)) void wc.loadURL(url).catch((): undefined => undefined);
      return { action: 'deny' };
    });

    // Hide until the renderer reports its viewport bounds.
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    return view;
  }

  private currentState(): BrowserViewState {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) {
      return { url: '', title: '', loading: false, canGoBack: false, canGoForward: false };
    }
    return {
      url: wc.getURL(),
      title: wc.getTitle(),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    };
  }

  private pushState(): void {
    emit(STATE_EVENT, this.currentState());
  }

  /** Create (if needed) and show the view; optionally navigate. */
  ensure(win: BrowserWindow, url?: string): BrowserViewState {
    const view = this.ensureView(win);
    if (url && isHttpUrl(url)) {
      void view.webContents.loadURL(url).catch(() => this.pushState());
    }
    this.applyVisibility();
    return this.currentState();
  }

  setBounds(rect: { x: number; y: number; width: number; height: number }): void {
    this.bounds = { ...rect };
    if (!this.view) return;
    this.view.setBounds({ ...rect });
  }

  show(): void {
    this.visible = true;
    this.applyVisibility();
  }

  hide(): void {
    this.visible = false;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    if (!this.view) return;
    const hasSize = this.bounds.width > 0 && this.bounds.height > 0;
    const show = this.visible && hasSize;
    try {
      if (show) {
        this.view.setBounds({ ...this.bounds });
        if (this.hostWindow && !this.hostWindow.isDestroyed()) {
          this.hostWindow.contentView.addChildView(this.view);
        }
      } else {
        this.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
    } catch {
      // Window tearing down; ignore.
    }
  }

  navigate(rawUrl: string): BrowserViewState {
    if (!this.view || !isHttpUrl(rawUrl)) return this.currentState();
    void this.view.webContents.loadURL(rawUrl).catch(() => this.pushState());
    return this.currentState();
  }

  goBack(): BrowserViewState {
    const wc = this.view?.webContents;
    if (wc && !wc.isDestroyed() && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    return this.currentState();
  }

  goForward(): BrowserViewState {
    const wc = this.view?.webContents;
    if (wc && !wc.isDestroyed() && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    return this.currentState();
  }

  reload(): BrowserViewState {
    const wc = this.view?.webContents;
    if (wc && !wc.isDestroyed()) wc.reload();
    return this.currentState();
  }

  async execute<T>(script: string): Promise<T | null> {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return null;
    try {
      return (await wc.executeJavaScript(script, true)) as T;
    } catch {
      return null;
    }
  }

  private destroyView(): void {
    for (const fn of this.cleanup.splice(0)) fn();
    if (this.view) {
      try {
        this.hostWindow?.contentView.removeChildView(this.view);
        this.view.webContents.close();
      } catch {
        // Already gone.
      }
      this.view = null;
      this.hostWindow = null;
    }
  }

  destroy(): void {
    this.destroyView();
    this.bounds = { x: 0, y: 0, width: 0, height: 0 };
    this.visible = false;
  }
}

export const browserViewManager = new BrowserViewManager();
