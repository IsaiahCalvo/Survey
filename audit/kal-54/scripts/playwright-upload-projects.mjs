// Test the Projects-tab Upload (which has its own local file input).
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SHOTS = join(ROOT, 'screenshots');
const ARTS = join(ROOT, 'artifacts');
const LOGS = join(ROOT, 'logs');

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

const verdict = {};
await page.goto(BASE);
await page.waitForTimeout(6000);

// Switch to projects tab
const projTab = page.locator('nav.nav button', { hasText: 'Projects' });
if (await projTab.isVisible({ timeout: 3000 }).catch(() => false)) {
  await projTab.click();
  await page.waitForTimeout(3000);
}
await page.screenshot({ path: join(SHOTS, 'projects-01-tab.png') });

// Look for an upload-related button
const info = await page.evaluate(() => {
  const buttons = [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /upload|add.*file|new/i.test(t));
  const fileInputs = [...document.querySelectorAll('input[type="file"]')].length;
  return { buttons, fileInputs };
});
verdict.projects_tab_info = info;

writeFileSync(join(LOGS, 'playwright-projects.json'), JSON.stringify(verdict, null, 2));
console.log(JSON.stringify(verdict, null, 2));

await browser.close();
