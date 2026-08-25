/**
 * @license
 * Copyright 2026 SearchT-UI Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Message, Spin, Tag } from '@arco-design/web-react';
import { ArrowLeft, ArrowRight, Copy, Earth, Home, Inbox, LoadingOne, Refresh } from '@icon-park/react';
import { ipcBridge } from '@/common';
import type { BrowserViewState } from '@/common/types/searcht/browserView';
import { isElectronDesktop } from '@/renderer/utils/platform';
import {
  BROWSER_HOME_URL,
  buildActionScript,
  buildExtractionScript,
  resolveAddressInput,
  type ActionResult,
  type PageSnapshot,
} from './browserUtils';

/**
 * Embedded browser page on the WebContentsView architecture.
 *
 * The page renders a placeholder viewport; the actual web content lives in a
 * main-process WebContentsView positioned exactly over the placeholder (bounds
 * synced via ResizeObserver + IPC). Input goes to the native view directly —
 * the <webview> tag's Windows input-routing bug (real mouse clicks silently
 * dropped) does not apply to native views.
 */
const BrowserPage: React.FC = () => {
  const { t } = useTranslation();
  const desktop = isElectronDesktop();
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const [address, setAddress] = useState(BROWSER_HOME_URL);
  const [viewState, setViewState] = useState<BrowserViewState>({
    url: BROWSER_HOME_URL,
    title: '',
    loading: false,
    canGoBack: false,
    canGoForward: false,
  });
  const [snapshot, setSnapshot] = useState<PageSnapshot | null>(null);
  const [reading, setReading] = useState(false);
  const [savedToInbox, setSavedToInbox] = useState(false);
  const [actionSelector, setActionSelector] = useState('');
  const [actionValue, setActionValue] = useState('');
  const [lastAction, setLastAction] = useState<ActionResult | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Create/show the native view on mount, hide on unmount.
  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
      void ipcBridge.browserView.ensure
        .invoke({ url: BROWSER_HOME_URL })
        .then((state: BrowserViewState | null) => {
          if (!cancelled && state) setViewState(state);
        })
        .catch((): undefined => undefined);
    const removeStateListener = ipcBridge.browserView.state.on((state: BrowserViewState) => {
      if (state) {
        setViewState(state);
        if (state.url && state.url !== 'about:blank') setAddress(state.url);
        setSavedToInbox(false);
      }
    });
    return () => {
      cancelled = true;
      removeStateListener?.();
      void ipcBridge.browserView.hide.invoke().catch((): undefined => undefined);
    };
  }, [desktop]);

  // Keep the native view positioned over the placeholder viewport.
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

  const pageTitle = viewState.title;

  return (
    <div className='flex h-full max-w-full flex-col overflow-hidden bg-bg-1' data-testid='browser-page'>
      <div className='flex shrink-0 flex-wrap items-center gap-8px border-b border-solid border-b-base px-12px py-8px'>
        {toolbarButton(t('personal.browser.back', { defaultValue: '后退' }), <ArrowLeft size='16' />, (): void => {
          void ipcBridge.browserView.back.invoke().catch((): undefined => undefined);
        }, !viewState.canGoBack)}
        {toolbarButton(t('personal.browser.forward', { defaultValue: '前进' }), <ArrowRight size='16' />, (): void => {
          void ipcBridge.browserView.forward.invoke().catch((): undefined => undefined);
        }, !viewState.canGoForward)}
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
          key={address}
          loading={viewState.loading}
          prefix={<Earth size='14' />}
          placeholder={t('personal.browser.placeholder', { defaultValue: '输入网址或搜索关键词，回车打开' })}
          searchButton
          value={address}
          onChange={setAddress}
          onSearch={(value) => navigate(value)}
        />
        {pageTitle ? (
          <Tag size='small' className='max-w-200px truncate'>
            {pageTitle}
          </Tag>
        ) : null}
      </div>

      <div className='grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]'>
        <section className='relative min-h-0 min-w-0 border-r border-solid border-b-base'>
          {desktop ? (
            // Placeholder: the main-process WebContentsView renders exactly over
            // this box (bounds synced above). Native view = native input routing.
            <div
              ref={viewportRef}
              data-testid='browser-webview'
              className='size-full bg-white'
              style={{ minHeight: 120 }}
            />
          ) : (
            <div className='flex h-full items-center justify-center p-24px text-center text-13px text-t-secondary'>
              {t('personal.browser.desktopOnly', { defaultValue: '内置浏览器仅在SearchT-UI桌面版中可用。' })}
            </div>
          )}
          {viewState.loading ? (
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
