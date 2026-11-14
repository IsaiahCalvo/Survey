// Survey as a Microsoft Teams tab (Drawboard Projects IN-28). Teams opens
// <site>/teams in a frame and shows nothing until the page says it is ready.
// Here a stand-in Teams page (served at teams.microsoft.com by the test, no
// network) frames Survey, answers the Teams library's hello and records what
// the page sends: it must say hello and then "ready", show email sign-in
// without the Google / Microsoft buttons (those sites refuse to open in a
// frame), and work once signed in. The same address outside a frame never
// loads the Teams library. Adding Survey to a channel opens /teams/config:
// pick a project and what the tab opens, Teams' Save stores the tab's
// address, and that address opens the list (or one drawing).
import crypto from 'node:crypto';
import fs from 'node:fs';
import { E2E_ACCOUNTS, E2E_BASE_URL } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, expect, test } from './helpers.mjs';
import { seedSheet } from './seedSheet.mjs';

const HOST = 'https://teams.microsoft.com/_survey-e2e-host';
// The stand-in page is answered by the test itself; nothing else may leave
// the machine (helpers.mjs aborts every other non-local request).
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

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
  window.__teamsArgs = [];
  const RUNTIME = JSON.stringify({ apiVersion: 4, hostVersionsInfo: {}, isLegacyTeams: false, supports: { pages: { appButton: {}, tabs: {}, config: {}, backStack: {}, fullTrust: {} }, teamsCore: {} } });
  window.addEventListener('message', (evt) => {
    const frame = document.getElementById('tab').contentWindow;
    if (evt.source !== frame || !evt.data || typeof evt.data.func !== 'string') return;
    const { id, uuid, func } = evt.data;
    window.__teamsCalls.push(func);
    const answer = (args) => frame.postMessage({ id, uuid, args }, '*');
    window.__teamsArgs.push([func, evt.data.args]);
    const settings = document.getElementById('tab').src.includes('/teams/config');
    if (func === 'initialize') answer([settings ? 'settings' : 'content', 'web', RUNTIME, '2.0.0']);
    else if (func === 'getContext') answer([{ theme: 'dark', locale: 'en-us', hostClientType: 'web', frameContext: settings ? 'settings' : 'content', entityId: 'survey-home' }]);
    else if (func === 'settings.setSettings') answer([true]);
  });
  // Teams' own Save button.
  window.__teamsSave = () => document.getElementById('tab').contentWindow.postMessage({ func: 'settings.save', args: [{}] }, '*');
</script></body></html>`;

test('inside Teams the tab says it is ready and offers email sign-in only', async ({ page, context }) => {
  test.setTimeout(120_000);
  expect(LOCAL_HOSTS.has(new URL(E2E_BASE_URL).hostname)).toBe(true);
  const outside = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (!LOCAL_HOSTS.has(url.hostname) && !req.url().startsWith(HOST) && !['data:', 'blob:'].includes(url.protocol)) outside.push(req.url());
  });
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
  // Asked for, never answered: helpers.mjs aborted each one.
  expect(outside.every((u) => !u.includes('supabase.co'))).toBe(true);
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

test('adding the tab to a channel pins a project list or a drawing', async ({ page, context }) => {
  test.setTimeout(150_000);
  expect(LOCAL_HOSTS.has(new URL(E2E_BASE_URL).hostname)).toBe(true);
  const admin = adminClient();
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const ownerId = users.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const projectId = crypto.randomUUID();
  const projectName = `Teams pin ${RUN}`.slice(0, 60);
  await must('project', admin.from('projects').insert({ id: projectId, user_id: ownerId, name: projectName }));
  const sheet = await seedSheet('Teams pin');
  await must('file in project', admin.from('documents').update({ project_id: projectId }).eq('id', sheet.id));
  await context.addInitScript(() => {
    try { localStorage.setItem('survey.flag.project-issues', '1'); localStorage.setItem('survey.flag.project-photos', '1'); } catch { /* */ }
  });
  let src = `${E2E_BASE_URL}/teams/config`;
  await context.route(`${HOST}**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: hostPage(src) }));
  try {
    await page.goto(HOST);
    const tab = page.frameLocator('#tab');
    const dialog = tab.getByRole('dialog', { name: 'Welcome back' });
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
    await dialog.getByLabel('Email').fill(E2E_ACCOUNTS.owner.email);
    await dialog.getByLabel('Password').fill(E2E_ACCOUNTS.owner.password);
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(dialog).toBeHidden();

    const pin = tab.locator('[data-teams-pin]');
    await expect(pin.getByRole('heading', { name: 'Pick what this tab shows' })).toBeVisible({ timeout: 45_000 });
    const status = pin.locator('[data-teams-pin-status]');
    await expect(status).toHaveText('Pick a project to finish.');
    const lastValid = () => page.evaluate(() => window.__teamsArgs.filter(([f]) => f === 'settings.setValidityState').map(([, a]) => a[0]).at(-1));
    await expect.poll(lastValid, { timeout: 15_000 }).toBe(false);

    await pin.getByRole('radio', { name: new RegExp(projectName) }).click();
    await pin.getByRole('radio', { name: 'Issues' }).click();
    await expect(status).toHaveText(`Press Save to add "${projectName} issues".`);
    await expect.poll(lastValid).toBe(true);

    await page.evaluate(() => window.__teamsSave());
    await expect.poll(() => page.evaluate(() => window.__teamsCalls), { timeout: 15_000 }).toContain('settings.save.success');
    const saved = await page.evaluate(() => window.__teamsArgs.find(([f]) => f === 'settings.setSettings')[1][0]);
    expect(saved).toMatchObject({
      entityId: `survey-${projectId}-issue`,
      contentUrl: `${E2E_BASE_URL}/teams?project=${projectId}&list=issue`,
      websiteUrl: `${E2E_BASE_URL}/?project=${projectId}&list=issue`,
      suggestedDisplayName: `${projectName} issues`,
    });

    // Teams then opens the saved address as the tab: the project's Issues.
    src = saved.contentUrl;
    await page.goto(HOST);
    const issuesTab = tab.locator('[data-project-items-tabs] [role="tab"][aria-selected="true"]').filter({ visible: true }).first();
    await expect(issuesTab).toHaveText(/^Issues/, { timeout: 45_000 });
    await expect(tab.locator('[data-teams-pin]')).toHaveCount(0);

    // A tab pinned to one drawing opens it.
    src = `${E2E_BASE_URL}/teams?project=${projectId}&doc=${sheet.id}`;
    await page.goto(HOST);
    await expect(tab.locator('.survey-pdfjs-page-div').first()).toBeVisible({ timeout: 60_000 });
  } finally {
    await sheet.remove();
    await admin.from('projects').delete().eq('id', projectId);
  }
});
