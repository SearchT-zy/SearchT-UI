/**
 * Pure logic for the embedded browser page: address-bar resolution,
 * navigation guard, and the scripts injected into the <webview> guest for
 * content recognition and programmatic operation. Kept side-effect free so
 * it stays unit-testable outside Electron.
 */

export const DEFAULT_SEARCH_BASE = 'https://www.bing.com/search?q=';
export const BROWSER_HOME_URL = 'https://www.bing.com';

const MAX_TEXT_CHARS = 20_000;

/** Looks like a bare hostname such as `example.com` or `example.com/path`. */
function looksLikeBareHostname(value: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+([/?#].*)?$/i.test(value);
}

export type AddressResolution =
  | { kind: 'url'; url: string }
  | { kind: 'search'; url: string; query: string }
  | { kind: 'invalid' };

/**
 * Address-bar input can be a URL (with or without protocol) or a free-text
 * search query. Anything that cannot become a safe http(s) URL is treated as
 * a search.
 */
export function resolveAddressInput(rawInput: string, searchBase = DEFAULT_SEARCH_BASE): AddressResolution {
  const input = rawInput.trim();
  if (!input) return { kind: 'invalid' };

  const candidate = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  if (/^https?:\/\//i.test(input) || looksLikeBareHostname(input)) {
    try {
      const parsed = new URL(candidate);
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.includes('.')) {
        return { kind: 'url', url: parsed.toString() };
      }
    } catch {
      // fall through to search
    }
  }

  const search = new URL(searchBase);
  search.searchParams.set('q', input);
  return { kind: 'search', url: search.toString(), query: input };
}

/** Only http(s) navigation is allowed inside the embedded browser. */
export function isAllowedNavigateUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export type PageSnapshot = {
  title: string;
  url: string;
  text: string;
  linkCount: number;
};

/** Script executed inside the guest page to extract readable content. */
export function buildExtractionScript(): string {
  return `(function () {
    var selectors = ['article', 'main', '[role="main"]', '#content', '.content', 'body'];
    var best = '';
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el && el.innerText && el.innerText.trim().length > best.length) best = el.innerText.trim();
    }
    var text = (best || document.body && document.body.innerText || '').trim();
    return {
      title: document.title || '',
      url: location.href,
      text: text.slice(0, ${MAX_TEXT_CHARS}),
      linkCount: document.querySelectorAll('a[href]').length
    };
  })()`;
}

export type BrowserAction =
  | { type: 'click'; selector: string }
  | { type: 'set'; selector: string; value: string }
  | { type: 'scroll'; deltaY: number };

/** Serializable result returned from an action script. */
export type ActionResult = { ok: boolean; detail: string };

function selectorLiteral(selector: string): string {
  return JSON.stringify(selector);
}

/**
 * Script executed inside the guest page to perform one programmatic action.
 * Selectors are embedded as JSON string literals so arbitrary selector text
 * can never break out of the script.
 */
export function buildActionScript(action: BrowserAction): string {
  switch (action.type) {
    case 'click':
      return `(function () {
        var el = document.querySelector(${selectorLiteral(action.selector)});
        if (!el) return { ok: false, detail: 'element not found' };
        el.scrollIntoView({ block: 'center' });
        el.click();
        return { ok: true, detail: 'clicked' };
      })()`;
    case 'set':
      return `(function () {
        var el = document.querySelector(${selectorLiteral(action.selector)});
        if (!el) return { ok: false, detail: 'element not found' };
        var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
          : el instanceof HTMLInputElement ? HTMLInputElement.prototype : null;
        el.focus();
        var descriptor = proto && Object.getOwnPropertyDescriptor(proto, 'value');
        if (descriptor && descriptor.set) {
          descriptor.set.call(el, ${JSON.stringify(action.value)});
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true, detail: 'value set (native setter)' };
        }
        el.value = ${JSON.stringify(action.value)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return { ok: true, detail: 'value set' };
      })()`;
    case 'scroll':
      return `(function () {
        var delta = ${Math.trunc(action.deltaY)};
        window.scrollBy({ top: delta, left: 0, behavior: 'smooth' });
        return { ok: true, detail: 'scrolled ' + delta + 'px' };
      })()`;
    default:
      return `(function () { return { ok: false, detail: 'unknown action' }; })()`;
  }
}
