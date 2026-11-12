// Pages as records (Nightly 'page-records', src/utils/pageRecords.js).
// Drawboard never rewrites the PDF when pages change; with this flag Survey
// doesn't either. A page change saves a page list with the marks, so:
//   - the other window follows at once, with no reload and no "being changed
//     in another window" wait;
//   - nothing is uploaded and the stored PDF stays byte for byte the same;
//   - a page change made offline is sent when the signal is back;
//   - a reload shows the changed pages, and Export builds a PDF with them.
// The other window is checked on desktop, phone web and both phone apps.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import fs from 'node:fs';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

const BLOCKED = 'Pages are being changed in another window.';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);
// Three pages that tell themselves apart by shape: wide, tall, square.
const SIZES = [[792, 612], [612, 792], [400, 400]];

async function seedThreePagePdf(label) {
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  SIZES.forEach(([w, h], i) => {
    const p = pdf.addPage([w, h]);
    p.drawText(`${label} page ${i + 1}`, { x: 40, y: h - 60, size: 18, font });
  });
  const bytes = Buffer.from(await pdf.save());
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  const id = crypto.randomUUID();
  const path = `${user.id}/${id}.pdf`;
  const name = `${label} ${RUN} ${id.slice(0, 6)}.pdf`;
  await must('upload', admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id, user_id: user.id, name, file_path: path, file_size: bytes.length, page_count: SIZES.length, content_sha256: sha,
  }));
  return {
    id, name, path, sha,
    storedSha: async () => {
      const { data: row } = await admin.from('documents').select('file_path, content_sha256').eq('id', id).maybeSingle();
      const { data: blob } = await admin.storage.from('documents').download(row.file_path);
      return { path: row.file_path, rowSha: row.content_sha256, bytesSha: crypto.createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex') };
    },
    remove: async () => {
      await admin.from('documents').delete().eq('id', id);
      await admin.storage.from('documents').remove([path]);
    },
  };
}

const pageDiv = (page, n) => page.locator(`.survey-pdfjs-page-div[data-page-number="${n}"]`).filter({ visible: true }).first();

/** Each page's shape as the viewer lays it out: 'wide' | 'tall' | 'square'. */
const shapes = (page) => page.evaluate(() => {
  const seen = new Map();
  for (const el of document.querySelectorAll('.survey-pdfjs-page-div[data-page-number]')) {
    if (!el.offsetParent) continue;
    const n = Number(el.getAttribute('data-page-number'));
    const r = el.getBoundingClientRect();
    if (seen.has(n) || r.width < 10) continue;
    const ratio = r.width / r.height;
    seen.set(n, ratio > 1.1 ? 'wide' : ratio < 0.9 ? 'tall' : 'square');
  }
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s);
});

async function openDoc(page, name, phone = false) {
  const title = page.getByText(name, { exact: true }).filter({ visible: true }).first();
  if (phone) await title.tap(); else await title.click();
  const open = page.getByRole('button', { name: 'Open file' }).filter({ visible: true }).first();
  if (await open.isVisible().catch(() => false)) await (phone ? open.tap() : open.click()).catch(() => {});
  await expect(pageDiv(page, 1).locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);
}

async function pageMenu(page, n, item) {
  await page.mouse.click(5, 450);
  await page.keyboard.press('v');
  const pd = pageDiv(page, n);
  await pd.scrollIntoViewIfNeeded();
  const box = await pd.boundingBox();
  await pd.click({ button: 'right', position: { x: box.width * 0.97, y: box.height * 0.985 } });
  await page.getByRole('menuitem', { name: item, exact: true }).filter({ visible: true }).first().click();
}

async function newWindow(browser, layout = null) {
  const ctx = await browser.newContext(layout
    ? { viewport: layout.viewport, hasTouch: !!layout.hasTouch, isMobile: !!layout.isMobile }
    : { viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript(() => {
    try {
      for (const key of ['page-records', 'page-op-sync', 'export-modes']) localStorage.setItem(`survey.flag.${key}`, '1');
    } catch { /* none */ }
  });
  if (layout?.native) {
    await ctx.addInitScript((platform) => {
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => platform, isPluginAvailable: () => false, Plugins: {} };
    }, layout.native);
  }
  await ctx.route((url) => !['data:', 'blob:'].includes(url.protocol) && !LOCAL_HOSTS.has(url.hostname), (route) => route.abort('blockedbyclient'));
  // Every PDF upload either window makes (there must be none).
  const uploads = [];
  await ctx.route('**/storage/v1/object/**', async (route) => {
    const method = route.request().method();
    // POST /object/sign/ only asks for a download link.
    const url = route.request().url();
    if ((method === 'POST' || method === 'PUT') && !url.includes('/object/sign/')) uploads.push(url);
    await route.fallback();
  });
  return { ctx, uploads };
}

test.use({ actionTimeout: 10_000 });

test('page changes follow in the other window at once, upload nothing, and export right', async ({ browser }) => {
  test.setTimeout(360_000);
  const sheet = await seedThreePagePdf('Page records');
  const A = await newWindow(browser);
  const B = await newWindow(browser);
  const a = await A.ctx.newPage();
  const b = await B.ctx.newPage();
  try {
    await signIn(a, E2E_ACCOUNTS.owner);
    await openDoc(a, sheet.name);
    await signIn(b, E2E_ACCOUNTS.owner);
    await openDoc(b, sheet.name);
    await expect.poll(() => shapes(a)).toEqual(['wide', 'tall', 'square']);
    await expect.poll(() => shapes(b)).toEqual(['wide', 'tall', 'square']);

    // 1. A turns page 1: B follows within a few seconds, with no wait note.
    const t0 = Date.now();
    await pageMenu(a, 1, 'Rotate right');
    await expect.poll(() => shapes(a)).toEqual(['tall', 'tall', 'square']);
    await expect.poll(() => shapes(b), { timeout: 5000 }).toEqual(['tall', 'tall', 'square']);
    console.log(`[page-records] B followed the turn in ${Date.now() - t0} ms`);
    await expect(b.getByText(BLOCKED)).toHaveCount(0);

    // 2. A deletes page 2: B drops it.
    await pageMenu(a, 2, 'Delete');
    await expect.poll(() => shapes(a)).toEqual(['tall', 'square']);
    await expect.poll(() => shapes(b), { timeout: 5000 }).toEqual(['tall', 'square']);

    // 3. B changes pages right away (no wait for A): a blank page below page 2.
    await pageMenu(b, 2, 'Blank page below');
    await expect.poll(() => shapes(b)).toEqual(['tall', 'square', 'square']);
    await expect.poll(() => shapes(a), { timeout: 5000 }).toEqual(['tall', 'square', 'square']);

    // 4. Offline: A turns page 2 with no signal; B gets it once A is back.
    await A.ctx.setOffline(true);
    await a.waitForTimeout(1000);
    await pageMenu(a, 1, 'Rotate left');
    await expect.poll(() => shapes(a)).toEqual(['wide', 'square', 'square']);
    await b.waitForTimeout(3000);
    expect(await shapes(b)).toEqual(['tall', 'square', 'square']);
    await A.ctx.setOffline(false);
    await expect.poll(() => shapes(b), { timeout: 30_000 }).toEqual(['wide', 'square', 'square']);

    // 5. Nothing was uploaded, and the stored PDF is the one first uploaded.
    expect(A.uploads, 'A uploads').toEqual([]);
    expect(B.uploads, 'B uploads').toEqual([]);
    const stored = await sheet.storedSha();
    expect(stored.bytesSha).toBe(sheet.sha);
    expect(stored.rowSha).toBe(sheet.sha);

    // 6. A reload shows the changed pages.
    await a.waitForTimeout(2000);
    await a.reload();
    await openDoc(a, sheet.name).catch(() => {});
    await expect.poll(() => shapes(a), { timeout: 30_000 }).toEqual(['wide', 'square', 'square']);

    // 7. Export builds the PDF from the stored one and the page list.
    await a.getByRole('button', { name: 'More export options' }).click();
    await a.getByRole('menuitem', { name: /Export PDF…/ }).click();
    const dialog = a.getByRole('dialog', { name: 'Export PDF' });
    await expect(dialog).toBeVisible();
    const [download] = await Promise.all([a.waitForEvent('download', { timeout: 30_000 }), dialog.locator('.xpdf-go').click()]);
    const file = test.info().outputPath('exported.pdf');
    await download.saveAs(file);
    const out = await PDFDocument.load(fs.readFileSync(file));
    const pages = out.getPages().map((p) => {
      const { width, height } = p.getSize();
      const turn = p.getRotation().angle % 180 !== 0;
      const [w, h] = turn ? [height, width] : [width, height];
      return w / h > 1.1 ? 'wide' : w / h < 0.9 ? 'tall' : 'square';
    });
    expect(pages).toEqual(['wide', 'square', 'square']);
    expect(Math.round(out.getPage(1).getSize().width)).toBe(400);
  } finally {
    await A.ctx.close();
    await B.ctx.close();
    await sheet.remove();
  }
});

const PHONE_LAYOUTS = [
  { label: 'phone web', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  { label: 'iOS app', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, native: 'ios' },
  { label: 'Android app', viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, native: 'android' },
];

for (const layout of PHONE_LAYOUTS) {
  test(`a phone follows page changes live and opens with them (${layout.label})`, async ({ browser }) => {
    test.setTimeout(240_000);
    const sheet = await seedThreePagePdf(`Page records ${layout.label}`);
    const A = await newWindow(browser);
    const P = await newWindow(browser, layout);
    const a = await A.ctx.newPage();
    const p = await P.ctx.newPage();
    try {
      await signIn(a, E2E_ACCOUNTS.owner);
      await openDoc(a, sheet.name);
      await signIn(p, E2E_ACCOUNTS.owner);
      await openDoc(p, sheet.name, true);
      await expect.poll(() => shapes(p), { timeout: 20_000 }).toContain('wide');

      await pageMenu(a, 1, 'Rotate right');
      await expect.poll(() => shapes(a)).toEqual(['tall', 'tall', 'square']);
      await expect.poll(async () => (await shapes(p))[0], { timeout: 5000 }).toBe('tall');
      await expect(p.getByText(BLOCKED)).toHaveCount(0);

      // Opened fresh, the phone shows the changed pages.
      await a.waitForTimeout(2000);
      await p.reload();
      await openDoc(p, sheet.name, true).catch(() => {});
      await expect.poll(async () => (await shapes(p))[0], { timeout: 30_000 }).toBe('tall');
      expect(A.uploads).toEqual([]);
      expect(P.uploads).toEqual([]);
    } finally {
      await A.ctx.close();
      await P.ctx.close();
      await sheet.remove();
    }
  });
}
