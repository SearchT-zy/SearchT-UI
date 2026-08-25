import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import i18nConfig from '@/common/config/i18n-config.json';

const rendererRoot = path.resolve(process.cwd(), 'packages/desktop/src/renderer');

describe('SearchT-UI renderer brand surface', () => {
  it('uses SearchT-UI in static application metadata', () => {
    const html = fs.readFileSync(path.join(rendererRoot, 'index.html'), 'utf8');

    expect(html).toContain('<meta name="application-name" content="SearchT-UI" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="SearchT-UI" />');
    expect(html).toContain('<title>SearchT-UI</title>');
  });

  it('uses SearchT-UI on the login surface in every supported language', () => {
    for (const locale of i18nConfig.supportedLanguages) {
      const resourcePath = path.join(rendererRoot, 'services/i18n/locales', locale, 'login.json');
      const resource = JSON.parse(fs.readFileSync(resourcePath, 'utf8')) as { brand: string; pageTitle: string };

      expect(resource.brand, locale).toBe('SearchT-UI');
      expect(resource.pageTitle, locale).toContain('SearchT-UI');
      expect(resource.pageTitle, locale).not.toContain('AionUi');
    }
  });

  it('uses the shared SearchT-UI name in the desktop sidebar', () => {
    const layout = fs.readFileSync(path.join(rendererRoot, 'components/layout/Layout.tsx'), 'utf8');
    const titlebar = fs.readFileSync(path.join(rendererRoot, 'components/layout/Titlebar/index.tsx'), 'utf8');

    expect(layout).toContain('SEARCHT_DISPLAY_NAME');
    expect(layout).not.toMatch(/>\s*SearchT-UI\s*</);
    expect(titlebar).toContain('SEARCHT_DISPLAY_NAME');
    expect(titlebar).not.toContain("useMemo(() => 'AionUi'");
  });
});
