// Helpers for the REAL-backend Part 9 walkthrough (part9-sync-real.spec.mjs):
// two real test accounts, a real throwaway document, real Supabase Realtime.
//
// Unlike tp-local-doc.mjs / tp-fake-backend.mjs nothing here is faked: the
// windows sign in to the project in .env, upload a document through Home,
// share it, and every live edit goes through Supabase. Use ONLY the owner's
// test accounts, and keep traffic small (one document per run, deleted at
// the end through Home -> Archive -> Delete forever).
//
// Accounts come ONLY from a verified test-account lease (repo policy,
// tests/testAccountLease.test.mjs), two of them: the first leased account is
// A (owns the document), the second is B. Run the spec through
//   node scripts/test-account-lease.mjs run --task <ID> ... -- npx playwright test ...
// Without a lease the spec skips. Credentials are never printed.
//
// TP_REALTIME_RELAY=1: hand each page's Realtime WebSocket to this Node
// process, which opens the same socket with its own client and passes frames
// both ways unchanged. For sandboxes whose HTTPS proxy carries plain requests
// but not WebSocket upgrades. Latency numbers then include one local hop.
//
// TP_CAPTURE_NUL=<file>: append any History request body that holds U+0000
// (Postgres refuses those with 22P05) to <file>, to see which field carried it.
//
// Signing in uses the app's own Supabase client from the dev server's module
// graph (`/src/supabaseClient.js`), so this needs the Vite dev server (not a
// production build) and skips the Turnstile captcha widget a headless browser
// cannot pass.

import { loadVerifiedTestAccounts } from '../../../scripts/test-account-lease.mjs';
import { baseUrl, collectErrors } from './tp-local-doc.mjs';

/** { A, B } from the verified lease, or null (no lease: the spec skips). */
export function realAccounts() {
  if (!process.env.SURVEY_TEST_LEASE_TASK) return null;
  const [a, b] = loadVerifiedTestAccounts({ minimumAccounts: 2 });
  return { A: { email: a.email, password: a.password }, B: { email: b.email, password: b.password } };
}

/** Launch options: the sandbox's HTTPS proxy (when set) for plain requests. */
export function realLaunchOptions() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  return {
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
    ...(proxy ? { proxy: { server: proxy, bypass: '127.0.0.1,localhost' } } : {}),
  };
}

function relayRealtime(ws) {
  const up = new WebSocket(ws.url());
  up.binaryType = 'arraybuffer';
  const pending = [];
  up.onopen = () => { for (const m of pending.splice(0)) up.send(m); };
  up.onmessage = (ev) => { try { ws.send(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data)); } catch { /* page gone */ } };
  up.onclose = (ev) => { try { ws.close({ code: ev.code === 1005 ? 1000 : ev.code, reason: ev.reason }); } catch { /* closed */ } };
  up.onerror = () => { try { ws.close({ code: 1011, reason: 'upstream error' }); } catch { /* closed */ } };
  ws.onMessage((m) => { if (up.readyState === 1) up.send(m); else pending.push(m); });
  ws.onClose(() => { try { up.close(); } catch { /* closed */ } });
}

/** One signed-in "person": own browser context, signed in, on Home. */
export async function signedInWindow(browser, creds, device) {
  const context = await browser.newContext(device);
  if (process.env.TP_REALTIME_RELAY === '1') await context.routeWebSocket(/\/realtime\/v1\/websocket/, relayRealtime);
  if (process.env.TP_CAPTURE_NUL) {
    const { appendFileSync } = await import('node:fs');
    await context.route(/document_history_events/, async (route) => {
      const body = route.request().postData() || '';
      if (body.includes('\\u0000')) appendFileSync(process.env.TP_CAPTURE_NUL, `${body}\n`);
      await route.continue();
    });
  }
  const page = await context.newPage();
  const errors = collectErrors(page);
  await page.goto(`${baseUrl()}/`, { waitUntil: 'load' });
  const result = await page.evaluate(async ({ email, password }) => {
    const { supabase } = await import('/src/supabaseClient.js');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? error.message : 'ok';
  }, creds);
  if (result !== 'ok') throw new Error(`sign-in failed: ${result}`);
  await page.reload({ waitUntil: 'load' });
  return { context, page, errors };
}

/** Run a Supabase call with this window's signed-in client (read-mostly). */
export function withClient(page, fn, arg) {
  return page.evaluate(async ({ src, arg: a }) => {
    const { supabase } = await import('/src/supabaseClient.js');
    // eslint-disable-next-line no-new-func
    return new Function('supabase', 'arg', `return (${src})(supabase, arg);`)(supabase, a);
  }, { src: fn.toString(), arg });
}

export const docIdByName = (page, name) => withClient(page, async (sb, n) => {
  const { data } = await sb.from('documents').select('id').eq('name', n).maybeSingle();
  return data?.id || null;
}, name);

/** Home -> Upload -> pick the file. The app opens the new document. */
export async function uploadDocument(page, name, buffer) {
  await page.getByRole('button', { name: 'Upload' }).first().waitFor({ timeout: 60_000 });
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15_000 }),
    page.getByRole('button', { name: 'Upload' }).first().click(),
  ]);
  await chooser.setFiles({ name, mimeType: 'application/pdf', buffer });
  await waitForDocument(page);
}

export async function waitForDocument(page) {
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').first().waitFor({ timeout: 90_000 });
  await page.waitForFunction(() => typeof window.__ydocAnnotationCount === 'number', null, { timeout: 60_000 }).catch(() => {});
  // Live sync is on once the people token shows (presence row written).
  await page.locator('[data-presence-group]').first().waitFor({ timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2500);
}

/** Home: click the row, then Open file. */
export async function openFromHome(page, name) {
  // Already open in a tab (e.g. just uploaded): bring that tab forward.
  const tab = page.locator('[data-pdf-tab-id]').filter({ hasText: name }).first();
  if (await tab.count()) {
    await tab.click();
    await waitForDocument(page);
    return;
  }
  const row = page.getByText(name, { exact: true }).first();
  await row.waitFor({ timeout: 60_000 });
  await row.click();
  await page.getByRole('button', { name: 'Open file' }).first().click();
  await waitForDocument(page);
}

/**
 * Share through the app: Home -> row -> Share -> Invite -> Editor -> email ->
 * Send. Returns what the dialog said. Does not work around a refusal.
 */
export async function shareThroughApp(page, name, email) {
  // (The row menu, not a click on the row: a row whose document is already
  // open in a tab brings that tab to the front.)
  await rowMenu(page, name, 'Share');
  await page.getByRole('button', { name: 'Invite', exact: true }).first().click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Share document' }).first();
  await dialog.waitFor({ timeout: 10_000 });
  await dialog.locator('select').first().selectOption('Editor', { timeout: 5000 }).catch(() => {});
  await dialog.locator('textarea').first().fill(email, { timeout: 5000 }).catch(() => {});
  const send = dialog.getByRole('button', { name: /^Send/ }).first();
  if (await send.isEnabled().catch(() => false)) await send.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const text = (await dialog.innerText().catch(() => '')).replace(/\s+/g, ' ');
  const blocked = /Free plan accounts cannot create invite links[^.]*\.?/.exec(text)?.[0] || null;
  const sent = /(Invite sent|Access granted|sent)/i.test(text) && !blocked;
  for (const label of ['Cancel', 'Done']) {
    const b = page.getByRole('button', { name: label, exact: true }).filter({ visible: true }).first();
    if (await b.count()) await b.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  return { blocked, sent, text: text.slice(0, 400) };
}

/** B's role on the document as the server resolves it. */
export const myRole = (page, docId) => withClient(page, async (sb, id) => {
  const { data } = await sb.rpc('get_my_document_role', { doc_id: id });
  return data || null;
}, docId);

/**
 * The same write the app's invite service makes for an existing account
 * (src/services/documentInviteService.js createDocumentInvite), made by the
 * owner's own session. Used only when the Share dialog refuses because the
 * test accounts are on the Free plan.
 */
export const grantEditor = (ownerPage, docId, email) => withClient(ownerPage, async (sb, { id, mail }) => {
  const { data: { user } } = await sb.auth.getUser();
  const { data: m } = await sb.rpc('check_collaborator_by_email', { email_address: mail });
  const target = Array.isArray(m) ? m[0] : m;
  if (!target?.user_id) return 'no such account';
  const { error } = await sb.from('document_collaborators').upsert({
    document_id: id, user_id: target.user_id, email: mail, role: 'editor', status: 'active', invited_by: user.id,
  }, { onConflict: 'document_id,user_id' });
  return error ? error.message : 'ok';
}, { id: docId, mail: email });

/** People token in the sidebar: faces and their here/idle dots. */
export const presence = (page) => page.evaluate(() => {
  const g = document.querySelector('[data-presence-group]');
  return {
    label: g?.getAttribute('aria-label') || null,
    faces: [...document.querySelectorAll('[data-presence-group] [data-presence-face]')].map((f) => ({
      id: f.getAttribute('data-presence-face'),
      initials: f.firstChild?.textContent?.trim() || '',
      dot: f.querySelector('[data-presence-dot]')?.getAttribute('data-presence-dot') || null,
    })),
  };
});

/** Home ledger: open a row's own "More" (⋮) menu and pick `item`. */
export async function rowMenu(page, name, item) {
  await page.getByText(name, { exact: true }).first().waitFor({ timeout: 30_000 });
  const more = await page.evaluate((n) => {
    const label = [...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent.trim() === n && e.offsetParent);
    let el = label;
    while (el && !el.querySelector('button[aria-label="More"]')) el = el.parentElement;
    const r = el?.querySelector('button[aria-label="More"]')?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  }, name);
  if (!more) throw new Error(`no row menu for ${name}`);
  await page.mouse.click(more.x, more.y);
  await page.getByRole('menuitem', { name: item, exact: true }).first().click();
}

/** Leave the document for Home (the tab strip's Home). */
export async function goHome(page) {
  // A just-uploaded document can take the front again when its upload
  // finishes, so check and repeat.
  for (let i = 0; i < 4; i += 1) {
    await page.getByText('Home', { exact: true }).filter({ visible: true }).first().click();
    await page.waitForTimeout(1500);
    if (!(await page.locator('.survey-pdfjs-page-div').first().isVisible().catch(() => false))) break;
    await page.waitForTimeout(2000);
  }
  await page.getByRole('button', { name: 'Upload' }).filter({ visible: true }).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1000);
}

/**
 * Delete through the app: Home row menu -> Delete -> Move to Archive, then
 * Archive -> Select -> the row -> Delete forever -> Delete forever.
 */
export async function deleteThroughApp(page, name) {
  const vis = (loc) => loc.filter({ visible: true }).first();
  // Close its tab first: a click on the name of an open document goes to its tab.
  const close = page.getByRole('button', { name: `Close ${name}`, exact: true }).first();
  if (await close.count()) { await close.click().catch(() => {}); await page.waitForTimeout(1000); }
  const discard = vis(page.getByRole('button', { name: /^(Close without saving|Don.t save|Discard)/ }));
  if (await discard.count()) await discard.click().catch(() => {});
  await vis(page.getByText('Documents', { exact: true })).click();
  await page.waitForTimeout(1500);
  // Still in Documents (not archived yet): row menu -> Delete -> Move to Archive.
  if (await vis(page.getByText(name, { exact: true })).isVisible().catch(() => false)) {
    await rowMenu(page, name, 'Delete');
    await vis(page.getByRole('button', { name: 'Move to Archive' })).click();
    await page.waitForTimeout(2000);
  }
  await vis(page.getByText('Archive', { exact: true })).click();
  await vis(page.getByText(name, { exact: true })).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1000);
  await vis(page.getByRole('button', { name: 'Select', exact: true })).click();
  const forever = vis(page.getByRole('button', { name: 'Delete forever' }));
  for (let i = 0; i < 4 && !(await forever.isEnabled().catch(() => false)); i += 1) {
    await vis(page.getByText(name, { exact: true })).click();
    await page.waitForTimeout(800);
  }
  await forever.click();
  await vis(page.getByRole('dialog').getByRole('button', { name: 'Delete forever' })).click();
  await page.waitForTimeout(3000);
}
