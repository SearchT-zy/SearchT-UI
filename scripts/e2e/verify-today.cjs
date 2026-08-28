const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');

async function main() {
  try { execSync('taskkill /IM SearchT.exe /F', { stdio: 'ignore' }); } catch {}
  await new Promise((r) => setTimeout(r, 3000));

  const child = spawn('D:/SearchT/SearchT.exe', ['--remote-debugging-port=9222'], { detached: true, stdio: 'ignore' });
  child.unref();
  await new Promise((r) => setTimeout(r, 20000));

  const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = b.contexts()[0].pages().find((p) => p.url().includes('index.html'));
  await page.evaluate(() => { window.location.hash = '#/today'; });
  await new Promise((r) => setTimeout(r, 8000));

  const state = await page.evaluate(() => {
    const skeletons = document.querySelectorAll('.arco-skeleton');
    const emptyStates = document.querySelectorAll('.arco-empty');
    const mains = document.querySelectorAll('main');
    const contentMain = mains[mains.length - 1];
    return {
      skeletonCount: skeletons.length,
      emptyCount: emptyStates.length,
      hasFocusEmpty: Array.from(emptyStates).some((e) => e.textContent?.includes('当前没有需要重点关注')),
      mainText: contentMain?.innerText?.slice(0, 300) || '',
    };
  });
  console.log('today after fix:', JSON.stringify(state, null, 2));
  await page.screenshot({ path: 'output/ui-e2e/today-fixed.png' });
  await b.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
