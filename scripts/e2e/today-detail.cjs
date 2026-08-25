const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const path = require('path');

async function main() {
  try { execSync('taskkill /IM SearchT-UI.exe /F', { stdio: 'ignore' }); } catch {}
  await new Promise((r) => setTimeout(r, 3000));

  const child = spawn('D:/SearchT-UI/SearchT-UI.exe', ['--remote-debugging-port=9222'], { detached: true, stdio: 'ignore' });
  child.unref();
  await new Promise((r) => setTimeout(r, 20000));

  const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = b.contexts()[0].pages().find((p) => p.url().includes('index.html'));
  await page.waitForTimeout(3000);

  // Go to today
  await page.evaluate(() => { window.location.hash = '#/today'; });
  await new Promise((r) => setTimeout(r, 8000));

  // Get detailed DOM of the main content area (not sidebar)
  const detail = await page.evaluate(() => {
    // Find the actual content area (should be after the sidebar)
    const contentAreas = document.querySelectorAll('.layout-content, main, [class*="content"]');
    const results = [];
    for (const area of contentAreas) {
      const children = area.children;
      results.push({
        tag: area.tagName,
        cls: (area.className || '').toString().slice(0, 50),
        childCount: children.length,
        innerHTML_preview: area.innerHTML.slice(0, 500),
        visibleText: area.innerText?.slice(0, 200) || '',
      });
    }

    // Check specifically for the today page component
    const todayRoot = document.querySelector('[data-testid*="today"], .today-page, [class*="today"]');
    const skeleton = document.querySelector('.arco-skeleton');
    const emptyStates = document.querySelectorAll('.arco-empty');

    return {
      contentAreas: results.slice(0, 3),
      todayRoot: todayRoot ? todayRoot.outerHTML.slice(0, 300) : null,
      skeletonHTML: skeleton ? skeleton.outerHTML.slice(0, 300) : null,
      emptyDescriptions: Array.from(emptyStates).map((e) => e.textContent?.trim().slice(0, 80)),
    };
  });
  console.log('detail:', JSON.stringify(detail, null, 2));

  await page.screenshot({ path: path.resolve('output/ui-e2e/today-detail.png') });

  // Also check other pages to see if they work
  for (const route of ['#/tasks', '#/calendar', '#/inbox']) {
    await page.evaluate((r) => { window.location.hash = r; }, route);
    await new Promise((r) => setTimeout(r, 3000));
    const text = await page.evaluate(() => {
      const main = document.querySelector('.layout-content, main');
      return main?.innerText?.slice(0, 100) || 'EMPTY';
    });
    console.log(`${route}: ${text.replace(/\n/g, ' | ').slice(0, 80)}`);
  }

  await b.close();
}

main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
