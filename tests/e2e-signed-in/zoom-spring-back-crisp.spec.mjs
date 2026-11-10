// Owner 2026-11-10: "I zoom in, it's crisp, and then on spring back, it's
// blurry." Zooming past the maximum eases the view back to the limit. The
// sharp deep-zoom layer used to draw under that ease (for the wrong part of
// the page) and nothing redrew it when the ease ended, so the view settled on
// the blurry base drawing. This walk zooms to the limit, pushes past it, and
// checks that once the view settles the sharp layer covers what is on screen
// again: with a trackpad pinch on desktop, and with a two-finger pinch on a
// phone.
import { randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

const PAGE = '.survey-pdfjs-page-div[data-page-number="1"]';

async function seedDocument() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < 2; p += 1) {
    const page = pdf.addPage([1224, 792]);
    for (let row = 0; row < 30; row += 1) {
      page.drawText(`Sheet ${p + 1} row ${row + 1}: panel schedule, conduit and device notes`, { x: 40, y: 760 - row * 24, size: 14, font, color: rgb(0, 0, 0) });
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
  const name = `E2E spring back ${Date.now()}.pdf`;
  const doc = await admin.from('documents').insert({
    id, user_id: ownerId, project_id: E2E_PROJECT.id, name, file_path: filePath, file_size: bytes.length, page_count: 2,
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

// How much of the visible part of the page most on screen the sharp layer
// covers (0..1), and its resolution against the screen (1 = one bitmap pixel
// per device pixel).
function readCrisp() {
  const first = document.querySelector('.survey-pdfjs-page-div');
  const scroller = first?.closest('[data-pdfjs-scroller], .survey-pdfjs-scroller') || first?.parentElement?.parentElement;
  if (!scroller) return null;
  const sr = scroller.getBoundingClientRect();
  let best = null;
  for (const page of document.querySelectorAll('.survey-pdfjs-page-div[data-page-number]')) {
    const pr = page.getBoundingClientRect();
    const x0 = Math.max(pr.left, sr.left); const x1 = Math.min(pr.right, sr.right);
    const y0 = Math.max(pr.top, sr.top); const y1 = Math.min(pr.bottom, sr.bottom);
    if (x1 <= x0 || y1 <= y0) continue;
    const area = (x1 - x0) * (y1 - y0);
    if (best && best.area >= area) continue;
    const tile = page.querySelector('.survey-pdfjs-detail-tile');
    let covered = 0; let res = 0;
    if (tile && tile.style.display !== 'none' && tile.width > 1) {
      const tr = tile.getBoundingClientRect();
      covered = Math.max(0, Math.min(x1, tr.right) - Math.max(x0, tr.left)) * Math.max(0, Math.min(y1, tr.bottom) - Math.max(y0, tr.top));
      res = tile.width / (tr.width * devicePixelRatio);
    }
    best = { area, cover: covered / area, res };
  }
  return best && { cover: Math.round(best.cover * 1000) / 1000, res: Math.round(best.res * 100) / 100 };
}

async function aimAtText(page) {
  return page.locator(PAGE).evaluate((el) => {
    const s = (el.closest('[data-pdfjs-scroller], .survey-pdfjs-scroller') || el.parentElement.parentElement).getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const x0 = Math.max(r.left, s.left); const x1 = Math.min(r.right, s.right);
    const y0 = Math.max(r.top, s.top); const y1 = Math.min(r.bottom, s.bottom);
    return { x: x0 + (x1 - x0) * 0.3, y: y0 + (y1 - y0) * 0.4 };
  });
}

async function expectCrispAfterSettle(page, label) {
  // First the view springs home: the page box is back to its laid-out size.
  await expect.poll(() => page.locator(PAGE).evaluate((el) => Math.abs(el.getBoundingClientRect().width / el.offsetWidth - 1) < 0.002), { timeout: 3_000, intervals: [50], message: `${label}: view settles` })
    .toBe(true);
  // The ease home lasts well under half a second; the redraw follows at once.
  await expect.poll(async () => (await page.evaluate(readCrisp))?.cover ?? 0, { timeout: 2_500, intervals: [100], message: `${label}: sharp layer covers the view after the spring-back` })
    .toBeGreaterThanOrEqual(0.95);
  // And it stays: nothing drops it a moment later.
  await page.waitForTimeout(1_500);
  const later = await page.evaluate(readCrisp);
  expect(later.cover, `${label}: still sharp 1.5 s later`).toBeGreaterThanOrEqual(0.95);
  expect(later.res, `${label}: sharp layer resolution`).toBeGreaterThanOrEqual(0.5);
}

test('the page stays crisp after zooming past the limit springs back: desktop trackpad and phone pinch', async ({ page, context, browser, baseURL }) => {
  test.setTimeout(240_000);
  const seeded = await seedDocument();
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(seeded.name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.locator(`${PAGE} canvas`).first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1_500);

    // Desktop: Ctrl+wheel notches to the maximum, then a trackpad pinch (small
    // Ctrl+wheel steps) past it, and let go.
    const cdp = await context.newCDPSession(page);
    const at = await aimAtText(page);
    for (let i = 0; i < 40; i += 1) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: -100, modifiers: 2 });
      await page.waitForTimeout(70);
    }
    await expect.poll(async () => (await page.evaluate(readCrisp))?.cover ?? 0, { timeout: 10_000, message: 'desktop: sharp at the maximum' })
      .toBeGreaterThanOrEqual(0.95);
    // Three times: whether the old code redrew during the push depended on
    // timing, so one push alone could miss the bug.
    for (let round = 1; round <= 3; round += 1) {
      for (let i = 0; i < 24; i += 1) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: -8, modifiers: 2 });
        await page.waitForTimeout(16);
      }
      await expectCrispAfterSettle(page, `desktop push ${round}`);
    }

    // Phone: pinch to the phone's limit, then once more past it.
    const storageState = await context.storageState();
    const phone = await browser.newContext({ baseURL, storageState, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
    try {
      await phone.route((url) => !['data:', 'blob:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname), (route) => route.abort('blockedbyclient'));
      const p = await phone.newPage();
      await p.goto('/', { waitUntil: 'domcontentloaded' });
      const row = p.getByText(seeded.name, { exact: true }).filter({ visible: true }).first();
      const restored = p.locator(`${PAGE} canvas`).first();
      await expect(row.or(restored).first()).toBeVisible({ timeout: 60_000 });
      if (await row.isVisible().catch(() => false)) {
        await row.tap();
        const open = p.getByRole('button', { name: 'Open file' });
        if (await open.isVisible().catch(() => false)) await open.tap();
      }
      await expect(restored).toBeVisible({ timeout: 60_000 });
      await p.waitForTimeout(1_500);
      const phoneCdp = await phone.newCDPSession(p);
      const pt = await aimAtText(p);
      for (let i = 0; i < 6; i += 1) {
        await phoneCdp.send('Input.synthesizePinchGesture', { x: pt.x, y: pt.y, scaleFactor: 2.2, relativeSpeed: 600, gestureSourceType: 'touch' });
        await p.waitForTimeout(500);
      }
      await expect.poll(async () => (await p.evaluate(readCrisp))?.cover ?? 0, { timeout: 10_000, message: 'phone: sharp at the maximum' })
        .toBeGreaterThanOrEqual(0.95);
      await phoneCdp.send('Input.synthesizePinchGesture', { x: pt.x, y: pt.y, scaleFactor: 1.8, relativeSpeed: 600, gestureSourceType: 'touch' });
      await expectCrispAfterSettle(p, 'phone');
    } finally {
      await phone.close();
    }
  } finally {
    await seeded.remove();
  }
});
