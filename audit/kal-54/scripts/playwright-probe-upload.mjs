// Probe: what does the Upload button actually do? Look at the DOM around it,
// and inspect whether the file input ref ever fires .click().
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LOGS = join(ROOT, 'logs');
const SHOTS = join(ROOT, 'screenshots');

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
await page.goto(BASE);
await page.waitForTimeout(7000);

// Find the button, inspect handler text
const info = await page.evaluate(() => {
  const allButtons = [...document.querySelectorAll('button')];
  const matches = allButtons
    .filter((b) => /Upload/i.test(b.textContent))
    .map((b) => ({
      text: b.textContent.trim(),
      className: b.className,
      visible: !!(b.offsetWidth || b.offsetHeight),
      rect: b.getBoundingClientRect().toJSON()
    }));
  const inputs = [...document.querySelectorAll('input[type="file"]')].map((i) => ({
    accept: i.accept,
    style: i.getAttribute('style'),
    multiple: i.multiple,
    inDOM: true,
    hidden: i.offsetParent === null
  }));
  return { matches, fileInputs: inputs };
});

// Click & capture document events to see what fires
await page.evaluate(() => {
  window.__capturedClickEvents = [];
  // Patch HTMLInputElement.prototype.click so we know if anyone calls it
  const origClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function (...args) {
    window.__capturedClickEvents.push({ tag: this.tagName, type: this.type, accept: this.accept });
    return origClick.apply(this, args);
  };
});

await page.locator('button.btn.primary', { hasText: 'Upload' }).first().click();
await page.waitForTimeout(2000);

const captured = await page.evaluate(() => window.__capturedClickEvents);

await page.screenshot({ path: join(SHOTS, 'probe-upload-after-click.png'), fullPage: false });

const result = { info, captured };
writeFileSync(join(LOGS, 'playwright-probe-upload.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

await browser.close();
