import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 945 } });
const page = await ctx.newPage();
const logs = [];
const netfail = [];
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { const t=m.text(); if(/error|warn|hang|watchdog|survey|template|fail/i.test(t)||m.type()==='error') logs.push('[' + m.type() + '] ' + t.slice(0, 300)); });
page.on('requestfailed', (r) => netfail.push('REQFAIL ' + r.failure()?.errorText + ' ' + r.url().slice(0, 110)));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => logs.push('goto: ' + e.message));
await page.waitForTimeout(3000);
await page.getByText('Benjamin Franklin Elementary.pdf').first().click({ timeout: 10000 }).catch((e) => logs.push('click doc: ' + e.message));
await page.waitForTimeout(1500);
await page.getByRole('button', { name: /open file/i }).click({ timeout: 10000 }).catch((e) => logs.push('click open: ' + e.message));
console.log('opened file; watching viewer...');

let last = '';
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(2000);
  const s = await page.evaluate(() => ({
    loading: (document.body.innerText || '').includes('Loading...'),
    canvases: document.querySelectorAll('canvas').length,
    noTemplate: (document.body.innerText || '').includes('No template selected'),
    err: (document.body.innerText || '').match(/could not be opened|too long to load|Try again/i)?.[0] || null,
  }));
  const st = JSON.stringify(s);
  if (st !== last) { console.log(`t=${(i+1)*2}s ${st}`); last = st; }
}
await page.screenshot({ path: 'agent-cli/diag-survey-hang.png' }).catch(() => {});
console.log('--- relevant console (last 30) ---');
for (const e of logs.slice(-30)) console.log(e.slice(0, 240));
console.log('--- net failures (last 12) ---');
for (const e of netfail.slice(-12)) console.log(e);
await browser.close();
