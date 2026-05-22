// Single-purpose driver: confirm the dashboard Upload button opens the file
// picker, and that selecting a real PDF lands the user in the viewer.
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

const users = JSON.parse(readFileSync(join(LOGS, 'area-02-users.json'), 'utf8'));
const PRO = users.users.find((u) => u.role === 'pro');
const PASSWORD = users.password;
const BASE = 'http://127.0.0.1:5459';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(
  ({ email, password }) => {
    try { window.localStorage.setItem('__fix20AuthOverride', JSON.stringify({ email, password })); } catch {}
  },
  { email: PRO.email, password: PASSWORD }
);
const page = await ctx.newPage();

const verdict = { steps: [] };

await page.goto(BASE);
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(4000);
verdict.steps.push({ step: 'dashboard-loaded', url: page.url() });

// Locate the upload button
const btn = page.locator('button.btn.primary', { hasText: 'Upload' }).first();
await btn.waitFor({ state: 'visible', timeout: 5000 });

// Subscribe to filechooser BEFORE click
const chooserP = page.waitForEvent('filechooser', { timeout: 10000 });
await btn.click();
const chooser = await chooserP.catch((e) => ({ error: e.message }));
if (chooser?.error) {
  verdict.steps.push({ step: 'upload-click', filechooser: false, error: chooser.error });
} else {
  verdict.steps.push({ step: 'upload-click', filechooser: true });
  await chooser.setFiles(join(ARTS, 'normal-test.pdf'));
  await page.waitForTimeout(20000);
  await page.screenshot({ path: join(SHOTS, 'upload-01-after-pdf-open.png'), fullPage: false });
  verdict.steps.push({ step: 'after-pdf-set', url: page.url() });
}

// Corrupted PDF
page.on('dialog', async (d) => {
  verdict.steps.push({ step: 'alert', text: d.message() });
  await d.dismiss().catch(() => {});
});
await page.goto(BASE);
await page.waitForTimeout(4000);
const btn2 = page.locator('button.btn.primary', { hasText: 'Upload' }).first();
await btn2.waitFor({ state: 'visible', timeout: 5000 });
const chooser2P = page.waitForEvent('filechooser', { timeout: 10000 });
await btn2.click();
const chooser2 = await chooser2P.catch((e) => ({ error: e.message }));
if (chooser2?.error) {
  verdict.steps.push({ step: 'corrupted-upload-click', filechooser: false, error: chooser2.error });
} else {
  await chooser2.setFiles(join(ARTS, 'corrupted.pdf'));
  await page.waitForTimeout(12000);
  await page.screenshot({ path: join(SHOTS, 'upload-02-corrupted-result.png'), fullPage: false });
  const text = await page.evaluate(() => document.body.innerText.slice(0, 3000));
  verdict.corrupted_text_snip = text.slice(0, 1500);
  verdict.corrupted_keywords = {
    failed: /failed/i.test(text),
    invalid: /invalid/i.test(text),
    corrupt: /corrupt/i.test(text),
    cannot: /cannot|can't/i.test(text),
    error: /error/i.test(text)
  };
}

await browser.close();
writeFileSync(join(LOGS, 'playwright-upload.json'), JSON.stringify(verdict, null, 2));
console.log(JSON.stringify(verdict, null, 2));
