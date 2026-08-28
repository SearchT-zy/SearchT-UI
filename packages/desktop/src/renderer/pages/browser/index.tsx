/**
 * @license
 * Copyright 2026 SearchT Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Message, Spin } from '@arco-design/web-react';
import { ArrowLeft, ArrowRight, Close, Copy, Earth, Home, Inbox, LoadingOne, Plus, Refresh } from '@icon-park/react';
import { ipcBridge } from '@/common';
import type { BrowserTabsSnapshot, BrowserViewState } from '@/common/types/searcht/browserView';
import { isElectronDesktop } from '@/renderer/utils/platform';
import {
  BROWSER_HOME_URL,
  buildActionScript,
  buildExtractionScript,
  resolveAddressInput,
  type ActionResult,
  type PageSnapshot,
} from './browserUtils';

const EMPTY_SNAPSHOT: BrowserTabsSnapshot = { tabs: [], activeTabId: null };

const tabLabel = (tab: BrowserViewState): string => {
  if (tab.loading) return tab.url ? tab.url.replace(/^https?:\/\//, '').slice(0, 24) : '…';
  if (tab.title) return tab.title.slice(0, 24);
  if (tab.url && tab.url !== 'about:blank') return tab.url.replace(/^https?:\/\//, '').split('/')[0].slice(0, 24);
  return '新标签页';
};

/**
 * Multi-tab embedded browser on the WebContentsView architecture.
 *
 * Each tab owns a main-process WebContentsView; the page renders a placeholder
 * viewport the active view is positioned over (bounds synced via
 * ResizeObserver + IPC). Input goes to the native view directly — the
 * <webview> tag's Windows input-routing bug does not apply to native views.
 */
const BrowserPage: React.FC = () => {
  const { t } = useTranslation();
  const desktop = isElectronDesktop();
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const [address, setAddress] = useState(BROWSER_HOME_URL);
  const [tabs, setTabs] = useState<BrowserTabsSnapshot>(EMPTY_SNAPSHOT);
  const activeTab = tabs.tabs.find((tb) => tb.id === tabs.activeTabId) ?? null;
  const [snapshot, setSnapshot] = useState<PageSnapshot | null>(null);
  const [reading, setReading] = useState(false);
  const [savedToInbox, setSavedToInbox] = useState(false);
  const [actionSelector, setActionSelector] = useState('');
  const [actionValue, setActionValue] = useState('');
  const [lastAction, setLastAction] = useState<ActionResult | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const applySnapshot = useCallback((next: BrowserTabsSnapshot | null | undefined): void => {
    if (!next) return;
    setTabs(next);
    const active = next.tabs.find((tb) => tb.id === next.activeTabId);
    if (active && active.url && active.url !== 'about:blank') setAddress(active.url);
    setSavedToInbox(false);
  }, []);

  // Ensure one tab exists on mount, then keep in sync with main-process state.
  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    void ipcBridge.browserView.createTab
      .invoke({ url: BROWSER_HOME_URL })
      .then((state: BrowserTabsSnapshot | null) => {
        if (!cancelled && state) {
          // createTab always appends; if the manager already had tabs (kept
          // alive from a previous mount), drop the extra blank tab we just
          // added unless it navigated somewhere.
          const blank = state.tabs.find((tb) => !tb.url || tb.url === 'about:blank');
          if (state.tabs.length > 1 && blank && blank.id === state.activeTabId) {
            void ipcBridge.browserView.closeTab.invoke({ tabId: blank.id }).then(applySnapshot).catch((): undefined => undefined);
            return;
          }
          applySnapshot(state);
        }
      })
      .catch((): undefined => undefined);
    const removeStateListener = ipcBridge.browserView.state.on((state: BrowserTabsSnapshot) => {
      if (!cancelled) applySnapshot(state);
    });
    return () => {
      cancelled = true;
      removeStateListener?.();
      void ipcBridge.browserView.hide.invoke().catch((): undefined => undefined);
    };
  }, [desktop, applySnapshot]);

  // Keep the ACTIVE native view positioned over the placeholder viewport.
  useEffect(() => {
    if (!desktop) return;
    const el = viewportRef.current;
    if (!el) return;
    const report = (): void => {
      const rect = el.getBoundingClientRect();
      void ipcBridge.browserView.setBounds
        .invoke({
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.max(0, Math.round(rect.width)),
          height: Math.max(0, Math.round(rect.height)),
        })
        .catch((): undefined => undefined);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    window.addEventListener('resize', report);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
    };
  }, [desktop]);

  const navigate = useCallback(
    (rawInput: string) => {
      const resolution = resolveAddressInput(rawInput);
      if (resolution.kind === 'invalid') return;
      setSnapshot(null);
      setSavedToInbox(false);
      void ipcBridge.browserView.navigate.invoke({ url: resolution.url }).catch((): undefined => {
        Message.error(t('personal.browser.loadFailed', { defaultValue: '页面加载失败' }));
        return undefined;
      });
    },
    [t]
  );

  const newTab = useCallback((): void => {
    void ipcBridge.browserView.createTab
      .invoke({ url: BROWSER_HOME_URL })
      .then(applySnapshot)
      .catch((): undefined => undefined);
  }, [applySnapshot]);

  const closeTab = useCallback(
    (tabId: string): void => {
      setSnapshot(null);
      void ipcBridge.browserView.closeTab
        .invoke({ tabId })
        .then((next: BrowserTabsSnapshot | null) => {
          // Closing the last tab opens a fresh home tab so the browser is
          // never empty.
          if (next && next.tabs.length === 0) {
            void ipcBridge.browserView.createTab
              .invoke({ url: BROWSER_HOME_URL })
              .then(applySnapshot)
              .catch((): undefined => undefined);
            return;
          }
          applySnapshot(next);
        })
        .catch((): undefined => undefined);
    },
    [applySnapshot]
  );

  const switchTab = useCallback(
    (tabId: string): void => {
      setSnapshot(null);
      void ipcBridge.browserView.switchTab
        .invoke({ tabId })
        .then(applySnapshot)
        .catch((): undefined => undefined);
    },
    [applySnapshot]
  );

  const runInPage = async <T,>(script: string): Promise<T | null> => {
    try {
      const result = (await ipcBridge.browserView.execute.invoke({ script })) as T | null | undefined;
      return result ?? null;
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
      return null;
    }
  };

  const readPage = async () => {
    setReading(true);
    try {
      const result = await runInPage<PageSnapshot>(buildExtractionScript());
      if (result) setSnapshot(result);
    } finally {
      setReading(false);
    }
  };

  const saveToInbox = async () => {
    if (!snapshot) return;
    const content = `${snapshot.title}\n${snapshot.url}\n\n${snapshot.text}`;
    try {
      await ipcBridge.inbox.captureText.invoke({ text: content, title: snapshot.title || snapshot.url });
      setSavedToInbox(true);
      Message.success(t('personal.browser.saved', { defaultValue: '已存入收件箱' }));
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const runAction = async (action: Parameters<typeof buildActionScript>[0]) => {
    setActionBusy(true);
    try {
      const result = await runInPage<ActionResult>(buildActionScript(action));
      if (result) setLastAction(result);
    } finally {
      setActionBusy(false);
    }
  };

  const toolbarButton = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    disabled = false
  ): React.ReactNode => (
    <Button type='text' size='small' icon={icon} aria-label={label} disabled={disabled} onClick={onClick} />
  );

  return (
    <div className='flex h-full max-w-full flex-col overflow-hidden bg-bg-1' data-testid='browser-page'>
      {/* Tab strip */}
      {desktop ? (
        <div
          className='flex shrink-0 items-stretch gap-2px overflow-x-auto border-b border-solid border-b-base px-8px pt-6px'
          data-testid='browser-tabstrip'
        >
          {tabs.tabs.map((tab) => (
            <div
              key={tab.id}
              role='tab'
              aria-selected={tab.id === tabs.activeTabId}
              data-testid={`browser-tab-${tab.id}`}
              className={`group flex h-30px max-w-180px min-w-110px shrink-0 cursor-pointer items-center gap-6px rounded-t-6px px-10px text-12px ${
                tab.id === tabs.activeTabId
                  ? 'bg-bg-3 font-500 text-t-primary'
                  : 'text-t-secondary hover:bg-fill-2'
              }`}
              onClick={() => switchTab(tab.id)}
            >
              {tab.loading ? <Spin size={12} /> : <Earth size='12' className='shrink-0' />}
              <span className='min-w-0 flex-1 truncate'>{tabLabel(tab)}</span>
              <span
                role='button'
                aria-label={t('personal.browser.closeTab', { defaultValue: '关闭标签页' })}
                className='shrink-0 rd-4px p-2px opacity-40 hover:bg-fill-3 hover:opacity-100'
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                <Close size='10' />
              </span>
            </div>
          ))}
          <button
            type='button'
            aria-label={t('personal.browser.newTab', { defaultValue: '新建标签页' })}
            data-testid='browser-new-tab'
            className='my-4px ml-2px flex h-22px w-22px shrink-0 cursor-pointer items-center justify-center rd-6px text-t-secondary hover:bg-fill-2 hover:text-t-primary'
            onClick={newTab}
          >
            <Plus size='12' />
          </button>
        </div>
      ) : null}

      {/* Toolbar */}
      <div className='flex shrink-0 flex-wrap items-center gap-8px border-b border-solid border-b-base px-12px py-8px'>
        {toolbarButton(t('personal.browser.back', { defaultValue: '后退' }), <ArrowLeft size='16' />, (): void => {
          void ipcBridge.browserView.back.invoke().catch((): undefined => undefined);
        }, !activeTab?.canGoBack)}
        {toolbarButton(t('personal.browser.forward', { defaultValue: '前进' }), <ArrowRight size='16' />, (): void => {
          void ipcBridge.browserView.forward.invoke().catch((): undefined => undefined);
        }, !activeTab?.canGoForward)}
        {toolbarButton(t('personal.browser.reload', { defaultValue: '刷新' }), <Refresh size='16' />, (): void => {
          void ipcBridge.browserView.reload.invoke().catch((): undefined => undefined);
        })}
        {toolbarButton(t('personal.browser.home', { defaultValue: '首页' }), <Home size='16' />, () =>
          navigate(BROWSER_HOME_URL)
        )}
        <Input.Search
          aria-label={t('personal.browser.address', { defaultValue: '地址或搜索' })}
          className='min-w-240px flex-1'
          data-testid='browser-address'
          defaultValue={BROWSER_HOME_URL}
          key={`${tabs.activeTabId}-${address}`}
          loading={Boolean(activeTab?.loading)}
          prefix={<Earth size='14' />}
          placeholder={t('personal.browser.placeholder', { defaultValue: '输入网址或搜索关键词，回车打开' })}
          searchButton
          value={address}
          onChange={setAddress}
          onSearch={(value) => navigate(value)}
        />
      </div>

      <div className='grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]'>
        <section className='relative min-h-0 min-w-0 border-r border-solid border-b-base'>
          {desktop ? (
            // Placeholder: the active tab's WebContentsView renders exactly over
            // this box (bounds synced above). Native view = native input routing.
            <div
              ref={viewportRef}
              data-testid='browser-webview'
              className='size-full bg-white'
              style={{ minHeight: 120 }}
            />
          ) : (
            <div className='flex h-full items-center justify-center p-24px text-center text-13px text-t-secondary'>
              {t('personal.browser.desktopOnly', { defaultValue: '内置浏览器仅在SearchT桌面版中可用。' })}
            </div>
          )}
          {activeTab?.loading ? (
            <div className='pointer-events-none absolute inset-x-0 top-0 flex justify-center pt-8px'>
              <Spin size={20} />
            </div>
          ) : null}
        </section>

        <aside
          className='flex min-h-0 flex-col gap-12px overflow-y-auto px-12px py-10px'
          data-testid='browser-side-panel'
        >
          <div>
            <div className='mb-6px flex items-center gap-6px text-13px font-600 text-t-primary'>
              <Earth size='14' />
              {t('personal.browser.recognize', { defaultValue: '识别页面内容' })}
            </div>
            <p className='m-0 mb-8px text-12px leading-18px text-t-secondary'>
              {t('personal.browser.recognizeHint', {
                defaultValue: '提取当前页面的标题、正文与链接数量，可一键存入收件箱。',
              })}
            </p>
            <div className='flex gap-8px'>
              <Button
                size='small'
                type='primary'
                icon={<LoadingOne size='14' />}
                loading={reading}
                disabled={!desktop}
                data-testid='browser-read-page'
                onClick={() => void readPage()}
              >
                {t('personal.browser.read', { defaultValue: '读取页面内容' })}
              </Button>
              <Button
                size='small'
                icon={<Inbox size='14' />}
                disabled={!snapshot || savedToInbox}
                data-testid='browser-save-inbox'
                onClick={() => void saveToInbox()}
              >
                {savedToInbox
                  ? t('personal.browser.saved', { defaultValue: '已存入收件箱' })
                  : t('personal.browser.save', { defaultValue: '存入收件箱' })}
              </Button>
              {snapshot ? (
                <Button
                  size='small'
                  icon={<Copy size='14' />}
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(snapshot.text)
                      .then(() => Message.success(t('personal.browser.copied', { defaultValue: '已复制正文' })));
                  }}
                >
                  {t('personal.browser.copy', { defaultValue: '复制正文' })}
                </Button>
              ) : null}
            </div>
            {snapshot ? (
              <div
                className='mt-8px rounded-6px border border-solid border-b-base bg-bg-2 p-10px'
                data-testid='browser-snapshot'
              >
                <div className='truncate text-13px font-500 text-t-primary'>{snapshot.title || snapshot.url}</div>
                <div className='mt-2px truncate text-11px text-t-secondary'>{snapshot.url}</div>
                <div className='mt-2px text-11px text-t-tertiary'>
                  {t('personal.browser.links', { defaultValue: '链接' })}: {snapshot.linkCount} ·{' '}
                  {t('personal.browser.chars', { defaultValue: '字符' })}: {snapshot.text.length}
                </div>
                <pre className='m-0 mt-6px max-h-240px overflow-y-auto whitespace-pre-wrap break-words text-12px leading-18px text-t-primary'>
                  {snapshot.text.slice(0, 4000)}
                  {snapshot.text.length > 4000 ? '…' : ''}
                </pre>
              </div>
            ) : null}
          </div>

          <div className='border-t border-solid border-b-base pt-10px'>
            <div className='mb-6px text-13px font-600 text-t-primary'>
              {t('personal.browser.operate', { defaultValue: '操作浏览器' })}
            </div>
            <p className='m-0 mb-8px text-12px leading-18px text-t-secondary'>
              {t('personal.browser.operateHint', { defaultValue: '通过 CSS 选择器点击元素、填写输入框或滚动页面。' })}
            </p>
            <div className='flex flex-col gap-8px'>
              <Input
                aria-label={t('personal.browser.selector', { defaultValue: 'CSS 选择器' })}
                data-testid='browser-action-selector'
                placeholder='#searchInput、a.login、button[type=submit]'
                value={actionSelector}
                onChange={setActionSelector}
              />
              <Input
                aria-label={t('personal.browser.value', { defaultValue: '填写的文本' })}
                data-testid='browser-action-value'
                placeholder={t('personal.browser.valuePlaceholder', {
                  defaultValue: '填写输入框时使用的文本（可留空）',
                })}
                value={actionValue}
                onChange={setActionValue}
              />
              <div className='flex flex-wrap gap-8px'>
                <Button
                  size='small'
                  disabled={!desktop || !actionSelector.trim()}
                  loading={actionBusy}
                  data-testid='browser-action-click'
                  onClick={() => void runAction({ type: 'click', selector: actionSelector.trim() })}
                >
                  {t('personal.browser.click', { defaultValue: '点击元素' })}
                </Button>
                <Button
                  size='small'
                  disabled={!desktop || !actionSelector.trim()}
                  loading={actionBusy}
                  data-testid='browser-action-set'
                  onClick={() => void runAction({ type: 'set', selector: actionSelector.trim(), value: actionValue })}
                >
                  {t('personal.browser.set', { defaultValue: '填写文本' })}
                </Button>
                <Button
                  size='small'
                  disabled={!desktop}
                  loading={actionBusy}
                  data-testid='browser-action-scroll-down'
                  onClick={() => void runAction({ type: 'scroll', deltaY: 600 })}
                >
                  {t('personal.browser.scrollDown', { defaultValue: '下滚 600px' })}
                </Button>
                <Button
                  size='small'
                  disabled={!desktop}
                  loading={actionBusy}
                  data-testid='browser-action-scroll-up'
                  onClick={() => void runAction({ type: 'scroll', deltaY: -600 })}
                >
                  {t('personal.browser.scrollUp', { defaultValue: '上滚 600px' })}
                </Button>
              </div>
              {lastAction ? (
                <div
                  className={`rounded-6px px-10px py-8px text-12px ${
                    lastAction.ok ? 'bg-success-1 text-success-6' : 'bg-danger-1 text-danger-6'
                  }`}
                  data-testid='browser-action-result'
                  role='status'
                >
                  {lastAction.detail}
                </div>
              ) : null}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default BrowserPage;
