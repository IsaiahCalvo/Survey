// OneDrive files that save back (Nightly flag 'drive-sync-back'; Drawboard's
// file model, /mnt/project-files/drawboard-trial/file-model/drive-sync-back-plan.md).
// The real app opens a PDF from OneDrive, draws on it, and saves the marked-up
// PDF back with "Sync to OneDrive now"; a change made in OneDrive meanwhile
// raises the conflict dialog, and a deleted file the "gone" dialog.
//
// The edge runtime does not run in this stack, so the sheet-sync function is
// answered here by the SAME server code (driveAction) against the local
// database, with a fake Microsoft Graph behind it. The app's own download and
// upload of the PDF bytes go to that fake Graph's links.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument, PDFName } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';
import { createDriveClient, driveAction, DriveError } from '../../supabase/functions/_shared/driveFiles/service.js';

const PAGE = '.survey-pdfjs-page-div[data-page-number="1"]';
const FIXTURE = fs.readFileSync('debug/fixtures/clickable-link-test.pdf');
const GRAPH = 'https://graph.fake-onedrive.test/v1.0';
const FILES = 'https://files.fake-onedrive.test';
const DRIVE = 'b!e2edrive';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS', 'Access-Control-Expose-Headers': '*' };

/* The /Subtype of each annotation on page 1 of a saved PDF. */
async function savedSubtypes(bytes) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const annots = pdf.getPage(0).node.Annots();
  if (!annots) return [];
  return annots.asArray().map((ref) => String(pdf.context.lookup(ref).get(PDFName.of('Subtype')) || '').replace('/', ''));
}

const pageLines = (page) => page.evaluate(() => [...new Set([...document.querySelectorAll('[data-overlay-page="1"] [data-annotation-id] line')]
  .map((l) => ['x1', 'y1', 'x2', 'y2'].map((k) => Number(l.getAttribute(k)).toFixed(1)).join(',')))]);

/* A one-folder OneDrive: Plans/<name>. Bytes, version (eTag) and uploads. */
function fakeOneDrive(fileName) {
  const d = { items: new Map(), uploads: new Map(), puts: 0 };
  // Unique bytes: Survey keeps one document per file content, and the
  // fixture is also the seeded sample drawing.
  d.items.set('PLAN1', { name: fileName, bytes: Buffer.concat([FIXTURE, Buffer.from(`\n% ${fileName}\n`)]), version: 1, folder: 'Plans' });
  const item = (id, it) => ({
    id, name: it.name, eTag: `"{${id}},${it.version}"`, size: it.bytes.length, webUrl: `https://contoso.example/Plans/${encodeURIComponent(it.name)}`,
    file: { mimeType: 'application/pdf' }, parentReference: { driveId: DRIVE }, lastModifiedDateTime: new Date().toISOString(),
    '@microsoft.graph.downloadUrl': `${FILES}/dl/${id}?v=${it.version}`,
  });
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  d.graphFetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const path = decodeURIComponent(url.slice(GRAPH.length + 1)).replace(/\?.*$/, '');
    if (method === 'GET' && path === 'me/drive/root/children') return json(200, { value: [{ name: 'Plans', folder: { childCount: 1 } }] });
    if (method === 'GET' && path === 'me/drive/root:/Plans:/children') {
      return json(200, { value: [...d.items].filter(([, it]) => it.folder === 'Plans').map(([id, it]) => item(id, it)) });
    }
    const m = /^drives\/([^/]+)\/items\/([^/]+)(\/createUploadSession)?$/.exec(path);
    if (!m || !d.items.has(m[2])) return json(404, { error: { code: 'itemNotFound' } });
    const id = m[2];
    const it = d.items.get(id);
    if (!m[3]) return json(200, item(id, it));
    const ifMatch = init.headers?.['If-Match'];
    if (ifMatch && ifMatch !== item(id, it).eTag) return json(412, { error: { code: 'resourceModified' } });
    const uploadUrl = `${FILES}/up/${id}/${d.uploads.size + d.puts + 1}`;
    d.uploads.set(uploadUrl, id);
    return json(200, { uploadUrl, expirationDateTime: new Date(Date.now() + 3_600_000).toISOString() });
  };
  d.editInOneDrive = () => { const it = d.items.get('PLAN1'); it.version += 1; it.bytes = Buffer.concat([it.bytes, Buffer.from('\n% edited in OneDrive\n')]); };
  d.remove = () => d.items.delete('PLAN1');
  return d;
}

/* Answer the app's sheet-sync calls with the real drive actions. */
async function serveDriveActions(context, drive) {
  const admin = adminClient();
  await context.route('**/functions/v1/sheet-sync', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = request.postDataJSON() || {};
    const token = (request.headers().authorization || '').replace(/^Bearer /, '');
    const reply = (status, data) => route.fulfill({ status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!String(body.action || '').startsWith('drive')) {
      // Microsoft is connected for this account (the connect flow has its own tests).
      if (body.action === 'status') return reply(200, { microsoft: { connected: true, email: null } });
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
        user: who.user, userDb, service: admin, env: {}, body: { action, ...rest },
        driveClientFor: async () => createDriveClient({ getAccessToken: async () => 'tok-e2e', fetch: drive.graphFetch, baseUrl: GRAPH }),
      });
      return reply(200, out);
    } catch (err) {
      if (err instanceof DriveError) return reply(err.status, { error: err.message, code: err.code });
      return reply(500, { error: String(err?.message || err) });
    }
  });
  // The app's own download and upload of the PDF bytes.
  await context.route(`${FILES}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = request.url();
    const dl = /\/dl\/([^/?]+)/.exec(url);
    if (dl && request.method() === 'GET') {
      const it = drive.items.get(dl[1]);
      if (!it) return route.fulfill({ status: 404, headers: CORS, body: '' });
      return route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'application/pdf' }, body: it.bytes });
    }
    if (request.method() === 'PUT' && drive.uploads.has(url)) {
      const id = drive.uploads.get(url);
      const it = drive.items.get(id);
      if (!it) return route.fulfill({ status: 404, headers: CORS, body: '' });
      it.bytes = request.postDataBuffer();
      it.version += 1;
      drive.puts += 1;
      drive.uploads.delete(url);
      return route.fulfill({ status: 201, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name: it.name }) });
    }
    return route.fulfill({ status: 404, headers: CORS, body: '' });
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
});

test('open from OneDrive, draw, Sync now writes the marked-up PDF back; a OneDrive edit raises the conflict dialog; a deleted file the gone dialog', async ({ page, context }) => {
  test.setTimeout(240_000);
  const name = `E2E OneDrive plan ${Date.now()}.pdf`;
  const drive = fakeOneDrive(name);
  await flagOn(true);
  try {
    await serveDriveActions(context, drive);
    await signIn(page, E2E_ACCOUNTS.owner);

    // Home: OneDrive › Plans › the PDF.
    await page.getByRole('button', { name: 'Open from OneDrive' }).filter({ visible: true }).first().click();
    const picker = page.locator('[data-drive-picker="true"]');
    await picker.getByRole('listitem').filter({ hasText: 'Plans' }).click();
    await picker.locator(`[data-drive-file="${name}"]`).click();
    await expect(page.getByText(`${name} opened from OneDrive`, { exact: false })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(PAGE).first()).toBeVisible({ timeout: 60_000 });
    const { data: docs } = await adminClient().from('documents').select('id').eq('name', name);
    expect(docs?.length).toBe(1);
    const { data: linkRow } = await adminClient().from('document_drive_links').select('drive_id,item_id,etag').eq('document_id', docs[0].id).maybeSingle();
    expect(linkRow).toMatchObject({ drive_id: DRIVE, item_id: 'PLAN1', etag: '"{PLAN1},1"' });

    // Draw, then Sync to OneDrive now: the file in OneDrive is the marked-up PDF.
    const button = page.locator('[data-drive-sync-button="true"]');
    await expect(button).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1_000);
    await drawLine(page, 0);
    await expect.poll(() => pageLines(page)).toHaveLength(1);
    await button.click();
    const card = page.locator('[data-drive-sync-card="true"]');
    await expect(card.getByText('Changes not saved to OneDrive yet.')).toBeVisible({ timeout: 20_000 });
    await card.getByRole('button', { name: 'Sync to OneDrive now' }).click();
    await expect(card.getByText(/Saved to OneDrive/)).toBeVisible({ timeout: 60_000 });
    expect(drive.puts).toBe(1);
    const savedBytes = drive.items.get('PLAN1').bytes;
    expect(savedBytes.toString('latin1').startsWith('%PDF')).toBe(true);
    expect(await savedSubtypes(savedBytes)).toContain('Line');
    await card.getByRole('button', { name: 'Close', exact: true }).last().click();

    // Someone edits the file in OneDrive; the next save asks first.
    drive.editInOneDrive();
    await drawLine(page, 1);
    await expect.poll(() => pageLines(page)).toHaveLength(2);
    await button.click();
    await card.getByRole('button', { name: 'Sync to OneDrive now' }).click();
    const conflict = page.locator('[data-drive-dialog="conflict"]');
    await expect(conflict).toBeVisible({ timeout: 30_000 });
    expect(drive.puts).toBe(1);
    await conflict.getByRole('button', { name: 'Keep Survey’s version' }).click();
    await expect.poll(() => drive.puts, { timeout: 30_000 }).toBe(2);
    expect(drive.items.get('PLAN1').bytes.toString('latin1')).not.toContain('edited in OneDrive');

    // The file is deleted in OneDrive: the gone dialog, and Unlink keeps the document.
    drive.remove();
    await drawLine(page, 2);
    await expect.poll(() => pageLines(page)).toHaveLength(3);
    await button.click();
    await card.getByRole('button', { name: 'Sync to OneDrive now' }).click();
    const gone = page.locator('[data-drive-dialog="gone"]');
    await expect(gone).toBeVisible({ timeout: 30_000 });
    await gone.getByRole('button', { name: 'Unlink' }).click();
    await expect(button).toHaveCount(0, { timeout: 20_000 });
    const { data: after } = await adminClient().from('document_drive_links').select('document_id').eq('document_id', docs[0].id);
    expect(after).toEqual([]);
    await expect.poll(() => pageLines(page)).toHaveLength(3);
  } finally {
    await flagOn(false);
    await cleanup(name);
  }
});

test('flag off: no OneDrive entry on Home', async ({ page, context }) => {
  await context.addInitScript(() => { try { localStorage.setItem('survey.flag.drive-sync-back', '0'); } catch { /* */ } });
  await signIn(page, E2E_ACCOUNTS.owner);
  await expect(page.getByRole('heading', { name: 'Documents' }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Open from OneDrive' })).toHaveCount(0);
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
    test(`open from OneDrive and Sync now on a phone (${layout.name})`, async ({ page, context }) => {
      test.setTimeout(180_000);
      const name = `E2E OneDrive phone ${Date.now()}.pdf`;
      const drive = fakeOneDrive(name);
      await flagOn(true);
      try {
        await serveDriveActions(context, drive);
        await signIn(page, E2E_ACCOUNTS.owner);
        await page.locator('[data-home-new="phone"]').filter({ visible: true }).first().tap();
        await page.getByRole('menuitem', { name: 'Open from OneDrive' }).tap();
        const picker = page.locator('[data-drive-picker="true"]');
        await picker.getByRole('listitem').filter({ hasText: 'Plans' }).tap();
        await picker.locator(`[data-drive-file="${name}"]`).tap();
        await expect(page.locator(`${PAGE} canvas`).first()).toBeVisible({ timeout: 60_000 });
        await page.waitForTimeout(1_500);
        await drawLine(page, 0);
        await expect.poll(() => pageLines(page), { timeout: 5_000 }).toHaveLength(1);
        const button = page.locator('[data-drive-sync-button="phone"]');
        await expect(button).toBeVisible({ timeout: 20_000 });
        await button.tap();
        const card = page.locator('[data-drive-sync-card="true"]');
        await card.getByRole('button', { name: 'Sync to OneDrive now' }).tap();
        await expect(card.getByText(/Saved to OneDrive/)).toBeVisible({ timeout: 60_000 });
        expect(drive.puts).toBe(1);
        expect(await savedSubtypes(drive.items.get('PLAN1').bytes)).toContain('Line');
        await page.screenshot({ path: `test-results/e2e-signed-in/drive-sync-back-${layout.name.replace(' ', '-')}.png` });
      } finally {
        await flagOn(false);
        await cleanup(name);
      }
    });
  });
}
