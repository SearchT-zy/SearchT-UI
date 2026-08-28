/**
 * Verify that clicks work inside the embedded browser after the fix.
 * Connects via CDP, navigates to a page with links, and tests that
 * clicking a link actually navigates the webview.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

async function main() {
  const child = spawn('D:/SearchT/SearchT.exe', ['--remote-debugging-port=9222'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  let browser = null;
  for (let i = 0; i < 30 && !browser; i++) {
    try {
      browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (!browser) throw new Error('CDP connect failed');

  let page = null;
  for (let i = 0; i < 20 && !page; i++) {
    for (const c of browser.contexts()) {
      page = c.pages().find((p) => p.url().includes('index.html')) ?? null;
      if (page) break;
    }
    if (!page) await new Promise((r) => setTimeout(r, 1000));
  }
  await page.waitForTimeout(8000);

  // Navigate to browser page
  await page.evaluate(() => {
    window.location.hash = '#/browser';
  });
  await page.waitForTimeout(3000);

  // Load a simple page with clickable links
  const address = page.getByTestId('browser-address');
  await address.fill('https://example.com');
  await address.press('Enter');
  await page.waitForTimeout(10000);

  // Find the webview content target
  const targets = () => browser.contexts().flatMap((c) => c.pages());
  const webviewPage = targets().find((t) => t.url().includes('example.com'));

  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  check('webview loads page', Boolean(webviewPage));
  if (!webviewPage) {
    console.log('ABORT: webview content not accessible');
    process.exit(1);
  }

  // 1. Test programmatic click via Playwright on the webview content
  try {
    await webviewPage.click('a', { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 5000));
    const url = webviewPage.url();
    check('click on link navigates webview', url.includes('iana.org'), url.slice(0, 60));
  } catch (e) {
    check('click on link navigates webview', false, e.message.split('\n')[0]);
  }

  // 2. Navigate back to a search page and test search interaction
  const hostPage = page;
  const addr = hostPage.getByTestId('browser-address');
  await addr.fill('https://www.bing.com');
  await addr.press('Enter');
  await new Promise((r) => setTimeout(r, 10000));

  const bingPage = targets().find((t) => t.url().includes('bing.com'));
  check('bing loads in webview', Boolean(bingPage));

  if (bingPage) {
    // Test that input fields are interactive
    try {
      const searchBox = bingPage.locator('#sb_form_q, input[name="q"]').first();
      await searchBox.click({ timeout: 5000 });
      await searchBox.type('SearchT test', { timeout: 5000 });
      const value = await searchBox.inputValue();
      check('input field accepts typing', value === 'SearchT test', value);
    } catch (e) {
      check('input field accepts typing', false, e.message.split('\n')[0]);
    }

    // Test clicking the search button
    try {
      const searchBtn = bingPage.locator('#sb_form_go, input[type="submit"]').first();
      await searchBtn.click({ timeout: 5000 });
      await new Promise((r) => setTimeout(r, 5000));
      const url = bingPage.url();
      check('search button click works', url.includes('search'), url.slice(0, 60));
    } catch (e) {
      check('search button click works', false, e.message.split('\n')[0]);
    }
  }

  // 3. Test host page focus forwarding (click on webview container)
  try {
    const wv = hostPage.getByTestId('browser-webview');
    const box = await wv.boundingBox();
    if (box) {
      await hostPage.mouse.click(box.x + box.width / 2, box.y + 50);
      await new Promise((r) => setTimeout(r, 2000));
      check("container click doesn't crash", true);
    }
  } catch (e) {
    check("container click doesn't crash", false, e.message.split('\n')[0]);
  }

  await hostPage.screenshot({ path: path.resolve('output/ui-e2e/browser-click-fix.png') });
  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n[browser-click-test] ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error('crashed:', e.message);
  process.exit(1);
});
