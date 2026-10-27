// Walks company sign-in in the real app against the local stack set up by
// setup-local-saml.sh: an unknown company gets the "not set up" message, then
// jane@example.com goes through the fake company login and lands signed in.
// Needs `npx vite --mode e2e --port 5199` running. Screenshots go to argv[2].
const fs = require('node:fs');
const { chromium } = require('playwright');
const OUT = process.argv[2] || '.';
const LOCAL = new Set(['127.0.0.1', 'localhost']);

(async () => {
  // The repo pins its own Playwright; the cloud container's browser lives here.
  const executablePath = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const browser = await chromium.launch({ executablePath });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.context().route((u) => !['data:', 'blob:'].includes(u.protocol) && !LOCAL.has(u.hostname), (r) => r.abort('blockedbyclient'));
  await page.goto('http://127.0.0.1:5199/', { waitUntil: 'domcontentloaded' });
  const dialog = page.getByRole('dialog', { name: 'Welcome back' });
  await dialog.waitFor({ timeout: 90000 });
  await dialog.getByRole('button', { name: /company SSO/ }).click();
  const field = page.getByLabel('Work email or company domain');

  await field.fill('jane@unknown-corp.com');
  await page.getByRole('button', { name: 'Continue with SSO' }).click();
  await page.getByText(/isn't set up for unknown-corp\.com yet/).waitFor({ timeout: 15000 });
  await page.screenshot({ path: `${OUT}/sso-not-set-up.png` });
  console.log('unknown company: plain "not set up" message');

  await field.fill('jane@example.com');
  await page.getByRole('button', { name: 'Continue with SSO' }).click();
  await page.waitForURL(/localhost:4000/, { timeout: 20000 });
  await page.locator('#username').fill('jane');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL(/127\.0\.0\.1:5199/, { timeout: 30000 });

  const tokenKey = /^sb-.*-auth-token$/;
  await page.waitForFunction((src) => Object.keys(localStorage).some((k) => new RegExp(src).test(k)), tokenKey.source, { timeout: 30000 });
  const session = await page.evaluate((src) => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => new RegExp(src).test(k)))), tokenKey.source);
  const claims = JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString());
  if (claims.amr?.[0]?.method !== 'sso/saml') throw new Error(`expected an sso/saml session, got ${JSON.stringify(claims.amr)}`);
  const chip = page.getByRole('button', { name: 'Open account menu' }).filter({ visible: true }).first();
  await chip.waitFor({ timeout: 60000 });
  await page.screenshot({ path: `${OUT}/sso-signed-in.png` });
  console.log('signed in as', session.user.email, 'via', claims.amr[0].method, '| chip:', (await chip.innerText()).replace(/\s+/g, ' '));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
