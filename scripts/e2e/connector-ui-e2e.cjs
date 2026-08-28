/**
 * End-to-end connector + cloud-sync flows in the real installed app UI,
 * driven over CDP against local HTTPS mock servers.
 *
 *   node scripts/e2e/connector-ui-e2e.cjs
 */

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const results = [];
const report = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function main() {
  const child = spawn('D:/searcht/SearchT.exe', ['--remote-debugging-port=9222'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
  });
  child.unref();

  let browser = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
      break;
    } catch {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (!browser) throw new Error('CDP connect failed');
  let page = null;
  for (let attempt = 0; attempt < 20 && !page; attempt += 1) {
    for (const context of browser.contexts()) {
      page = context.pages().find((p) => p.url().includes('index.html')) ?? null;
      if (page) break;
    }
    if (!page) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (!page) throw new Error('renderer page not found over CDP');
  await page.waitForTimeout(5000);

  const shotDir = path.resolve('output/ui-e2e');
  const shot = (name) => page.screenshot({ path: path.join(shotDir, `${name}.png`) });
  const goto = async (hash) => {
    await page.evaluate((target) => {
      window.location.hash = target;
    }, hash);
    await page.waitForTimeout(2000);
  };
  const closeModal = async () => {
    for (let i = 0; i < 2; i += 1) {
      await page.keyboard.press('Escape');
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  };

  // --- WebDAV connector ---------------------------------------------------------
  try {
    await goto('#/settings/connections');
    await closeModal();
    await page
      .getByRole('button', { name: /连接网盘/ })
      .first()
      .click();
    await page.waitForTimeout(900);
    await page.getByText('自定义 WebDAV').first().click();
    await page.waitForTimeout(600);
    await page.getByLabel('HTTPS 服务器地址').fill('https://127.0.0.1:8443/dav');
    await page.getByLabel('账号或用户名').fill('user');
    await page.getByLabel('应用密码').fill('pass');
    await page.getByLabel('目录路径').fill('/');
    await page.getByText('导入当前已有文件').first().click();
    await shot('22-webdav-dialog');
    await page.getByRole('button', { name: /^测试连接$/ }).click();
    await page.waitForTimeout(3500);
    await shot('23-webdav-tested');
    const tested = await page
      .getByText('连接成功')
      .first()
      .isVisible()
      .catch(() => false);
    report('WebDAV 测试连接 against mock', tested);
    await page.getByRole('button', { name: /^连接$/ }).click();
    await page.waitForTimeout(5000);
    await shot('24-webdav-connected');
    await goto('#/inbox');
    await page.waitForTimeout(2500);
    const imported = await page
      .getByText(/e2e-note/)
      .first()
      .isVisible()
      .catch(() => false);
    report('WebDAV connector imports file into inbox via UI', imported);
    await shot('25-webdav-inbox-import');
    await closeModal();
  } catch (error) {
    report('WebDAV connector flow', false, error.message.split('\n')[0]);
  }

  // --- S3 connector ---------------------------------------------------------------
  try {
    await goto('#/settings/connections');
    await closeModal();
    await page
      .getByRole('button', { name: /连接对象存储/ })
      .first()
      .click();
    await page.waitForTimeout(900);
    await page.getByLabel('HTTPS endpoint').fill('https://127.0.0.1:8443');
    await page.getByLabel('Region').fill('us-east-1');
    await page.getByLabel('Bucket').fill('e2e-bucket');
    await page.getByLabel('Access Key ID').fill('e2e-access-key');
    await page.getByLabel('Secret Access Key').fill('e2e-secret-key');
    await shot('26-s3-dialog-filled');
    await page.getByRole('button', { name: /^测试连接$/ }).click();
    await page.waitForTimeout(3500);
    await shot('27-s3-tested');
    const tested = await page
      .getByText('连接成功')
      .first()
      .isVisible()
      .catch(() => false);
    report('S3 测试连接 against mock', tested);
    await page.getByRole('button', { name: /^连接$/ }).click();
    await page.waitForTimeout(5000);
    await goto('#/inbox');
    await page.waitForTimeout(2500);
    const imported = await page
      .getByText(/e2e-bucket-file/)
      .first()
      .isVisible()
      .catch(() => false);
    report('S3 connector imports object into inbox via UI', imported);
    await shot('28-s3-inbox-import');
    await closeModal();
  } catch (error) {
    report('S3 connector flow', false, error.message.split('\n')[0]);
  }

  // --- cloud sync ------------------------------------------------------------------
  try {
    await goto('#/settings/personal-workspace');
    await page
      .getByText(/云同步/)
      .first()
      .waitFor({ timeout: 6000 });
    const syncButton = page.getByRole('button', { name: /立即同步/ }).first();
    const configured = await syncButton.isVisible().catch(() => false);
    if (configured) {
      await syncButton.click();
      await page.waitForTimeout(6000);
    } else {
      await page.locator('input[aria-label="HTTPS 服务器地址"]').fill('https://127.0.0.1:8443/sync');
      await page.locator('input[aria-label="用户名"]').fill('user');
      await page.locator('input[aria-label="应用密码"]').fill('pass');
      await page.locator('input[aria-label="同步口令（至少 8 位）"]').fill('local-e2e-passphrase');
      await page.getByRole('button', { name: /开启云同步/ }).click();
      await page.waitForTimeout(2500);
      await page
        .getByRole('button', { name: /立即同步/ })
        .first()
        .click();
      await page.waitForTimeout(6000);
    }
    await shot('29-cloudsync-synced');
    report('cloud sync triggered via UI', true);
  } catch (error) {
    report('cloud sync flow', false, error.message.split('\n')[0]);
  }

  // Verify the mock remote received encrypted artifacts.
  try {
    const found = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === 'manifest.zxsync' || entry.name === 'keyfile.json' || entry.name.endsWith('.zxsync')) {
          found.push(full);
        }
      }
    };
    walk(path.resolve('mock-remote-storage'));
    const manifest = found.find((f) => f.endsWith('manifest.zxsync'));
    const bundleFile = found.find((f) => path.basename(f).startsWith('data-'));
    const keyfile = found.find((f) => f.endsWith('keyfile.json'));
    let encrypted = false;
    let nonEmpty = false;
    if (manifest && bundleFile) {
      const magic = fs.readFileSync(manifest).subarray(0, 7).toString('utf8');
      nonEmpty = fs.statSync(bundleFile).size > 100;
      encrypted = magic === 'ZXSYNC1';
    }
    report(
      'remote holds encrypted non-empty sync artifacts',
      Boolean(manifest && keyfile && encrypted && nonEmpty),
      `manifest=${Boolean(manifest)} keyfile=${Boolean(keyfile)} magic=${encrypted} bundleBytes=${nonEmpty}`
    );
  } catch (error) {
    report('remote holds encrypted sync artifacts', false, error.message.split('\n')[0]);
  }

  await browser.close();
  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n[connector-ui-e2e] ${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('[connector-ui-e2e] crashed:', error);
  process.exit(1);
});
