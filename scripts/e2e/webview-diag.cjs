const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const path = require('path');

async function main() {
  try {
    execSync('taskkill /IM SearchT-UI.exe /F', { stdio: 'ignore' });
  } catch {}
  await new Promise((r) => setTimeout(r, 3000));

  const child = spawn('D:/SearchT-UI/SearchT-UI.exe', ['--remote-debugging-port=9222'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  await new Promise((r) => setTimeout(r, 15000));

  const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = b
    .contexts()[0]
    .pages()
    .find((p) => p.url().includes('index.html'));
  await page.evaluate(() => {
    window.location.hash = '#/browser';
  });
  await new Promise((r) => setTimeout(r, 3000));

  const addr = page.getByTestId('browser-address');
  await addr.fill('https://example.com');
  await addr.press('Enter');
  await new Promise((r) => setTimeout(r, 10000));

  const diag = await page.evaluate(() => {
    const wv = document.querySelector('[data-testid="browser-webview"]');
    if (!wv) return { error: 'no webview' };
    const rect = wv.getBoundingClientRect();

    const chain = [];
    let el = wv;
    while (el && el !== document.body) {
      const s = getComputedStyle(el);
      chain.push({
        tag: el.tagName,
        cls: (el.className || '').toString().slice(0, 50),
        pe: s.pointerEvents,
        pos: s.position,
        z: s.zIndex,
      });
      el = el.parentElement;
    }

    const overlays = [];
    for (let i = 0; i < 20; i++) {
      const px = rect.left + (rect.width * (i % 5)) / 4 + 10;
      const py = rect.top + (rect.height * Math.floor(i / 5)) / 3 + 10;
      const e = document.elementFromPoint(px, py);
      if (e && e !== wv) {
        overlays.push({
          at: [Math.round(px), Math.round(py)],
          tag: e.tagName,
          cls: (e.className || '').toString().slice(0, 30),
        });
      }
    }

    return {
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      style: {
        pe: getComputedStyle(wv).pointerEvents,
        display: getComputedStyle(wv).display,
        pos: getComputedStyle(wv).position,
        z: getComputedStyle(wv).zIndex,
      },
      guest: {
        url: wv.getURL ? wv.getURL() : 'N/A',
        crashed: wv.isCrashed ? wv.isCrashed() : 'N/A',
        loading: wv.isLoading ? wv.isLoading() : 'N/A',
      },
      chain,
      overlays: overlays.slice(0, 3),
      overlayCount: overlays.length,
    };
  });
  console.log(JSON.stringify(diag, null, 2));

  // Also try: simulate a real mouse click through Playwright on the HOST page
  // at the webview's center - this tests native input forwarding
  const wvBox = await page.getByTestId('browser-webview').boundingBox();
  if (wvBox) {
    console.log('\n--- Testing native mouse click on host at webview center ---');
    const cx = wvBox.x + wvBox.width / 2;
    const cy = wvBox.y + wvBox.height / 2;
    console.log('clicking at:', cx, cy);

    // Check if the webview content responds after host-level click
    await page.mouse.click(cx, cy);
    await new Promise((r) => setTimeout(r, 2000));

    // Find the webview content target and check if it received the click
    const targets = b.contexts().flatMap((c) => c.pages());
    const webviewContent = targets.find((t) => t.url().includes('example.com'));
    if (webviewContent) {
      console.log('webview content target:', webviewContent.url());
      // Check if there's an active element (indicating the guest got focus)
      const active = await webviewContent.evaluate(() => ({
        activeElement: document.activeElement?.tagName,
        hasFocus: document.hasFocus(),
        visibilityState: document.visibilityState,
      }));
      console.log('guest focus state:', JSON.stringify(active));
    } else {
      console.log('webview content NOT accessible as CDP target');
    }
  }

  await page.screenshot({ path: path.resolve('output/ui-e2e/browser-deep-diag.png') });
  await b.close();
}

main().catch((e) => {
  console.error('ERR:', e.message);
  process.exit(1);
});
