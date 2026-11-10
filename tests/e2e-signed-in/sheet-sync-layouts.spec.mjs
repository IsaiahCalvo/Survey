// Live Excel sync on every layout the app has (owner 2026-11-09: "check how
// all this works on mobile too... desktop, mobile web, and mobile app"):
// desktop (also tablet), phone web, and the phone app (iOS and Android run
// the same web layout in the app shell). On each one the Survey panel connects
// Microsoft, makes the live workbook, shows what waits on a choice, and stays
// inside the screen. The fake Microsoft (scripts/e2e-fake-msgraph.mjs) stands
// in for Microsoft.
import { signInToken } from './accountFixtures.mjs';
import { E2E_ACCOUNTS, E2E_BASE_URL, E2E_SURVEY } from './accounts.mjs';
import { adminClient, expect, functionUrl, test } from './helpers.mjs';
import * as Y from 'yjs';
import { docToSurveyMarkers } from '../../supabase/functions/_shared/surveyMarkerDocSync.js';
import { pgHexToBytes } from '../../supabase/functions/_shared/pgBytea.js';

const FLAG = 'sheet-team-sync';
const SHOTS = process.env.E2E_SHEET_SYNC_SHOTS || '';

const LAYOUTS = [
  { name: 'desktop', use: { viewport: { width: 1400, height: 900 } }, phone: false, app: false },
  { name: 'tablet', use: { viewport: { width: 1024, height: 768 }, hasTouch: true }, phone: false, app: false },
  { name: 'phone web, 360px Android', use: { viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, phone: true, app: false },
  { name: 'phone web, 390px iPhone', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, phone: true, app: false },
  // The phone app's layout: bottom tabs, and Survey knows it is the app (the
  // consent page opens in the system browser and comes back with a code).
  { name: 'phone app, 390px', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, phone: true, app: true },
  // A phone turned sideways: little height, and the bottom dock over the page.
  { name: 'phone web landscape 844x390', use: { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, phone: true, app: false },
  { name: 'phone app landscape 844x390', use: { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, phone: true, app: true },
];

const fakeAt = (fn) => async (path, body) => {
  const res = await fetch(`${functionUrl(fn)}/__fake${path}`, body
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
  return res.json();
};
const fake = fakeAt('e2e-fake-msgraph');
const fakeGoogle = fakeAt('e2e-fake-google');

// The survey's markers as the annotation log has them.
async function markersOf(documentId) {
  const doc = new Y.Doc();
  const { data, error } = await adminClient().from('annotation_updates')
    .select('seq, data').eq('document_id', documentId).order('seq', { ascending: true });
  if (error) throw error;
  for (const row of data) Y.applyUpdate(doc, pgHexToBytes(row.data));
  return docToSurveyMarkers(doc);
}

async function userId(account) {
  const { data } = await adminClient().auth.admin.listUsers({ perPage: 1000 });
  return data.users.find((u) => u.email === account.email).id;
}

async function signInAt(page, account, path) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  const dialog = page.getByRole('dialog', { name: 'Welcome back' });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await dialog.getByLabel('Email').fill(account.email);
  await dialog.getByLabel('Password').fill(account.password);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog).toBeHidden();
}

const press = (layout, locator) => (layout.use.hasTouch ? locator.tap() : locator.click());

async function openSurveyPanel(page, layout) {
  await press(layout, page.getByText(E2E_SURVEY.documentName, { exact: true }).filter({ visible: true }).first());
  const openFile = page.getByRole('button', { name: 'Open file' });
  // On a tablet a tap now opens the file itself (main, 11-09); the "Open
  // file" button may show for a moment and go, so a press that finds it
  // gone is fine.
  if (await openFile.waitFor({ timeout: 5_000 }).then(() => true, () => false)) {
    await (layout.use.hasTouch ? openFile.tap({ timeout: 5_000 }) : openFile.click({ timeout: 5_000 })).catch(() => {});
  }
  await expect(page.locator('[data-overlay-page="1"] [data-annotation-id]').first()).toBeAttached({ timeout: 60_000 });
  const sync = page.locator('[data-sheet-sync-state]').filter({ visible: true }).first();
  const pick = page.getByRole('button', { name: new RegExp(`^${E2E_SURVEY.templateName}`) }).filter({ visible: true }).first();
  const pickText = page.getByText(E2E_SURVEY.templateName, { exact: true }).filter({ visible: true }).last();
  const useLatest = page.getByRole('button', { name: 'Use latest version' });
  const keep = page.getByRole('button', { name: 'Keep previous version' });
  const opener = layout.phone
    ? page.getByRole('button', { name: 'Open survey' }).filter({ visible: true }).first()
    : page.getByRole('button', { name: 'Survey', exact: true }).filter({ visible: true }).first();
  // A tap while a sheet is still sliding in can miss: keep going until the
  // template's panel (and its live sync button) shows.
  await expect(async () => {
    if (await sync.isVisible()) return;
    if (await useLatest.isVisible()) await press(layout, useLatest);
    else if (await keep.isVisible()) await press(layout, keep);
    else if (await pick.isVisible()) await press(layout, pick);
    else if (await pickText.isVisible()) await press(layout, pickText);
    else if (await opener.isVisible()) await press(layout, opener);
    await expect(sync).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 60_000 });
  return sync;
}

/** Visible things in the panel that stick out past the screen's edges. */
const spills = (page) => page.evaluate(() => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const panel = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute('aria-label') === 'Live sync' || d.querySelector('h2, h3')?.textContent?.includes('Live sync'));
  if (!panel) return ['no panel'];
  const out = [];
  const box = panel.getBoundingClientRect();
  if (box.left < -1 || box.right > width + 1) out.push(`panel ${Math.round(box.left)}..${Math.round(box.right)} of ${width}`);
  if (box.top < -1 || box.top > height - 40) out.push(`panel top ${Math.round(box.top)} of ${height}`);
  // Nothing (a bottom bar, a dock) may be drawn over the card's lower edge,
  // or what is last in it can't be reached.
  const edgeY = Math.min(box.bottom, height) - 4;
  const over = document.elementFromPoint(box.left + box.width / 2, edgeY);
  if (over && !panel.contains(over)) out.push(`panel bottom covered at y=${Math.round(edgeY)} by ${over.tagName.toLowerCase()}.${[...over.classList].join('.')}`);
  for (const el of panel.querySelectorAll('button, a, input, p, label')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.right > width + 1 || r.left < -1) out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}" ${Math.round(r.left)}..${Math.round(r.right)}`);
  }
  return out;
});

/** Buttons a finger can hit: at least 32px tall on touch screens. */
const smallButtons = (page) => page.evaluate(() => {
  const panel = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute('aria-label') === 'Live sync');
  return [...(panel?.querySelectorAll('button') || [])]
    .filter((b) => b.getBoundingClientRect().height > 0 && b.getBoundingClientRect().height < 32)
    .map((b) => `"${(b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30)}" ${Math.round(b.getBoundingClientRect().height)}px`);
});

// Connect Microsoft without the panel (the first test covers the panel's
// connect on each layout): consent, callback, then claim the code.
async function connectMicrosoftByApi() {
  const token = await signInToken(E2E_ACCOUNTS.owner);
  const call = async (action, body) => (await fetch(functionUrl('sheet-sync'), {
    method: 'POST',
    headers: { apikey: process.env.E2E_SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  })).json();
  const started = await call('connect', { appOrigin: E2E_BASE_URL, provider: 'msgraph' });
  const consent = await fetch(started.url, { redirect: 'manual' });
  const callback = await fetch(consent.headers.get('location'), { redirect: 'manual' });
  const code = new URL(callback.headers.get('location')).hash.replace('#code=', '');
  const claimed = await call('claim', { provider: 'msgraph', code });
  expect(claimed).toMatchObject({ ok: true, provider: 'msgraph' });
}

let savedFlag = null;
test.beforeAll(async () => {
  const admin = adminClient();
  savedFlag = (await admin.from('feature_flags').select('*').eq('key', FLAG)).data?.at(0) || null;
  await admin.from('feature_flags').upsert({
    key: FLAG, mode: 'testers', tester_emails: [E2E_ACCOUNTS.owner.email], description: 'sheet-sync-layouts.spec.mjs',
  }, { onConflict: 'key' });
});
test.afterAll(async () => {
  const admin = adminClient();
  if (savedFlag) await admin.from('feature_flags').upsert(savedFlag, { onConflict: 'key' });
  else await admin.from('feature_flags').update({ mode: 'off', tester_emails: [] }).eq('key', FLAG);
});

for (const layout of LAYOUTS) {
  test.describe(`live sync, ${layout.name}`, () => {
    test.use(layout.use);

    test('connect Microsoft, make the workbook, settle what waits, stop', async ({ page, context, browser }) => {
      test.setTimeout(180_000);
      // What waits on a choice is shown from the server's answer; the rounds
      // that make it are tested against real Excel and in sheetSync*.test.mjs.
      // Here the answer gets those items added, until a choice is pressed.
      let waiting = null;
      await page.route('**/functions/v1/sheet-sync', async (route) => {
        const url = process.env.E2E_FUNCTIONS_URL ? functionUrl('sheet-sync') : route.request().url();
        const action = (() => { try { return JSON.parse(route.request().postData() || '{}').action; } catch { return null; } })();
        if (!waiting || action === 'choose' || route.request().method() !== 'POST') {
          if (action === 'choose') waiting = null;
          return route.fallback({ url });
        }
        const res = await route.fetch({ url });
        const body = await res.json();
        if (body?.link) Object.assign(body.link, waiting(body.link));
        return route.fulfill({ response: res, json: body });
      });
      const admin = adminClient();
      const ownerId = await userId(E2E_ACCOUNTS.owner);
      await admin.from('sheet_sync_links').delete().eq('document_id', E2E_SURVEY.documentId);
      await admin.from('sheet_sync_connections').delete().eq('user_id', ownerId);
      const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${layout.name.replace(/[^a-z0-9]+/gi, '-')}-${name}.png` }); };
      try {
        await page.addInitScript(() => window.localStorage.setItem('survey.flag.sheet-team-sync', '1'));
        await signInAt(page, E2E_ACCOUNTS.owner, layout.app ? '/?mobileNav=tabs&nativeShell=capacitor' : '/');
        const button = await openSurveyPanel(page, layout);
        await expect(button).toHaveAttribute('data-sheet-sync-state', 'none');
        await press(layout, button);
        const panel = page.getByRole('dialog', { name: 'Live sync' });
        await expect(panel).toBeVisible();
        expect(await spills(page), 'panel, not connected').toEqual([]);
        await shot('1-connect');

        // Connect Microsoft. The web opens the consent page in a tab that hands
        // the code back on its own; the app opens the system browser, whose
        // last page offers "Open Survey" (a com.kalvoe.survey:// link), and the
        // panel also takes the code typed.
        if (layout.app) {
          // The system browser shares nothing with the app: keep the consent
          // address, say yes from outside, and open its last page in a browser
          // of its own.
          let consentUrl = null;
          await context.route('**/oauth2/v2.0/authorize**', (route) => { consentUrl = route.request().url(); return route.abort(); });
          const consentTab = context.waitForEvent('page');
          await press(layout, panel.getByRole('button', { name: 'Connect Microsoft' }));
          const tab = await consentTab;
          await expect.poll(() => consentUrl, { timeout: 15_000 }).toBeTruthy();
          await tab.close();
          const consent = await fetch(consentUrl, { redirect: 'manual' });
          const callback = await fetch(consent.headers.get('location'), { redirect: 'manual' });
          const landed = callback.headers.get('location');
          expect(landed).toContain('app=phone');
          const other = await browser.newContext({ viewport: layout.use.viewport, isMobile: true, hasTouch: true });
          const browserPage = await other.newPage();
          await browserPage.goto(landed);
          await expect(browserPage.getByRole('link', { name: /Open Survey/ })).toHaveAttribute('href', /^com\.kalvoe\.survey:\/\/sheet-connected\?provider=msgraph&code=/);
          const code = (await browserPage.locator('#code').textContent()).trim();
          if (SHOTS) await browserPage.screenshot({ path: `${SHOTS}/${layout.name.replace(/[^a-z0-9]+/gi, '-')}-2-system-browser.png` });
          await other.close();
          // No "Open Survey" tap here (the app's own link): the code is typed.
          await press(layout, panel.getByRole('button', { name: 'Enter its code' }).first());
          const box = panel.getByLabel(/Type the code/);
          await box.fill(code);
          expect(await spills(page), 'panel, code box').toEqual([]);
          await shot('2-code');
          await press(layout, panel.getByRole('button', { name: 'Finish' }));
        } else {
          // The web: the consent tab hands the code back through the site's storage.
          const consentTab = context.waitForEvent('page');
          await press(layout, panel.getByRole('button', { name: 'Connect Microsoft' }));
          const tab = await consentTab;
          await tab.waitForURL(/google-connected\.html\?/, { timeout: 30_000 });
          await tab.close();
        }
        await expect(button).toHaveAttribute('data-sheet-sync-state', 'connected', { timeout: 40_000 });
        await expect(panel.getByText('pm@contoso.example', { exact: true })).toBeVisible();
        expect(await spills(page), 'panel, connected').toEqual([]);
        await shot('3-connected');

        // "Save in": the folder list fits too.
        await press(layout, panel.getByRole('button', { name: 'Change' }));
        await press(layout, panel.getByRole('button', { name: 'OneDrive', exact: true }));
        await expect(panel.getByRole('listitem').filter({ hasText: 'Jobs' })).toBeVisible();
        expect(await spills(page), 'panel, folders').toEqual([]);
        await shot('4-folders');
        await press(layout, panel.getByRole('button', { name: 'Save here' }));

        await press(layout, panel.getByRole('button', { name: 'Make Excel workbook' }));
        await expect(panel.getByRole('link', { name: 'Open in Excel' })).toBeVisible({ timeout: 30_000 });
        await expect(button).toHaveAttribute('data-sheet-sync-state', 'active');
        expect(await spills(page), 'panel, live').toEqual([]);
        await shot('5-live');

        // What waits on a choice: answers cleared at once in the sheet, rows
        // deleted there, and a tab that lost its heading row.
        const at = new Date().toISOString();
        waiting = (link) => ({
          heldErase: { count: 14, items: 9, at },
          removedInSheet: [
            { markerId: 'gone-1', at, name: 'D-9-01 a long item name that wraps on a phone' },
            { markerId: 'gone-2', at, name: 'D-9-02' },
          ],
          brokenTabs: [{ scopeId: 'x', title: link.missingTabs?.[0]?.title || `${E2E_SURVEY.categoryName} - ${E2E_SURVEY.moduleName}` }],
        });
        await press(layout, panel.getByRole('button', { name: 'Sync now' }));
        await expect(panel.getByText('14 answers on 9 items were cleared in the sheet at once')).toBeVisible({ timeout: 30_000 });
        await expect(panel.getByRole('button', { name: 'Put all 2 rows back' })).toBeVisible();
        await expect(panel.getByRole('button', { name: 'Make a new sheet' })).toBeVisible();
        expect(await spills(page), 'panel, waiting items').toEqual([]);
        if (layout.use.hasTouch) expect(await smallButtons(page), 'buttons big enough to tap').toEqual([]);
        await shot('6-waiting');
        await panel.getByRole('button', { name: 'Put them back in the sheet' }).scrollIntoViewIfNeeded();
        await press(layout, panel.getByRole('button', { name: 'Put them back in the sheet' }));
        await expect(panel.getByText(/cleared in the sheet at once/)).toHaveCount(0, { timeout: 30_000 });

        // Stop syncing asks first, then goes back to "Make Excel workbook".
        await press(layout, panel.getByRole('button', { name: 'More' }));
        await press(layout, panel.getByRole('menuitem', { name: 'Stop syncing…' }));
        await expect(panel.getByText('Stop syncing for everyone?')).toBeVisible();
        expect(await spills(page), 'panel, stop').toEqual([]);
        await press(layout, panel.getByRole('button', { name: 'Stop syncing' }));
        await expect(panel.getByRole('button', { name: 'Make Excel workbook' })).toBeVisible({ timeout: 30_000 });
      } finally {
        await admin.from('sheet_sync_links').delete().eq('document_id', E2E_SURVEY.documentId);
        await admin.from('sheet_sync_connections').delete().eq('user_id', ownerId);
        await admin.from('sheet_sync_pending_connections').delete().eq('user_id', ownerId);
        await fake('/reset', {});
      }
    });

    test('connect Google, make the sheet, a deleted tab, a PM edit, a trashed sheet', async ({ page, context, browser }) => {
      test.setTimeout(180_000);
      if (process.env.E2E_FUNCTIONS_URL) {
        await page.route('**/functions/v1/sheet-sync', (route) => route.fallback({ url: functionUrl('sheet-sync') }));
      }
      const admin = adminClient();
      const ownerId = await userId(E2E_ACCOUNTS.owner);
      await admin.from('sheet_sync_links').delete().eq('document_id', E2E_SURVEY.documentId);
      await admin.from('sheet_sync_connections').delete().eq('user_id', ownerId);
      const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${layout.name.replace(/[^a-z0-9]+/gi, '-')}-g${name}.png` }); };
      const tap = (locator) => press(layout, locator);
      try {
        await page.addInitScript(() => window.localStorage.setItem('survey.flag.sheet-team-sync', '1'));
        await signInAt(page, E2E_ACCOUNTS.owner, layout.app ? '/?mobileNav=tabs&nativeShell=capacitor' : '/');
        const button = await openSurveyPanel(page, layout);
        await expect(button).toHaveAttribute('data-sheet-sync-state', 'none');
        await tap(button);
        const panel = page.getByRole('dialog', { name: 'Live sync' });
        await expect(panel.getByRole('button', { name: 'Connect Google' })).toBeVisible();

        if (layout.app) {
          let consentUrl = null;
          await context.route('**/o/oauth2/v2/auth**', (route) => { consentUrl = route.request().url(); return route.abort(); });
          const consentTab = context.waitForEvent('page');
          await tap(panel.getByRole('button', { name: 'Connect Google' }));
          const tab = await consentTab;
          await expect.poll(() => consentUrl, { timeout: 15_000 }).toBeTruthy();
          await tab.close();
          const consent = await fetch(consentUrl, { redirect: 'manual' });
          const callback = await fetch(consent.headers.get('location'), { redirect: 'manual' });
          const landed = callback.headers.get('location');
          expect(landed).toContain('app=phone');
          const other = await browser.newContext({ viewport: layout.use.viewport, isMobile: true, hasTouch: true });
          const browserPage = await other.newPage();
          await browserPage.goto(landed);
          await expect(browserPage.getByRole('link', { name: /Open Survey/ })).toHaveAttribute('href', /^com\.kalvoe\.survey:\/\/sheet-connected\?provider=google&code=/);
          const code = (await browserPage.locator('#code').textContent()).trim();
          await other.close();
          await tap(panel.getByRole('button', { name: 'Enter its code' }).first());
          await panel.getByLabel(/Type the code/).fill(code);
          await tap(panel.getByRole('button', { name: 'Finish' }));
        } else {
          const consentTab = context.waitForEvent('page');
          await tap(panel.getByRole('button', { name: 'Connect Google' }));
          const tab = await consentTab;
          await tab.waitForURL(/google-connected\.html\?result=finish/, { timeout: 30_000 });
          await tab.close();
        }
        await expect(button).toHaveAttribute('data-sheet-sync-state', 'connected', { timeout: 40_000 });
        await expect(panel.getByText(E2E_ACCOUNTS.owner.email, { exact: true })).toBeVisible();
        expect(await spills(page), 'panel, Google connected').toEqual([]);
        await shot('1-connected');

        await tap(panel.getByRole('button', { name: 'Make Google Sheet' }));
        await expect(panel.getByRole('link', { name: 'Open in Sheets' })).toBeVisible({ timeout: 30_000 });
        await expect(button).toHaveAttribute('data-sheet-sync-state', 'active');
        expect(await spills(page), 'panel, Google live').toEqual([]);
        if (layout.use.hasTouch) expect(await smallButtons(page), 'Google live, touch targets').toEqual([]);
        await shot('2-live');

        const { files } = await fakeGoogle('/files');
        const fileId = files.at(-1);
        const title = `${E2E_SURVEY.categoryName} - ${E2E_SURVEY.moduleName}`;
        let file = await fakeGoogle(`/files/${fileId}`);
        let tab = file.sheets.find((x) => x.title === title);
        const row = tab.rows.findIndex((r) => r[3] === E2E_SURVEY.itemName);
        expect(row).toBeGreaterThan(0);

        // The PM deletes the tab: the panel says so and puts it back.
        await fakeGoogle(`/files/${fileId}/delete-tab`, { title });
        await expect(async () => {
          await tap(panel.getByRole('button', { name: 'Sync now' }));
          await expect(panel.getByRole('button', { name: 'Put it back' })).toBeVisible({ timeout: 3_000 });
        }).toPass({ timeout: 30_000 });
        expect(await spills(page), 'panel, Google tab deleted').toEqual([]);
        if (layout.use.hasTouch) expect(await smallButtons(page), 'Google tab deleted, touch targets').toEqual([]);
        await shot('3-tab-deleted');
        await tap(panel.getByRole('button', { name: 'Put it back' }));
        await expect(panel.getByRole('button', { name: 'Put it back' })).toHaveCount(0, { timeout: 30_000 });
        file = await fakeGoogle(`/files/${fileId}`);
        tab = file.sheets.find((x) => x.title === title);
        expect(tab.rows.some((r) => r[3] === E2E_SURVEY.itemName)).toBe(true);

        // A PM's note in the sheet reaches the item.
        const notesCol = tab.rows[0].indexOf('Notes');
        const at = tab.rows.findIndex((r) => r[3] === E2E_SURVEY.itemName);
        const note = `From Sheets on ${layout.name}`;
        await fakeGoogle(`/files/${fileId}/edit`, { title, edits: [{ row: at, col: notesCol, value: note }] });
        await expect(async () => {
          await tap(panel.getByRole('button', { name: 'Sync now' }));
          await expect(panel.getByRole('button', { name: 'Sync now' })).not.toHaveAttribute('aria-busy', 'true', { timeout: 10_000 });
          expect(JSON.stringify(await markersOf(E2E_SURVEY.documentId))).toContain(note);
        }).toPass({ timeout: 45_000 });
        // Put the seeded item's note back: other specs expect it as seeded.
        await fakeGoogle(`/files/${fileId}/edit`, { title, edits: [{ row: at, col: notesCol, value: tab.rows[at][notesCol] ?? '' }] });
        await expect(async () => {
          await tap(panel.getByRole('button', { name: 'Sync now' }));
          await expect(panel.getByRole('button', { name: 'Sync now' })).not.toHaveAttribute('aria-busy', 'true', { timeout: 10_000 });
          expect(JSON.stringify(await markersOf(E2E_SURVEY.documentId))).not.toContain(note);
        }).toPass({ timeout: 45_000 });

        // The PM trashes the sheet: the link stops and says why.
        await fakeGoogle(`/files/${fileId}/trash`, {});
        await tap(panel.getByRole('button', { name: 'Sync now' }));
        await expect(panel.getByText('Sync stopped')).toBeVisible({ timeout: 30_000 });
        await expect(panel.getByText(/was deleted or is no longer shared/)).toBeVisible();
        expect(await spills(page), 'panel, Google sheet trashed').toEqual([]);
        await shot('4-trashed');
      } finally {
        await admin.from('sheet_sync_links').delete().eq('document_id', E2E_SURVEY.documentId);
        await admin.from('sheet_sync_connections').delete().eq('user_id', ownerId);
        await admin.from('sheet_sync_pending_connections').delete().eq('user_id', ownerId);
        await fakeGoogle('/reset', {});
      }
    });

    test('use a workbook the PM already has', async ({ page }) => {
      test.setTimeout(150_000);
      if (process.env.E2E_FUNCTIONS_URL) {
        await page.route('**/functions/v1/sheet-sync', (route) => route.fallback({ url: functionUrl('sheet-sync') }));
      }
      const admin = adminClient();
      const ownerId = await userId(E2E_ACCOUNTS.owner);
      await admin.from('sheet_sync_links').delete().eq('document_id', E2E_SURVEY.documentId);
      await connectMicrosoftByApi();
      const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${layout.name.replace(/[^a-z0-9]+/gi, '-')}-${name}.png` }); };
      try {
        const book = await fake('/make-file', { name: 'Hospital tracker.xlsx', sheets: [{ name: 'Summary', rows: [['Job', 'Hospital']] }] });
        await page.addInitScript(() => window.localStorage.setItem('survey.flag.sheet-team-sync', '1'));
        await signInAt(page, E2E_ACCOUNTS.owner, layout.app ? '/?mobileNav=tabs&nativeShell=capacitor' : '/');
        const button = await openSurveyPanel(page, layout);
        await expect(button).toHaveAttribute('data-sheet-sync-state', 'connected', { timeout: 30_000 });
        await press(layout, button);
        const panel = page.getByRole('dialog', { name: 'Live sync' });
        await press(layout, panel.getByRole('button', { name: 'Use a workbook I already have' }));
        const box = panel.getByLabel(/Paste the link to an Excel workbook/);
        await box.fill('https://contoso.sharepoint.example/nope');
        await press(layout, panel.getByRole('button', { name: 'Add Survey’s sheets' }));
        await expect(panel.getByRole('alert')).toHaveText(/could not open that link/);
        expect(await spills(page), 'panel, pasted link refused').toEqual([]);
        await shot('7-existing-refused');
        await box.fill(book.link);
        await press(layout, panel.getByRole('button', { name: 'Add Survey’s sheets' }));
        await expect(panel.getByRole('link', { name: 'Open in Excel' })).toBeVisible({ timeout: 30_000 });
        await expect(panel.getByText('Hospital tracker', { exact: false }).first()).toBeVisible();
        expect(await spills(page), 'panel, linked to their workbook').toEqual([]);
        await shot('8-existing-live');
        const file = await fake(`/files/${book.id}`);
        expect(file.sheets[0]).toMatchObject({ name: 'Summary', rows: [['Job', 'Hospital']] });
        expect(file.sheets.length).toBeGreaterThan(1);

        // The PM moves the workbook to another library: the link stops, and
        // pasting the new link picks it up again.
        const moved = await fake(`/files/${book.id}/move`, {});
        await press(layout, panel.getByRole('button', { name: 'Sync now' }));
        await expect(panel.getByText('Sync stopped')).toBeVisible({ timeout: 30_000 });
        await press(layout, panel.getByRole('button', { name: 'Moved or copied the workbook? Paste its new link' }));
        const where = panel.getByLabel(/Paste the link to the workbook where it is now/);
        await where.fill(moved.link);
        await expect(panel.getByRole('button', { name: 'Sync this workbook' })).toBeEnabled();
        const field = await where.boundingBox();
        const card = await panel.boundingBox();
        expect(field.width, 'link box spans the card').toBeGreaterThan(card.width * 0.8);
        if (layout.use.hasTouch) expect(field.height, 'link box finger-sized').toBeGreaterThanOrEqual(40);
        expect(await spills(page), 'panel, find the moved workbook').toEqual([]);
        await shot('9-relink');
        await press(layout, panel.getByRole('button', { name: 'Sync this workbook' }));
        await expect(panel.getByText('Live in Excel')).toBeVisible({ timeout: 30_000 });
        expect(await spills(page), 'panel, live again after the move').toEqual([]);
        if (layout.use.hasTouch) expect(await smallButtons(page), 'touch targets after the move').toEqual([]);
      } finally {
        await admin.from('sheet_sync_links').delete().eq('document_id', E2E_SURVEY.documentId);
        await admin.from('sheet_sync_connections').delete().eq('user_id', ownerId);
        await fake('/reset', {});
      }
    });
  });
}
