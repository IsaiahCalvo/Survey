// A fast finger fling on a phone (2026-11-10: "no visible stall on fling").
// The glide is moved by script, and mounting a page's drawing and marks cost
// 100-400 ms on a phone CPU, so every page a fast glide only flew past
// stalled it. Pages it reaches while still fast now stay plain white sheets
// (no drawing, no marks) and the pages where it slows get mounted. This walk
// flings through a long set and checks both halves: pages in the middle of
// the fling were never mounted, and every page on screen when it stops is
// mounted and drawn.
import { randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

const PAGES = 30;

async function seedDocument() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < PAGES; p += 1) {
    const page = pdf.addPage([1224, 792]);
    page.drawText(`Sheet ${p + 1}`, { x: 60, y: 720, size: 36, font, color: rgb(0, 0, 0) });
    for (let i = 0; i < 40; i += 1) {
      page.drawLine({ start: { x: 40 + ((i * 29) % 1100), y: 80 + ((i * 31) % 560) }, end: { x: 120 + ((i * 37) % 1060), y: 100 + ((i * 23) % 600) }, thickness: 1, color: rgb(0.2, 0.2, 0.2) });
    }
  }
  const bytes = Buffer.from(await pdf.save());
  const admin = adminClient();
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const id = randomUUID();
  const filePath = `${ownerId}/${id}.pdf`;
  const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true });
  if (up.error) throw up.error;
  const now = new Date().toISOString();
  const name = `E2E fling ${Date.now()}.pdf`;
  const doc = await admin.from('documents').insert({
    id, user_id: ownerId, project_id: E2E_PROJECT.id, name, file_path: filePath, file_size: bytes.length, page_count: PAGES,
    cutover_completed_at: now, embedded_import_completed_at: now,
  });
  if (doc.error) throw doc.error;
  return {
    name,
    async remove() {
      await admin.from('documents').delete().eq('id', id);
      await admin.storage.from('documents').remove([filePath]);
    },
  };
}

// Every page that gets mounted while the probe runs, and the page on screen.
function installMountProbe() {
  window.__mountedEver = new Set();
  const note = () => {
    for (const el of document.querySelectorAll('.survey-pdfjs-page-div[data-page-mounted="true"]')) window.__mountedEver.add(Number(el.dataset.pageNumber));
  };
  note();
  window.__mountObserver = new MutationObserver(note);
  window.__mountObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-page-mounted'] });
}

function onScreenPages() {
  const first = document.querySelector('.survey-pdfjs-page-div');
  const scroller = first?.closest('[data-pdfjs-scroller], .survey-pdfjs-scroller') || first?.parentElement?.parentElement;
  const sr = scroller.getBoundingClientRect();
  return [...document.querySelectorAll('.survey-pdfjs-page-div[data-page-number]')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > sr.top + 4 && r.top < sr.bottom - 4; })
    .map((el) => ({ page: Number(el.dataset.pageNumber), mounted: el.dataset.pageMounted === 'true', drawn: el.hasAttribute('data-raster-shown') }));
}

test('a fast phone fling mounts only where it lands, and every page there is drawn', async ({ page, context, browser, baseURL }) => {
  test.setTimeout(180_000);
  const seeded = await seedDocument();
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    const storageState = await context.storageState();
    const phone = await browser.newContext({ baseURL, storageState, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
    try {
      await phone.route((url) => !['data:', 'blob:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname), (route) => route.abort('blockedbyclient'));
      const p = await phone.newPage();
      await p.goto('/', { waitUntil: 'domcontentloaded' });
      const row = p.getByText(seeded.name, { exact: true }).filter({ visible: true }).first();
      await expect(row).toBeVisible({ timeout: 60_000 });
      await row.tap();
      const open = p.getByRole('button', { name: 'Open file' });
      if (await open.isVisible().catch(() => false)) await open.tap();
      await expect(p.locator('.survey-pdfjs-page-div[data-page-number="1"][data-raster-shown]')).toBeVisible({ timeout: 60_000 });
      await p.waitForTimeout(1_500);

      const surface = await p.evaluate(() => {
        const el = document.querySelector('[data-touch-pdf-surface="true"]') || document.querySelector('.survey-pdfjs-page-div')?.parentElement?.parentElement;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * 0.85) };
      });
      await p.evaluate(installMountProbe);
      // A hard upward flick: six moves of 110 px a frame, then let go.
      const cdp = await phone.newCDPSession(p);
      const point = (x, y) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
      // Stamped 16 ms apart: a slow dev server must not turn the flick into a drag.
      const t0 = Date.now() / 1000;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(surface.x, surface.y), timestamp: t0 });
      for (let i = 1; i <= 6; i += 1) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(surface.x, surface.y - i * 110), timestamp: t0 + i * 0.016 });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + 7 * 0.016 });

      // Wait for the glide to stop.
      let lastTop = -1;
      await expect.poll(async () => {
        const top = await p.evaluate(() => {
          const el = document.querySelector('.survey-pdfjs-page-div');
          return (el.closest('[data-pdfjs-scroller], .survey-pdfjs-scroller') || el.parentElement.parentElement).scrollTop;
        });
        const still = top === lastTop;
        lastTop = top;
        return still;
      }, { timeout: 15_000, intervals: [250] }).toBe(true);

      const landed = await p.evaluate(onScreenPages);
      const mountedEver = await p.evaluate(() => [...window.__mountedEver].sort((a, b) => a - b));
      const landedFirst = Math.min(...landed.map((x) => x.page));
      expect(landedFirst, 'the fling went well past the first pages').toBeGreaterThan(6);
      // Pages the glide only flew past were never mounted.
      const flownPast = [];
      for (let n = 4; n < landedFirst - 2; n += 1) flownPast.push(n);
      const mountedInFlight = flownPast.filter((n) => mountedEver.includes(n));
      expect(mountedInFlight.length, `pages mounted mid-fling: ${mountedInFlight.join(', ')} (landed on ${landedFirst})`).toBeLessThan(Math.max(2, Math.ceil(flownPast.length / 2)));
      // Every page on screen where it stopped is mounted and drawn.
      await expect.poll(() => p.evaluate(onScreenPages).then((pages) => pages.every((x) => x.mounted && x.drawn)), { timeout: 15_000, message: 'pages on screen after the fling are drawn' }).toBe(true);
    } finally {
      await phone.close();
    }
  } finally {
    await seeded.remove();
  }
});
