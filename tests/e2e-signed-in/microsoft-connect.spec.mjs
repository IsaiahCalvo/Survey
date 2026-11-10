// Break tests for connecting Microsoft (live Excel sync), end to end against
// the fake Microsoft (scripts/e2e-fake-msgraph.mjs). The same cases were first
// seen or checked against a real Microsoft 365 tenant; see
// tests/sheetSyncConnectBreak.test.mjs and
// /mnt/project-files/excel-sync/connect-break-test-2026-11-10.md.
//
// Nothing here leaves 127.0.0.1: Microsoft's own admin page is only read off a
// redirect, never fetched.
import { signInToken } from './accountFixtures.mjs';
import { E2E_ACCOUNTS, E2E_BASE_URL, E2E_SURVEY } from './accounts.mjs';
import { adminClient, expect, functionUrl, signIn, test } from './helpers.mjs';

const FLAG = 'sheet-team-sync';
const MS = { provider: 'msgraph' };

const call = async (token, action, body = {}) => {
  const res = await fetch(functionUrl('sheet-sync'), {
    method: 'POST',
    headers: { apikey: process.env.E2E_SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  });
  return { status: res.status, body: await res.json() };
};
const fake = async (path, body) => (await fetch(`${functionUrl('e2e-fake-msgraph')}/__fake${path}`, body
  ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  : undefined)).json();
const local = (url) => {
  const u = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error(`refusing a non-local address: ${u.origin}`);
  return url;
};
const follow = async (url) => fetch(local(url), { redirect: 'manual' });

async function userId(account) {
  const { data } = await adminClient().auth.admin.listUsers();
  return data.users.find((u) => u.email === account.email).id;
}
async function forgetMicrosoft() {
  const id = await userId(E2E_ACCOUNTS.owner);
  await adminClient().from('sheet_sync_links').delete().eq('document_id', E2E_SURVEY.documentId);
  await adminClient().from('sheet_sync_connections').delete().eq('user_id', id);
  await adminClient().from('sheet_sync_pending_connections').delete().eq('user_id', id);
}

async function openPanel(page) {
  await page.getByText(E2E_SURVEY.documentName, { exact: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.getByRole('button', { name: `Close ${E2E_SURVEY.documentName}` })).toBeVisible({ timeout: 60_000 });
  const sync = page.locator('[data-sheet-sync-state]').filter({ visible: true }).first();
  const chooser = page.getByText('Choose a survey template', { exact: true });
  await expect(async () => {
    if (await sync.isVisible()) return;
    if (await chooser.isVisible()) {
      await page.getByText(E2E_SURVEY.templateName, { exact: true }).last().click();
      const keep = page.getByRole('button', { name: 'Keep previous version' });
      if (await keep.waitFor({ timeout: 3_000 }).then(() => true, () => false)) await keep.click();
    } else {
      await page.getByRole('button', { name: 'Survey', exact: true }).filter({ visible: true }).first().click();
    }
    await expect(sync).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 60_000 });
  await sync.click();
  const panel = page.getByRole('dialog', { name: 'Live sync' });
  await expect(panel).toBeVisible();
  return { sync, panel };
}

let savedFlag = null;
test.beforeAll(async () => {
  const admin = adminClient();
  await fake('/reset', {});
  savedFlag = (await admin.from('feature_flags').select('*').eq('key', FLAG)).data?.at(0) || null;
  await admin.from('feature_flags').upsert({
    key: FLAG, mode: 'testers', tester_emails: [E2E_ACCOUNTS.owner.email], description: 'microsoft-connect.spec.mjs',
  }, { onConflict: 'key' });
});
test.afterAll(async () => {
  await fake('/drive-type', { driveType: 'business' });
  await forgetMicrosoft();
  const admin = adminClient();
  if (savedFlag) await admin.from('feature_flags').upsert(savedFlag, { onConflict: 'key' });
  else await admin.from('feature_flags').update({ mode: 'off', tester_emails: [] }).eq('key', FLAG);
});
test.beforeEach(async ({ page }) => {
  await forgetMicrosoft();
  if (process.env.E2E_FUNCTIONS_URL) {
    await page.route('**/functions/v1/sheet-sync', (route) => route.fallback({ url: functionUrl('sheet-sync') }));
  }
});

test('a home Microsoft account is turned back with "Use another account", which then finishes', async ({ page }) => {
  const token = await signInToken(E2E_ACCOUNTS.owner);
  await fake('/drive-type', { driveType: 'personal' });
  const started = await call(token, 'connect', { appOrigin: E2E_BASE_URL, ...MS });
  const consent = await follow(started.body.url);
  const landed = (await follow(consent.headers.get('location'))).headers.get('location');
  const page1 = new URL(landed);
  expect(page1.searchParams.get('result')).toBe('personal');
  expect((await call(token, 'status')).body.microsoft.connected).toBe(false);

  // The page's one button: Microsoft again, now with the account picker.
  await page.goto(landed);
  await expect(page.getByRole('heading', { name: 'That’s a personal account' })).toBeVisible();
  const retry = page.getByRole('link', { name: 'Use another account' });
  const href = await retry.getAttribute('href');
  expect(new URL(href).searchParams.get('prompt')).toBe('select_account');

  // The person picks their work account this time.
  await fake('/drive-type', { driveType: 'business' });
  const again = await follow(href);
  const finish = new URL((await follow(again.headers.get('location'))).headers.get('location'));
  expect(finish.searchParams.get('result')).toBe('finish');
  const claimed = await call(token, 'claim', { ...MS, code: finish.hash.replace('#code=', '') });
  expect(claimed.body).toMatchObject({ ok: true, provider: 'msgraph' });
});

test('"Need admin approval" comes back as a cancel: the page gives a link for the IT admin', async ({ page }) => {
  const token = await signInToken(E2E_ACCOUNTS.owner);
  const started = await call(token, 'connect', { appOrigin: E2E_BASE_URL, ...MS });
  const state = new URL(started.body.url).searchParams.get('state');
  // What Microsoft sends back from "Need admin approval" > "Return to the application" (real tenant, 2026-11-10).
  const cancel = await follow(`${functionUrl('sheet-sync')}/oauth/msgraph/callback?error=access_denied&error_subcode=cancel&state=${encodeURIComponent(state)}`);
  const landed = cancel.headers.get('location');
  await page.goto(landed);
  await expect(page.getByRole('heading', { name: 'Microsoft was not connected' })).toBeVisible();
  const admin = (await page.locator('#adminLink').textContent()).trim();
  expect(admin).toBe(`${functionUrl('sheet-sync')}/oauth/msgraph/admin`);
  await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible();
  // The admin link sends the admin to Microsoft's approve-for-everyone page.
  const toMicrosoft = await follow(admin);
  expect(toMicrosoft.status).toBe(302);
  const ms = new URL(toMicrosoft.headers.get('location'));
  expect(ms.pathname).toMatch(/\/organizations\/v2\.0\/adminconsent$/);
  // ...and Microsoft's answer lands on "Survey is approved".
  const approved = await follow(`${functionUrl('sheet-sync')}/oauth/msgraph/callback?admin_consent=True&tenant=t1&state=${encodeURIComponent(ms.searchParams.get('state'))}`);
  await page.goto(approved.headers.get('location'));
  await expect(page.getByRole('heading', { name: 'Survey is approved' })).toBeVisible();
});

test('a blocked sign-in window gets a tap-to-open link, and the sign-in still finishes', async ({ page, context }) => {
  test.setTimeout(120_000);
  // A browser that blocks pop-ups: window.open gives nothing back.
  await page.addInitScript(() => {
    window.localStorage.setItem('survey.flag.sheet-team-sync', '1');
    window.open = () => null;
  });
  await signIn(page, E2E_ACCOUNTS.owner);
  const { sync, panel } = await openPanel(page);
  await panel.getByRole('button', { name: 'Connect Microsoft' }).click();
  const open = panel.getByRole('link', { name: 'Open Microsoft sign-in' });
  await expect(open).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByText('Your browser stopped the sign-in window.')).toBeVisible();
  const tab = context.waitForEvent('page');
  await open.click();
  const consent = await tab;
  await expect(consent.getByRole('heading', { name: /Microsoft is connected/ })).toBeVisible({ timeout: 30_000 });
  await expect(sync).toHaveAttribute('data-sheet-sync-state', 'connected', { timeout: 30_000 });
  await expect(panel.getByRole('button', { name: 'Make Excel workbook' })).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

test('a flaky network at the last step keeps the code and finishes; a second tab shows no false error', async ({ page, context }) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => window.localStorage.setItem('survey.flag.sheet-team-sync', '1'));
  await signIn(page, E2E_ACCOUNTS.owner);
  const { sync, panel } = await openPanel(page);
  // A second tab on the same survey, open the whole time.
  const second = await context.newPage();
  if (process.env.E2E_FUNCTIONS_URL) await second.route('**/functions/v1/sheet-sync', (route) => route.fallback({ url: functionUrl('sheet-sync') }));
  await second.goto('/');
  const other = await openPanel(second);
  // The first claim never reaches the server (a dropped connection).
  let dropped = 0;
  await page.route('**/functions/v1/sheet-sync', async (route) => {
    const action = (() => { try { return JSON.parse(route.request().postData() || '{}').action; } catch { return null; } })();
    if (action === 'claim' && dropped === 0) { dropped += 1; return route.abort('connectionreset'); }
    return route.fallback(process.env.E2E_FUNCTIONS_URL ? { url: functionUrl('sheet-sync') } : undefined);
  });
  const tab = context.waitForEvent('page', (p) => p !== second);
  await panel.getByRole('button', { name: 'Connect Microsoft' }).click();
  await tab;
  await expect(sync).toHaveAttribute('data-sheet-sync-state', 'connected', { timeout: 45_000 });
  await expect(panel.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => window.localStorage.getItem('survey-sheet-sync-claim'))).toBeNull();
  // The other tab heard the same code; it ends connected with no "ran out" error.
  await second.bringToFront();
  await expect(other.sync).toHaveAttribute('data-sheet-sync-state', 'connected', { timeout: 30_000 });
  await expect(other.panel.getByRole('alert')).toHaveCount(0);
  await expect(other.panel.getByText(/ran out/)).toHaveCount(0);
});
