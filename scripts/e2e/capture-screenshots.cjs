/**
 * Capture real app screenshots for the repository README.
 *
 * Usage: node scripts/e2e/capture-screenshots.cjs [appRoot]
 *   appRoot defaults to out/win-unpacked (dev build).
 * Requires the app to be running with --remote-debugging-port=9222.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const appRoot = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'out', 'win-unpacked'));
const indexUrl = 'file:///' + path.join(appRoot, 'resources', 'app.asar', 'out', 'renderer', 'index.html').replace(/\\/g, '/');
const outDir = path.join(__dirname, '..', '..', 'docs', 'screenshots');

const PAGES = [
  { name: 'today', hash: '#/today', wait: 3000 },
  { name: 'tasks', hash: '#/tasks', wait: 2500 },
  { name: 'calendar', hash: '#/calendar', wait: 2500 },
  { name: 'knowledge', hash: '#/knowledge', wait: 3000 },
  { name: 'inbox', hash: '#/inbox', wait: 2500 },
  { name: 'settings-connections', hash: '#/settings/connections', wait: 3000 },
  { name: 'settings-workspace', hash: '#/settings/personal-workspace', wait: 3000 },
];

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes('renderer/index.html')) || ctx.pages()[0];

  for (const { name, hash, wait } of PAGES) {
    await page.goto('about:blank');
    await page.goto(indexUrl + hash);
    await page.waitForTimeout(wait);
    await page.screenshot({ path: path.join(outDir, name + '.png') });
    console.log('captured:', name);
  }

  // Browser page: navigate the embedded webview, run content recognition.
  await page.goto('about:blank');
  await page.goto(indexUrl + '#/browser');
  await page.waitForTimeout(3000);
  console.log('browser url:', page.url().slice(-20));
  const addressBar = page.locator('input').first();
  await addressBar.fill('https://example.com');
  await addressBar.press('Enter');
  await page.waitForTimeout(7000);
  await page.getByText('读取页面内容', { exact: true }).click().catch(() => {});
  await page.waitForTimeout(3500);
  await page.screenshot({ path: path.join(outDir, 'browser.png') });
  console.log('captured: browser');

  await browser.close();
}

main().catch((error) => {
  console.error('capture failed:', error.message);
  process.exit(1);
});
