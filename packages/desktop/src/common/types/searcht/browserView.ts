/**
 * @license
 * Copyright 2026 SearchT Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Per-tab state for the multi-tab WebContentsView embedded browser. */
export type BrowserViewState = {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};

/** Full snapshot pushed to the renderer on any tab/state change. */
export type BrowserTabsSnapshot = {
  tabs: BrowserViewState[];
  activeTabId: string | null;
};
