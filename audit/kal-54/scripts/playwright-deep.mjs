// Deeper UI driver:
//  - capture all network requests so we can pinpoint the 400 errors
//  - drive the upload click and watch for filechooser via a network sniff
//  - exercise the corrupted PDF path
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SHOTS = join(ROOT, 'screenshots');
const ARTS = join(ROOT, 'artifacts');
const LOGS = join(ROOT, 'logs');
mkdirSync(SHOTS, { recursive: true });

const usersJson = JSON.parse(readFileSync(join(LOGS, 'area-02-users.json'), 'utf8'));
const PASSWORD = usersJson.password;
const usersByRole = Object.fromEntries(usersJson.users.map((u) => [u.role, u]));
const PRO = usersByRole.pro;

const BASE = 'http://127.0.0.1:5459';

async function newContextAs(browser, role) {
  const user = usersByRole[role];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(
    ({ email, password }) => {
      try { window.localStorage.setItem('__fix20AuthOverride', JSON.stringify({ email, password })); } catch {}
    },
    { email: user.email, password: PASSWORD }
  );
  return ctx;
}

const verdict = {};
const browser = await chromium.launch({ headless: true });
const ctx = await newContextAs(browser, 'pro');
const page = await ctx.newPage();

const networkLog = [];
page.on('response', async (resp) => {
  const url = resp.url();
  const status = resp.status();
  if (status >= 400) {
    let bodySnip = '';
    try { bodySnip = (await resp.text()).slice(0, 600); } catch {}
    networkLog.push({ url, status, bodySnip });
  }
});
const consoleLog = [];
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error' || t === 'warning') {
    consoleLog.push({ t, text: m.text().slice(0, 400) });
  }
});

await page.goto(BASE);
await page.waitForTimeout(7000);
await page.screenshot({ path: join(SHOTS, 'deep-01-dashboard.png') });

// 1. Click the Upload button using the actual class name
const upload = page.locator('button.btn.primary', { hasText: 'Upload' }).first();
verdict.upload_visible = await upload.isVisible({ timeout: 5000 }).catch(() => false);

if (verdict.upload_visible) {
  const chooserP = page.waitForEvent('filechooser', { timeout: 6000 }).catch(() => null);
  await upload.click();
  const chooser = await chooserP;
  verdict.upload_picker_opened = !!chooser;
  if (chooser) {
    await chooser.setFiles(join(ARTS, 'normal-test.pdf'));
    await page.waitForTimeout(15000);
    await page.screenshot({ path: join(SHOTS, 'deep-02-after-upload.png') });
    verdict.url_after_upload = page.url();
  }
}

// 2. Corrupted PDF — go back to home + try corrupted
await page.goto(BASE);
await page.waitForTimeout(4000);
page.on('dialog', async (d) => { verdict.alert_text = d.message(); await d.dismiss().catch(() => {}); });
const upload2 = page.locator('button.btn.primary', { hasText: 'Upload' }).first();
if (await upload2.isVisible({ timeout: 5000 }).catch(() => false)) {
  const chooserP = page.waitForEvent('filechooser', { timeout: 6000 }).catch(() => null);
  await upload2.click();
  const chooser = await chooserP;
  if (chooser) {
    await chooser.setFiles(join(ARTS, 'corrupted.pdf'));
    await page.waitForTimeout(8000);
    await page.screenshot({ path: join(SHOTS, 'deep-03-corrupted.png') });
    const body = await page.evaluate(() => document.body.innerText);
    verdict.corrupted_body_snip = body.slice(0, 1200);
  }
}

verdict.network_400s = networkLog.slice(0, 30);
verdict.console_errors = consoleLog.filter((c) => c.t === 'error').slice(0, 20);
verdict.console_warnings = consoleLog.filter((c) => c.t === 'warning').slice(0, 10);

await browser.close();
writeFileSync(join(LOGS, 'playwright-deep.json'), JSON.stringify(verdict, null, 2));
console.log(JSON.stringify(verdict, null, 2));
