// "Make available offline" (Nightly flag offline-docs, 2026-11-10; matches
// Drawboard's native apps, /mnt/project-files/drawboard-trial/file-model.md).
// A kept document opens with no signal, marks drawn then are saved on the
// device, and they reach the server once the signal is back. A document that
// is NOT kept still fails to open offline (no silent stale copies).
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS, E2E_BASE_URL, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

const SERVER = new URL(process.env.E2E_SUPABASE_URL || 'http://127.0.0.1:54421');
const PAGE = '.survey-pdfjs-page-div[data-page-number="1"]';
const PAGE_TEXT = 'Type your name in the box:';

async function seedDocument(label) {
  const admin = adminClient();
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const bytes = fs.readFileSync(path.resolve('debug/fixtures/clickable-link-test.pdf'));
  const id = randomUUID();
  const filePath = `${ownerId}/${id}.pdf`;
  const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true });
  if (up.error) throw up.error;
  const name = `E2E ${label} ${Date.now()}.pdf`;
  const doc = await admin.from('documents').insert({
    id, user_id: ownerId, project_id: E2E_PROJECT.id, name, file_path: filePath, file_size: bytes.length, page_count: 1,
  });
  if (doc.error) throw doc.error;
  return {
    id,
    name,
    async remove() {
      await admin.from('documents').delete().eq('id', id);
      await admin.storage.from('documents').remove([filePath]);
    },
  };
}

const savedRows = async (documentId) => {
  const { count } = await adminClient().from('annotation_updates').select('*', { count: 'exact', head: true }).eq('document_id', documentId);
  return count || 0;
};

const pageLines = (page) => page.evaluate(() => [...new Set([...document.querySelectorAll('[data-overlay-page="1"] [data-annotation-id] line')]
  .map((l) => ['x1', 'y1', 'x2', 'y2'].map((k) => Number(l.getAttribute(k)).toFixed(1)).join(',')))]);

async function drawLine(page, row) {
  const box = await page.locator(PAGE).boundingBox();
  const from = { x: box.x + box.width * 0.1, y: box.y + box.height * (0.75 + row * 0.07) };
  const to = { x: from.x + box.width * 0.35, y: from.y };
  await page.keyboard.press('l');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
}

const pageShown = (page) => ((page.viewportSize()?.width || 1400) < 700
  ? page.locator(`${PAGE} canvas`).first()
  : page.getByText(PAGE_TEXT).filter({ visible: true }).first());

async function openDocument(page, name) {
  await startOpen(page, name);
  await expect(pageShown(page)).toBeVisible({ timeout: 60_000 });
}

async function startOpen(page, name) {
  const phone = (page.viewportSize()?.width || 1400) < 700;
  const title = page.getByText(name, { exact: true }).filter({ visible: true }).first();
  if (phone) await title.tap(); else await title.click();
  const openFile = page.getByRole('button', { name: 'Open file' });
  if (phone) {
    if (await openFile.isVisible().catch(() => false)) await openFile.tap();
  } else {
    await openFile.click();
  }
}

async function keepOffline(page, name) {
  const phone = (page.viewportSize()?.width || 1400) < 700;
  if (phone) {
    // The phone row's own ⋮ button (rows have no right-click on a phone).
    const title = page.getByText(name, { exact: true }).filter({ visible: true }).first();
    const row = page.locator('div').filter({ has: title }).filter({ has: page.getByRole('button', { name: 'More' }) }).last();
    await row.getByRole('button', { name: 'More' }).first().tap();
  } else {
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().click({ button: 'right' });
  }
  await page.getByRole('menuitem', { name: 'Make available offline' }).click();
  await expect(page.getByText(`${name} is available offline on this device`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel('Available offline').filter({ visible: true }).first()).toBeVisible();
}

// The phone and desktop apps carry the app itself; only the server is out of
// reach. Block the Supabase host (not the app's own files) to stand in for it.
async function cutServer(context) {
  const block = (route) => route.abort('internetdisconnected');
  const match = (url) => url.host === SERVER.host;
  await context.route(match, block);
  return () => context.unroute(match, block);
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try { localStorage.setItem('survey.flag.offline-docs', '1'); } catch { /* */ }
  });
});

test('a kept document opens with no server; marks drawn then sync when it is back', async ({ page, context }) => {
  test.setTimeout(240_000);
  const kept = await seedDocument('offline kept');
  const notKept = await seedDocument('offline not kept');
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await keepOffline(page, kept.name);

    // One mark saved online first.
    await openDocument(page, kept.name);
    await page.waitForTimeout(1_000);
    await drawLine(page, 0);
    await expect.poll(() => savedRows(kept.id), { timeout: 30_000 }).toBeGreaterThan(0);
    // The first open can write a little more after the mark (its checkpoint
    // notice); wait until nothing new arrives for 3 s.
    let rowsOnline = await savedRows(kept.id);
    for (let quiet = 0; quiet < 3;) {
      await page.waitForTimeout(1_000);
      const now = await savedRows(kept.id);
      if (now === rowsOnline) quiet += 1; else { rowsOnline = now; quiet = 0; }
    }

    // The server goes away and the app restarts (the document reopens itself).
    const restore = await cutServer(context);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText(PAGE_TEXT).filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => pageLines(page), { timeout: 30_000 }).toHaveLength(1);
    await expect(page.getByRole('button', { name: /^Offline copy/ }).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => document.body.getAttribute('data-readonly'))).toBeNull();

    // Draw with no server: it shows and stays on the device.
    await drawLine(page, 1);
    await expect.poll(() => pageLines(page), { timeout: 5_000 }).toHaveLength(2);
    expect(await savedRows(kept.id)).toBe(rowsOnline);

    // The device still says it is online, so the app asks the server again
    // after 30 s. While the server stays out of reach, that try must not tear
    // the open copy down: the tools never lock and the marks stay put.
    await page.evaluate(() => {
      window.__readonlyFlips = 0;
      new MutationObserver((records) => { window.__readonlyFlips += records.length; })
        .observe(document.body, { attributes: true, attributeFilter: ['data-readonly'] });
    });
    // A torn-down store reopens against the server first (its mark tables).
    const storeReads = [];
    const onRequest = (request) => { if (/\/rest\/v1\/annotation_/.test(request.url())) storeReads.push(request.url()); };
    page.on('request', onRequest);
    await page.waitForTimeout(35_000);
    page.off('request', onRequest);
    expect(storeReads).toEqual([]);
    expect(await page.evaluate(() => window.__readonlyFlips)).toBe(0);
    // The sync light (a compact dot when the side panel is closed) still
    // reads Offline copy: the 30 s autosave's flush must not turn it to an error.
    await expect(page.getByRole('button', { name: /^Offline copy/ }).filter({ visible: true }).first()).toBeVisible();
    expect(await pageLines(page)).toHaveLength(2);

    // Restart again, still offline: both marks come back from the device copy.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText(PAGE_TEXT).filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => pageLines(page), { timeout: 30_000 }).toHaveLength(2);

    // The Documents list still shows the kept document, and it opens from there.
    await page.getByRole('button', { name: `Close ${kept.name}` }).click();
    await expect(page.getByText(kept.name, { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    await openDocument(page, kept.name);
    await expect.poll(() => pageLines(page), { timeout: 30_000 }).toHaveLength(2);

    // Server back (and the browser says so): the offline mark is sent.
    await restore();
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByText('Offline copy').filter({ visible: true })).toHaveCount(0, { timeout: 30_000 });

    // Another device (a fresh browser with nothing kept) sees both marks, so
    // the offline mark really reached the server.
    const other = await page.context().browser().newContext({ baseURL: E2E_BASE_URL, viewport: { width: 1400, height: 900 } });
    try {
      await other.route((url) => !['data:', 'blob:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname), (route) => route.abort('blockedbyclient'));
      const second = await other.newPage();
      await signIn(second, E2E_ACCOUNTS.owner);
      await openDocument(second, kept.name);
      await expect.poll(() => pageLines(second), { timeout: 60_000 }).toHaveLength(2);
    } finally {
      await other.close();
    }

  } finally {
    await kept.remove();
    await notKept.remove();
  }
});

// The device reports no connection (navigator.onLine false). Playwright's
// setOffline would also cut the dev server's own files (pdf.js worker), which
// the phone and desktop apps carry inside them, so cut only the server.
async function deviceOffline(page, context) {
  const restore = await cutServer(context);
  await page.evaluate(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
  return restore;
}

for (const layout of [
  { name: 'desktop', use: {} },
  { name: 'phone web', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  // The phone app's own layout (Capacitor shell faked: native plugins are not
  // real here, the CI device walk covers those).
  { name: 'iOS app', native: 'ios', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  { name: 'Android app', native: 'android', use: { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true } },
]) {
  test.describe(layout.name, () => {
    test.use(layout.use);
    if (layout.native) {
      test.beforeEach(async ({ context }) => {
        await context.addInitScript((platform) => {
          window.Capacitor = {
            isNativePlatform: () => true,
            getPlatform: () => platform,
            isPluginAvailable: () => false,
            Plugins: {},
          };
        }, layout.native);
      });
    }
    test(`with the device offline, only kept documents open (${layout.name})`, async ({ page, context }) => {
      test.setTimeout(180_000);
      const kept = await seedDocument('offline device kept');
      const notKept = await seedDocument('offline device not kept');
      try {
        await signIn(page, E2E_ACCOUNTS.owner);
        await keepOffline(page, kept.name);
        await deviceOffline(page, context);

        let serverAsked = false;
        page.on('request', (r) => { if (new URL(r.url()).host === SERVER.host && /\/storage\/v1\//.test(r.url())) serverAsked = true; });
        await openDocument(page, kept.name);
        await expect(page.getByText('No signal: opened your offline copy', { exact: false }).first()).toBeVisible({ timeout: 30_000 });
        expect(serverAsked, 'the kept PDF opened without asking the server').toBe(false);
        if (!layout.use.isMobile) {
          await page.getByRole('button', { name: `Close ${kept.name}` }).click();
        } else {
          await page.getByRole('button', { name: 'Back to documents' }).first().tap();
        }

        // Not kept: the PDF does not open from any stale copy.
        await startOpen(page, notKept.name);
        // It says the device is offline, not that the file may be corrupted.
        await expect(page.getByText('You’re offline').filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
        await expect(page.getByText(/isn’t kept on this device/).filter({ visible: true }).first()).toBeVisible();
        await expect(page.getByText(/may be corrupted/)).toHaveCount(0);
      } finally {
        await kept.remove();
        await notKept.remove();
      }
    });
  });
}
