import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Message, Spin, Tag } from '@arco-design/web-react';
import { ArrowLeft, ArrowRight, Copy, Earth, Home, Inbox, LoadingOne, Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import {
  BROWSER_HOME_URL,
  buildActionScript,
  buildExtractionScript,
  isAllowedNavigateUrl,
  resolveAddressInput,
  type ActionResult,
  type PageSnapshot,
} from './browserUtils';
import { isElectronDesktop } from '@renderer/utils/platform';

type WebviewElement = Electron.WebviewTag;

/**
 * Embedded browser: an in-app <webview> with an address bar that accepts
 * URLs or free-text searches, one-click content recognition feeding Inbox,
 * and structured programmatic operation (click / set / scroll) executed in
 * the sandboxed guest page.
 */
const BrowserPage: React.FC = () => {
  const { t } = useTranslation();
  const webviewRef = useRef<WebviewElement | null>(null);
  const [address, setAddress] = useState(BROWSER_HOME_URL);
  const [pageTitle, setPageTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [snapshot, setSnapshot] = useState<PageSnapshot | null>(null);
  const [reading, setReading] = useState(false);
  const [savedToInbox, setSavedToInbox] = useState(false);
  const [actionSelector, setActionSelector] = useState('');
  const [actionValue, setActionValue] = useState('');
  const [lastAction, setLastAction] = useState<ActionResult | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const desktop = isElectronDesktop();

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    // Electron webviews on Windows: real OS-level mouse input into the guest
    // dies after navigation unless the embed layer is re-attached (the
    // display-toggle reflow). Synthetic CDP clicks keep working, so testing
    // must use real input. The reflow is required on EVERY dom-ready —
    // "once per attach" and visibility-probing both left later documents
    // dead. To keep heavy pages fast, run it deferred (after first paint
    // settles) instead of synchronously at dom-ready.
    const applyInputFix = () => {
      try {
        webview.style.display = 'none';
        // Force layout recalc between the two display values.
        void webview.offsetHeight;
        webview.style.display = '';
        webview.focus();
      } catch {
        // Guest not yet attached; safe to ignore.
      }
    };
    const scheduleInputFix = () => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setTimeout(applyInputFix, 200);
        })
      );
    };
    const onDomReady = () => {
      setLoading(false);
      setCanGoBack(webview.canGoBack());
      setCanGoForward(webview.canGoForward());
      scheduleInputFix();
    };
    const onTitle = (event: CustomEvent<string>) => {
      setPageTitle(event.detail ?? '');
    };
    const onNavigate = (event: CustomEvent<string>) => {
      setAddress(event.detail ?? webview.getURL());
      setSavedToInbox(false);
    };
    const onStart = () => setLoading(true);
    // Route target=_blank / window.open into the same webview instead of
    // silently blocking them (the default when allowpopups is absent).
    const onNewWindow = (event: Event & { url?: string; preventDefault(): void }) => {
      event.preventDefault();
      if (event.url && isAllowedNavigateUrl(event.url)) {
        void webview.loadURL(event.url);
      }
    };
    webview.addEventListener('dom-ready', onDomReady);
    webview.addEventListener('page-title-updated', onTitle as EventListener);
    webview.addEventListener('did-navigate', onNavigate as EventListener);
    webview.addEventListener('did-navigate-in-page', onNavigate as EventListener);
    webview.addEventListener('did-start-loading', onStart);
    webview.addEventListener('new-window', onNewWindow as EventListener);
    return () => {
      webview.removeEventListener('dom-ready', onDomReady);
      webview.removeEventListener('page-title-updated', onTitle as EventListener);
      webview.removeEventListener('did-navigate', onNavigate as EventListener);
      webview.removeEventListener('did-navigate-in-page', onNavigate as EventListener);
      webview.removeEventListener('did-start-loading', onStart);
      webview.removeEventListener('new-window', onNewWindow as EventListener);
    };
  }, [desktop]);

  const navigate = useCallback(
    (rawInput: string) => {
      const resolution = resolveAddressInput(rawInput);
      if (resolution.kind === 'invalid') return;
      const webview = webviewRef.current;
      if (!webview) return;
      setSnapshot(null);
      setSavedToInbox(false);
      void webview.loadURL(resolution.url).catch(() => {
        Message.error(t('personal.browser.loadFailed', { defaultValue: '页面加载失败' }));
      });
    },
    [t]
  );

  const runInPage = async <T,>(script: string): Promise<T | null> => {
    const webview = webviewRef.current;
    if (!webview) return null;
    try {
      return (await webview.executeJavaScript(script)) as T;
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
      <div className='flex shrink-0 flex-wrap items-center gap-8px border-b border-solid border-b-base px-12px py-8px'>
        {toolbarButton(
          t('personal.browser.back', { defaultValue: '后退' }),
          <ArrowLeft size='16' />,
          () => webviewRef.current?.goBack(),
          !canGoBack
        )}
        {toolbarButton(
          t('personal.browser.forward', { defaultValue: '前进' }),
          <ArrowRight size='16' />,
          () => webviewRef.current?.goForward(),
          !canGoForward
        )}
        {toolbarButton(t('personal.browser.reload', { defaultValue: '刷新' }), <Refresh size='16' />, () =>
          webviewRef.current?.reload()
        )}
        {toolbarButton(t('personal.browser.home', { defaultValue: '首页' }), <Home size='16' />, () =>
          navigate(BROWSER_HOME_URL)
        )}
        <Input.Search
          aria-label={t('personal.browser.address', { defaultValue: '地址或搜索' })}
          className='min-w-240px flex-1'
          data-testid='browser-address'
          defaultValue={BROWSER_HOME_URL}
          key={address}
          loading={loading}
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
        <section
          className='relative min-h-0 min-w-0 border-r border-solid border-b-base'
          onMouseDown={() => {
            // Forward focus to the webview guest when the container is
            // clicked, ensuring input events reach the embedded page.
            try {
              webviewRef.current?.focus();
            } catch {
              // guest not yet attached
            }
          }}
        >
          {desktop ? (
            // Hardened by the main process `will-attach-webview` handler: no
            // preload, no node integration inside the guest page.
            // Inline styles + autosize ensure the guest gets a real compositor
            // layer (CSS class-only sizing can leave visibilityState=hidden on
            // Windows, which silently swallows all input events).
            <webview
              ref={webviewRef}
              data-testid='browser-webview'
              partition='searcht-browser'
              src={BROWSER_HOME_URL}
              style={{ width: '100%', height: '100%', display: 'inline-flex' }}
            />
          ) : (
            <div className='flex h-full items-center justify-center p-24px text-center text-13px text-t-secondary'>
              {t('personal.browser.desktopOnly', { defaultValue: '内置浏览器仅在SearchT-UI桌面版中可用。' })}
            </div>
          )}
          {loading ? (
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
