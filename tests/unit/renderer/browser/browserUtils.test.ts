import { describe, expect, it } from 'vitest';
import {
  BROWSER_HOME_URL,
  buildActionScript,
  buildExtractionScript,
  isAllowedNavigateUrl,
  resolveAddressInput,
} from '@renderer/pages/browser/browserUtils';

describe('resolveAddressInput', () => {
  it('normalizes bare hostnames and explicit protocols to https URLs', () => {
    expect(resolveAddressInput('example.com')).toEqual({ kind: 'url', url: 'https://example.com/' });
    expect(resolveAddressInput('example.com/docs?a=1')).toEqual({ kind: 'url', url: 'https://example.com/docs?a=1' });
    expect(resolveAddressInput('http://insecure.test')).toEqual({ kind: 'url', url: 'http://insecure.test/' });
  });

  it('routes free text to the search engine', () => {
    const result = resolveAddressInput('SearchT-UI 笔记 教程');
    expect(result.kind).toBe('search');
    if (result.kind === 'search') {
      expect(result.query).toBe('SearchT-UI 笔记 教程');
      expect(result.url).toContain('https://www.bing.com/search?q=');
    }
  });

  it('rejects blank input and unsafe protocols', () => {
    expect(resolveAddressInput('   ')).toEqual({ kind: 'invalid' });
    // file:// style input is not a bare hostname → becomes a search query.
    const fileish = resolveAddressInput('file:///etc/passwd');
    expect(fileish.kind).toBe('search');
    // A hostname without a dot cannot be a URL → search.
    expect(resolveAddressInput('localhost')).toEqual(expect.objectContaining({ kind: 'search', query: 'localhost' }));
  });
});

describe('isAllowedNavigateUrl', () => {
  it('allows only http(s)', () => {
    expect(isAllowedNavigateUrl('https://example.com')).toBe(true);
    expect(isAllowedNavigateUrl('http://example.com')).toBe(true);
    expect(isAllowedNavigateUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedNavigateUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedNavigateUrl('not a url')).toBe(false);
  });
});

describe('buildExtractionScript', () => {
  it('returns a self-invoking script bounded in size', () => {
    const script = buildExtractionScript();
    expect(script.startsWith('(function ()')).toBe(true);
    expect(script).toContain('20000');
    expect(script).toContain('linkCount');
  });
});

describe('buildActionScript', () => {
  it('embeds selectors as JSON literals so they cannot break the script', () => {
    const evil = 'a[href="x"]}, 1); steal(); (function(){';
    const script = buildActionScript({ type: 'click', selector: evil });
    expect(script).toContain(JSON.stringify(evil));
    expect(script.startsWith('(function ()')).toBe(true);
  });

  it('builds native-setter value injection and bounded scrolling', () => {
    const set = buildActionScript({ type: 'set', selector: '#q', value: 'hello "world"' });
    expect(set).toContain('native setter');
    expect(set).toContain('"hello \\"world\\""');
    const scroll = buildActionScript({ type: 'scroll', deltaY: 600.7 });
    expect(scroll).toContain('600');
    expect(scroll).not.toContain('600.7');
  });

  it('returns a safe script for unknown actions', () => {
    const script = buildActionScript({ type: 'unknown' as never });
    expect(script).toContain('unknown action');
  });
});

describe('BROWSER_HOME_URL', () => {
  it('is an https URL', () => {
    expect(isAllowedNavigateUrl(BROWSER_HOME_URL)).toBe(true);
  });
});
