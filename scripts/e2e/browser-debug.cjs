/**
 * Debug embedded browser: connect to the running app, navigate to a page,
 * try clicking inside the webview, and capture what happens.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

async function main() {
  // Launch the app with CDP
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
  await page.waitForTimeout(8000); // wait for full init

  // Navigate to browser page
  await page.evaluate(() => {
    window.location.hash = '#/browser';
  });
  await page.waitForTimeout(3000);
  console.log('url:', page.url());

  // Check webview element exists and its attributes
  const webviewInfo = await page.evaluate(() => {
    const wv = document.querySelector('[data-testid="browser-webview"]');
    if (!wv) return { exists: false };
    return {
      exists: true,
      tagName: wv.tagName,
      src: wv.getAttribute('src'),
      partition: wv.getAttribute('partition'),
      allowpopups: wv.getAttribute('allowpopups'),
      className: wv.className,
      // Check if webview has loaded
      getURL: typeof wv.getURL === 'function' ? wv.getURL() : 'no-method',
      canGoBack: typeof wv.canGoBack === 'function' ? wv.canGoBack() : 'no-method',
      isLoading: typeof wv.isLoading === 'function' ? wv.isLoading() : 'no-method',
    };
  });
  console.log('webview:', JSON.stringify(webviewInfo, null, 2));

  // Check CDP targets - does the webview content appear as a separate target?
  const targets = await browser.contexts().flatMap((c) => c.pages());
  console.log(
    'CDP targets:',
    targets.map((t) => t.url().slice(0, 80))
  );

  // Navigate to example.com
  const address = page.getByTestId('browser-address');
  if (await address.isVisible().catch(() => false)) {
    await address.fill('https://example.com');
    await address.press('Enter');
    await page.waitForTimeout(8000);
    const afterNav = await page.evaluate(() => {
      const wv = document.querySelector('[data-testid="browser-webview"]');
      return {
        addressValue: document.querySelector('[data-testid="browser-address"]')?.value,
        webviewURL: wv?.getURL?.() ?? 'N/A',
        webviewTitle: wv?.getTitle?.() ?? 'N/A',
      };
    });
    console.log('after nav:', JSON.stringify(afterNav, null, 2));
  } else {
    console.log('address bar not visible!');
  }

  // Check if webview content is a separate CDP page we can inspect
  const targetsAfter = await browser.contexts().flatMap((c) => c.pages());
  console.log(
    'targets after nav:',
    targetsAfter.map((t) => t.url().slice(0, 80))
  );

  // Try clicking on a link inside the webview by dispatching events through the host page
  // First check if the webview content is reachable
  const webviewPage = targetsAfter.find((t) => t.url().includes('example.com'));
  if (webviewPage) {
    console.log('webview content IS a CDP target:', webviewPage.url());
    // Try clicking a link
    const link = await webviewPage.locator('a').first();
    if (link) {
      console.log('link href:', await link.getAttribute('href'));
      console.log('link text:', await link.textContent());
    }
  } else {
    console.log('webview content NOT found as CDP target');
  }

  await page.screenshot({ path: path.resolve('output/ui-e2e/debug-webview.png') });
  await browser.close();
}

main().catch((e) => {
  console.error('crashed:', e.message.split('\n')[0]);
  process.exit(1);
});
