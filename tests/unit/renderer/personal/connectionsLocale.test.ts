import zhCNPersonal from '@/renderer/services/i18n/locales/zh-CN/personal.json';
import zhTWPersonal from '@/renderer/services/i18n/locales/zh-TW/personal.json';
import { describe, expect, it } from 'vitest';

describe('Connections localized copy', () => {
  it.each([
    ['zh-CN', zhCNPersonal, '连接邮箱', '邮箱', '授权码'],
    ['zh-TW', zhTWPersonal, '連接信箱', '信箱', '授權碼'],
  ])('ships readable email connector copy for %s', (_locale, resource, addEmail, email, authorizationCode) => {
    expect(resource.connectors.addEmail).toBe(addEmail);
    expect(resource.connectors.email.sectionTitle).toBe(email);
    expect(resource.connectors.email.authorizationCodeLabel).toBe(authorizationCode);
    expect(JSON.stringify(resource.connectors)).not.toMatch(/\?{2,}/);
  });

  it.each([
    ['zh-CN', zhCNPersonal, '连接网盘', '网盘', '应用密码'],
    ['zh-TW', zhTWPersonal, '連接網路硬碟', '網路硬碟', '應用程式密碼'],
  ])('ships readable WebDAV connector copy for %s', (_locale, resource, addWebDav, section, password) => {
    expect(resource.connectors.addWebDav).toBe(addWebDav);
    expect(resource.connectors.webdav.sectionTitle).toBe(section);
    expect(resource.connectors.webdav.passwordLabel).toBe(password);
    expect(JSON.stringify(resource.connectors.webdav)).not.toMatch(/\?{2,}/);
  });
});
