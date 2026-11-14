// Survey as a Microsoft Teams tab (Drawboard Projects IN-28). Teams opens
// <site>/teams in a frame and shows nothing until the page says it is ready.
// Here a stand-in Teams page (served at teams.microsoft.com by the test, no
// network) frames Survey, answers the Teams library's hello and records what
// the page sends: it must say hello and then "ready", show email sign-in
// without the Google / Microsoft buttons (those sites refuse to open in a
// frame), and work once signed in. The same address outside a frame never
// loads the Teams library.
import fs from 'node:fs';
import { E2E_ACCOUNTS, E2E_BASE_URL } from './accounts.mjs';
import { expect, test } from './helpers.mjs';

const HOST = 'https://teams.microsoft.com/_survey-e2e-host';

// The stand-in is a public https address framing the local dev server on
// 127.0.0.1; Chromium's private-network rules would refuse that frame, which
// the real thing (an https Survey site) never meets.
const localChromium = process.env.PW_CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
test.use({ launchOptions: { ...(localChromium ? { executablePath: localChromium } : {}), args: ['--disable-features=PrivateNetworkAccessForNavigations,PrivateNetworkAccessForIframes,BlockInsecurePrivateNetworkRequests,LocalNetworkAccessChecks'] } });

const hostPage = (src) => `<!doctype html><html><head><meta charset="utf-8"><title>Teams stand-in</title>
<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%}</style></head><body>
<iframe id="tab" src="${src}" allow="clipboard-write"></iframe>
<script>
  window.__teamsCalls = [];
  window.addEventListener('message', (evt) => {
    const frame = document.getElementById('tab').contentWindow;
    if (evt.source !== frame || !evt.data || typeof evt.data.func !== 'string') return;
    const { id, uuid, func } = evt.data;
    window.__teamsCalls.push(func);
    const answer = (args) => frame.postMessage({ id, uuid, args }, '*');
    if (func === 'initialize') answer(['content', 'web', '', '2.0.0']);
    else if (func === 'getContext') answer([{ theme: 'dark', locale: 'en-us', hostClientType: 'web', frameContext: 'content', entityId: 'survey-home' }]);
  });
</script></body></html>`;

test('inside Teams the tab says it is ready and offers email sign-in only', async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.route(`${HOST}**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: hostPage(`${E2E_BASE_URL}/teams`) }));
  await page.goto(HOST);
  const tab = page.frameLocator('#tab');
  const dialog = tab.getByRole('dialog', { name: 'Welcome back' });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.__teamsCalls), { timeout: 30_000 })
    .toEqual(expect.arrayContaining(['initialize', 'appInitialization.success']));
  await expect(dialog.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Continue with Microsoft' })).toHaveCount(0);
  await expect(tab.locator('html')).toHaveAttribute('data-teams-tab', 'dark');

  const account = E2E_ACCOUNTS.owner;
  await dialog.getByLabel('Email').fill(account.email);
  await dialog.getByLabel('Password').fill(account.password);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(tab.getByRole('button', { name: 'Projects', exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 45_000 });
});

test('the same address outside Teams never loads the Teams library', async ({ page }) => {
  const teamsJs = [];
  page.on('request', (req) => { if (/teams-js/i.test(req.url())) teamsJs.push(req.url()); });
  await page.goto('/teams', { waitUntil: 'domcontentloaded' });
  const dialog = page.getByRole('dialog', { name: 'Welcome back' });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await expect(dialog.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-teams-tab', /.*/);
  expect(teamsJs).toEqual([]);
});
