const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');

async function main() {
  try { execSync('taskkill /IM SearchT-UI.exe /F', { stdio: 'ignore' }); } catch {}
  await new Promise((r) => setTimeout(r, 3000));

  const child = spawn('D:/SearchT-UI/SearchT-UI.exe', ['--remote-debugging-port=9222'], { detached: true, stdio: 'ignore' });
  child.unref();
  console.log('waiting for app + CDP...');
  await new Promise((r) => setTimeout(r, 15000));

  const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = b.contexts()[0].pages().find((p) => p.url().includes('index.html'));
  await page.waitForTimeout(5000);

  // Navigate to today page
  await page.evaluate(() => { window.location.hash = '#/today'; });
  await page.waitForTimeout(5000);

  const state = await page.evaluate(() => {
    const main = document.querySelector('.layout-content, main');
    const spinners = document.querySelectorAll('.arco-spin');
    const skeletons = document.querySelectorAll('.arco-skeleton');
    const empty = document.querySelectorAll('.arco-empty');
    const errors = document.querySelectorAll('[role="alert"], .error');
    const text = main?.innerText?.slice(0, 300) || '';

    // Check if personal core is initialized
    const allText = document.body.innerText.slice(0, 500);

    return {
      hash: location.hash,
      spinnerCount: spinners.length,
      skeletonCount: skeletons.length,
      emptyCount: empty.length,
      errorCount: errors.length,
      mainText: text.substring(0, 200),
      hasToday: allText.includes('今日') || allText.includes('Today'),
      hasLoading: allText.includes('加载') || allText.includes('loading') || allText.includes('Loading'),
    };
  });
  console.log('today page:', JSON.stringify(state, null, 2));

  // Check personal core health via the app's IPC
  const health = await page.evaluate(async () => {
    try {
      // Try to see if there are any pending API calls or errors
      const perfEntries = performance.getEntriesByType('measure');
      return {
        perfMeasures: perfEntries.length,
        // Check if there's an error boundary
        errorBoundary: document.querySelector('[data-testid="error-boundary"]') !== null,
      };
    } catch { return { error: 'eval failed' }; }
  });
  console.log('health:', JSON.stringify(health));

  await page.screenshot({ path: 'output/ui-e2e/today-loading-check.png' });

  // Wait longer to see if it resolves
  await page.waitForTimeout(15000);
  const stateAfter = await page.evaluate(() => ({
    spinnerCount: document.querySelectorAll('.arco-spin').length,
    text: document.querySelector('.layout-content, main')?.innerText?.slice(0, 150) || '',
  }));
  console.log('after 15s:', JSON.stringify(stateAfter));

  await page.screenshot({ path: 'output/ui-e2e/today-after-wait.png' });
  await b.close();
}

main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
