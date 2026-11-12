// Google Drive files that save back (Nightly flag 'drive-sync-back', next to
// OneDrive; Drawboard's file model, /mnt/project-files/drawboard-trial/file-model/).
// The real app picks a PDF in Google's Picker, opens it, draws on it and saves
// the marked-up PDF back with "Sync to Google Drive now"; a change made in
// Google Drive meanwhile raises the conflict dialog, and a file put in the bin
// the "gone" dialog.
//
// Google's Picker is an iframe from docs.google.com, so it is stood in for by
// a stub with the same API (window.google.picker). The sheet-sync function is
// answered by the SAME server code (driveAction) against the local database,
// with a fake Drive v3 behind it; the app's own download (with the token) and
// resumable upload of the PDF bytes go to that fake Drive.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument, PDFName } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';
import { createGoogleDriveClient, driveAction, DriveError } from '../../supabase/functions/_shared/driveFiles/service.js';

const PAGE = '.survey-pdfjs-page-div[data-page-number="1"]';
const FIXTURE = fs.readFileSync('debug/fixtures/clickable-link-test.pdf');
const GAPI = 'https://www.fake-googleapis.test';
const UPLOAD = 'https://upload.fake-googleapis.test';
const FILE_ID = 'GFILE1';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,PUT,POST,PATCH,OPTIONS', 'Access-Control-Expose-Headers': '*' };

async function savedSubtypes(bytes) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const annots = pdf.getPage(0).node.Annots();
  if (!annots) return [];
  return annots.asArray().map((ref) => String(pdf.context.lookup(ref).get(PDFName.of('Subtype')) || '').replace('/', ''));
}

const pageLines = (page) => page.evaluate(() => [...new Set([...document.querySelectorAll('[data-overlay-page="1"] [data-annotation-id] line')]
  .map((l) => ['x1', 'y1', 'x2', 'y2'].map((k) => Number(l.getAttribute(k)).toFixed(1)).join(',')))]);

/* One PDF in a fake Google Drive: bytes, head revision, edit rights, bin. */
function fakeGoogleDrive(fileName) {
  const d = { files: new Map(), sessions: new Map(), puts: 0, origins: [], downloadsWithToken: 0 };
  d.files.set(FILE_ID, { name: fileName, bytes: Buffer.concat([FIXTURE, Buffer.from(`\n% ${fileName}\n`)]), rev: 1, canEdit: true, trashed: false });
  const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  // The server's calls (node fetch, never through the browser).
  d.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    if (init.headers?.Authorization !== 'Bearer gtok-e2e') return json(401, { error: { code: 401 } });
    const up = new RegExp(`^${GAPI}/upload/drive/v3/files/([^?]+)\\?uploadType=resumable`).exec(url);
    if (up && method === 'PATCH') {
      d.origins.push(init.headers.Origin || null);
      const session = `${UPLOAD}/s/${up[1]}/${d.sessions.size + d.puts + 1}`;
      d.sessions.set(session, up[1]);
      return new Response('', { status: 200, headers: { Location: session } });
    }
    const m = new RegExp(`^${GAPI}/drive/v3/files/([^?]+)\\?`).exec(url);
    const f = m && d.files.get(m[1]);
    if (!f) return json(404, { error: { code: 404, errors: [{ reason: 'notFound' }] } });
    return json(200, {
      id: m[1], name: f.name, mimeType: 'application/pdf', size: String(f.bytes.length), headRevisionId: `rev-${f.rev}`,
      modifiedTime: new Date().toISOString(), webViewLink: `https://drive.example/file/${m[1]}/view`, trashed: f.trashed,
      capabilities: { canEdit: f.canEdit }, lastModifyingUser: { displayName: 'Pat Manager' },
    });
  };
  d.editInGoogleDrive = () => { const f = d.files.get(FILE_ID); f.rev += 1; f.bytes = Buffer.concat([f.bytes, Buffer.from('\n% edited in Google Drive\n')]); };
  d.putInBin = () => { d.files.get(FILE_ID).trashed = true; };
  return d;
}

/* Google's Picker, stood in for: it "picks" the file as soon as it is shown. */
async function stubPicker(context, fileId) {
  await context.addInitScript((id) => {
    window.__picker = { shown: 0 };
    const Response = { ACTION: 'action', DOCUMENTS: 'docs' };
    const Action = { PICKED: 'picked', CANCEL: 'cancel' };
    const Document = { ID: 'id', NAME: 'name' };
    class DocsView {
      setMimeTypes(m) { window.__picker.mime = m; return this; }
      setIncludeFolders() { return this; }
      setSelectFolderEnabled() { return this; }
    }
    class PickerBuilder {
      addView() { return this; }
      setOAuthToken(t) { window.__picker.token = t; return this; }
      setTitle() { return this; }
      setCallback(cb) { this.cb = cb; return this; }
      setDeveloperKey(k) { window.__picker.key = k; return this; }
      setAppId(a) { window.__picker.appId = a; return this; }
      build() {
        const { cb } = this;
        return { setVisible() { window.__picker.shown += 1; setTimeout(() => cb({ action: 'picked', docs: [{ id, name: 'picked.pdf' }] }), 50); } };
      }
    }
    window.google = { picker: { DocsView, PickerBuilder, ViewId: { DOCS: 'docs' }, Response, Action, Document } };
  }, fileId);
}

async function serveDriveActions(context, drive) {
  const admin = adminClient();
  await context.route('**/functions/v1/sheet-sync', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = request.postDataJSON() || {};
    const token = (request.headers().authorization || '').replace(/^Bearer /, '');
    const reply = (status, data) => route.fulfill({ status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!String(body.action || '').startsWith('drive')) {
      if (body.action === 'status') return reply(200, { google: { connected: true, email: null }, microsoft: { connected: false } });
      return reply(400, { error: 'not in this test' });
    }
    const { data: who } = await admin.auth.getUser(token);
    if (!who?.user) return reply(401, { error: 'Sign in first.' });
    const userDb = createClient(process.env.E2E_SUPABASE_URL, process.env.E2E_SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { action, ...rest } = body;
    try {
      const out = await driveAction({
        user: who.user, userDb, service: admin, env: { GOOGLE_SHEETS_CLIENT_ID: '123456789012-e2e.apps.googleusercontent.com' }, body: { action, ...rest },
        driveClientFor: async (_uid, provider) => {
          if (provider !== 'google') throw new DriveError('Connect Microsoft first.', 409, 'not_connected');
          return createGoogleDriveClient({ getAccessToken: async () => 'gtok-e2e', fetch: drive.fetch, baseUrl: GAPI });
        },
      });
      return reply(200, out);
    } catch (err) {
      if (err instanceof DriveError) return reply(err.status, { error: err.message, code: err.code });
      return reply(500, { error: String(err?.message || err) });
    }
  });
  // The app's own download (with the short-lived token) of the PDF bytes.
  await context.route(`${GAPI}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const m = /\/drive\/v3\/files\/([^?]+)\?alt=media/.exec(request.url());
    const f = m && drive.files.get(m[1]);
    if (!f || request.method() !== 'GET') return route.fulfill({ status: 404, headers: CORS, body: '' });
    if (request.headers().authorization !== 'Bearer gtok-e2e') return route.fulfill({ status: 401, headers: CORS, body: '' });
    drive.downloadsWithToken += 1;
    return route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'application/pdf' }, body: f.bytes });
  });
  // The app's PUT to the resumable upload.
  await context.route(`${UPLOAD}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = request.url();
    if (request.method() !== 'PUT' || !drive.sessions.has(url)) return route.fulfill({ status: 404, headers: CORS, body: '' });
    const id = drive.sessions.get(url);
    const f = drive.files.get(id);
    f.bytes = request.postDataBuffer();
    f.rev += 1;
    drive.puts += 1;
    drive.sessions.delete(url);
    return route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name: f.name }) });
  });
}

async function flagOn(on) {
  await adminClient().from('feature_flags').update({ mode: on ? 'on' : 'off' }).eq('key', 'drive-sync-back');
}

async function drawLine(page, row) {
  const box = await page.locator(PAGE).boundingBox();
  const from = { x: box.x + box.width * 0.1, y: box.y + box.height * (0.75 + row * 0.06) };
  await page.keyboard.press('l');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + box.width * 0.35, from.y, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
}

async function cleanup(name) {
  const admin = adminClient();
  const { data } = await admin.from('documents').select('id,file_path').eq('name', name);
  for (const row of data || []) {
    await admin.from('documents').delete().eq('id', row.id);
    if (row.file_path) await admin.storage.from('documents').remove([row.file_path]);
  }
}

test.use({ actionTimeout: 20_000 });

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try { localStorage.setItem('survey.flag.drive-sync-back', '1'); } catch { /* */ }
  });
  await stubPicker(context, FILE_ID);
});

test('open from Google Drive, draw, Sync now writes the marked-up PDF back; a Google Drive edit raises the conflict dialog; the bin the gone dialog', async ({ page, context }) => {
  test.setTimeout(240_000);
  const name = `E2E Google Drive plan ${Date.now()}.pdf`;
  const drive = fakeGoogleDrive(name);
  await flagOn(true);
  try {
    await serveDriveActions(context, drive);
    await signIn(page, E2E_ACCOUNTS.owner);

    // Home: Google Drive › Google's Picker › the PDF.
    await page.getByRole('button', { name: 'Open from Google Drive' }).filter({ visible: true }).first().click();
    await expect(page.getByText(`${name} opened from Google Drive`, { exact: false })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(PAGE).first()).toBeVisible({ timeout: 60_000 });
    const picker = await page.evaluate(() => window.__picker);
    expect(picker).toMatchObject({ shown: 1, token: 'gtok-e2e', appId: '123456789012', key: 'e2e-fake-picker-key', mime: 'application/pdf' });
    expect(drive.downloadsWithToken).toBe(1);
    const { data: docs } = await adminClient().from('documents').select('id').eq('name', name);
    expect(docs?.length).toBe(1);
    const { data: linkRow } = await adminClient().from('document_drive_links').select('provider,drive_id,item_id,etag').eq('document_id', docs[0].id).maybeSingle();
    expect(linkRow).toMatchObject({ provider: 'google', drive_id: 'google', item_id: FILE_ID, etag: 'rev-1' });

    // Draw, then Sync to Google Drive now: the file in Drive is the marked-up PDF.
    const button = page.locator('[data-drive-sync-button="true"]');
    await expect(button).toBeVisible({ timeout: 20_000 });
    await expect(button).toHaveAttribute('aria-label', /^Google Drive:/);
    await page.waitForTimeout(1_000);
    await drawLine(page, 0);
    await expect.poll(() => pageLines(page)).toHaveLength(1);
    await button.click();
    const card = page.locator('[data-drive-sync-card="true"]');
    await expect(card.getByText('Changes not saved to Google Drive yet.')).toBeVisible({ timeout: 20_000 });
    await card.getByRole('button', { name: 'Sync to Google Drive now' }).click();
    await expect(card.getByText(/Saved to Google Drive/)).toBeVisible({ timeout: 60_000 });
    expect(drive.puts).toBe(1);
    expect(drive.origins.at(-1)).toBe(new URL(page.url()).origin);
    const saved = drive.files.get(FILE_ID).bytes;
    expect(saved.toString('latin1').startsWith('%PDF')).toBe(true);
    expect(await savedSubtypes(saved)).toContain('Line');
    await expect(card.getByRole('link', { name: 'Open in Google Drive' })).toHaveAttribute('href', `https://drive.example/file/${FILE_ID}/view`);
    await card.getByRole('button', { name: 'Close', exact: true }).last().click();

    // Someone edits the file in Google Drive; the next save asks first.
    drive.editInGoogleDrive();
    await drawLine(page, 1);
    await expect.poll(() => pageLines(page)).toHaveLength(2);
    await button.click();
    await card.getByRole('button', { name: 'Sync to Google Drive now' }).click();
    const conflict = page.locator('[data-drive-dialog="conflict"]');
    await expect(conflict).toBeVisible({ timeout: 30_000 });
    await expect(conflict.getByText('This file changed in Google Drive')).toBeVisible();
    expect(drive.puts).toBe(1);
    await conflict.getByRole('button', { name: 'Keep Survey’s version' }).click();
    await expect.poll(() => drive.puts, { timeout: 30_000 }).toBe(2);
    expect(drive.files.get(FILE_ID).bytes.toString('latin1')).not.toContain('edited in Google Drive');

    // The file goes in the bin: the gone dialog, and Unlink keeps the document.
    drive.putInBin();
    await drawLine(page, 2);
    await expect.poll(() => pageLines(page)).toHaveLength(3);
    await button.click();
    await card.getByRole('button', { name: 'Sync to Google Drive now' }).click();
    const gone = page.locator('[data-drive-dialog="gone"]');
    await expect(gone).toBeVisible({ timeout: 30_000 });
    await expect(gone.getByText('The Google Drive file is gone')).toBeVisible();
    await gone.getByRole('button', { name: 'Unlink' }).click();
    await expect(button).toHaveCount(0, { timeout: 20_000 });
    await expect.poll(() => pageLines(page)).toHaveLength(3);
  } finally {
    await flagOn(false);
    await cleanup(name);
  }
});

test('flag off: no Google Drive entry on Home', async ({ page, context }) => {
  await context.addInitScript(() => { try { localStorage.setItem('survey.flag.drive-sync-back', '0'); } catch { /* */ } });
  await signIn(page, E2E_ACCOUNTS.owner);
  await expect(page.getByRole('heading', { name: 'Documents' }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Open from Google Drive' })).toHaveCount(0);
});

for (const layout of [
  { name: 'phone web', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  { name: 'iOS app', native: 'ios', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  { name: 'Android app', native: 'android', use: { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true } },
]) {
  test.describe(layout.name, () => {
    test.use(layout.use);
    if (layout.native) {
      test.beforeEach(async ({ context }) => {
        await context.addInitScript((platform) => {
          window.Capacitor = { isNativePlatform: () => true, getPlatform: () => platform, isPluginAvailable: () => false, Plugins: {} };
        }, layout.native);
      });
    }
    test(`open from Google Drive and Sync now on a phone (${layout.name})`, async ({ page, context }) => {
      test.setTimeout(180_000);
      const name = `E2E Google Drive phone ${Date.now()}.pdf`;
      const drive = fakeGoogleDrive(name);
      await flagOn(true);
      try {
        await serveDriveActions(context, drive);
        await signIn(page, E2E_ACCOUNTS.owner);
        await page.locator('[data-home-new="phone"]').filter({ visible: true }).first().tap();
        await page.getByRole('menuitem', { name: 'Open from Google Drive' }).tap();
        await expect(page.locator(`${PAGE} canvas`).first()).toBeVisible({ timeout: 60_000 });
        await page.waitForTimeout(1_500);
        await drawLine(page, 0);
        await expect.poll(() => pageLines(page), { timeout: 5_000 }).toHaveLength(1);
        const button = page.locator('[data-drive-sync-button="phone"]');
        await expect(button).toBeVisible({ timeout: 20_000 });
        await expect(button).toHaveAttribute('aria-label', 'Google Drive');
        await button.tap();
        const card = page.locator('[data-drive-sync-card="true"]');
        await card.getByRole('button', { name: 'Sync to Google Drive now' }).tap();
        await expect(card.getByText(/Saved to Google Drive/)).toBeVisible({ timeout: 60_000 });
        expect(drive.puts).toBe(1);
        expect(await savedSubtypes(drive.files.get(FILE_ID).bytes)).toContain('Line');
        await page.screenshot({ path: `test-results/e2e-signed-in/google-drive-sync-back-${layout.name.replace(' ', '-')}.png` });
      } finally {
        await flagOn(false);
        await cleanup(name);
      }
    });
  });
}
