// Pinned tools dock motion (beta flag 'pinned-tools'; owner 2026-11-12: "not
// smooth enough, it is much smoother in my app Walkthu"). Frame by frame:
// - carried, the dock's tools never fade out (they blinked to nothing as it
//   lifted and again as it turned into a row) and its box never jumps;
// - a reordered pin's neighbours never jump back a slot as it drops;
// - a right-click on a pin opens the pin's menu, not the page's behind it.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

async function seedDoc(admin, owner, label) {
  const ownerId = (await owner.auth.getUser()).data.user.id;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText(`${label} drawing`, { x: 72, y: 700, size: 24, font });
  const bytes = Buffer.from(await pdf.save());
  const id = crypto.randomUUID();
  const path = `${ownerId}/${id}.pdf`;
  await must('upload', admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  const name = `${label} ${RUN}.pdf`;
  await must('row', admin.from('documents').insert({
    id, user_id: ownerId, project_id: E2E_PROJECT.id, name, file_path: path, file_size: bytes.length, page_count: 1,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  return { id, name, path };
}

async function openDoc(page, doc) {
  const row = page.locator(`.documents-ledger-row[data-document-id="${doc.id}"]`).filter({ visible: true }).first();
  if (await row.count()) {
    await row.dblclick();
  } else {
    await page.getByText(doc.name, { exact: true }).filter({ visible: true }).first().click();
    const open = page.getByRole('button', { name: 'Open file' }).filter({ visible: true }).first();
    if (await open.isVisible().catch(() => false)) await open.click();
  }
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] .survey-pdfjs-page-canvas').first()).toBeVisible({ timeout: 60_000 });
}

const PINS = ['pen', 'highlighter', 'ellipse', 'arrow', 'line', 'cloud'].map((kind, i) => ({
  id: `m${i}`, kind, style: { strokeColor: '#e11d48', strokeWidth: 3, strokeOpacity: 100, lineStyle: 'solid' },
}));

async function moveMouse(page, from, to, steps = 24) {
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await page.waitForTimeout(16);
  }
}

test('pinned dock: carried tools never fade, reorder never jumps back, right-click opens the pin menu', async ({ page }) => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const doc = await seedDoc(admin, owner, 'Pin motion');
  try {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.addInitScript(({ pins }) => {
      localStorage.setItem('survey.flag.pinned-tools', '1');
      if (!sessionStorage.getItem('pin-motion-seeded')) {
        sessionStorage.setItem('pin-motion-seeded', '1');
        localStorage.setItem('survey:pinned-tools.v1', JSON.stringify({ pins, visible: true, placement: 'left' }));
      }
    }, { pins: PINS });
    await signIn(page, E2E_ACCOUNTS.owner);
    await openDoc(page, doc);
    const dock = page.locator('[data-pinned-tools-dock]');
    await expect(dock).toHaveAttribute('data-placement', 'left', { timeout: 20_000 });

    // 1. Carry the dock from the left edge down to the bottom zone.
    await page.evaluate(() => {
      window.__dockFrames = [];
      const tick = () => {
        const d = document.querySelector('[data-pinned-tools-dock]');
        const list = d?.querySelector('.pinned-dock__pins');
        if (d && list) {
          const r = d.getBoundingClientRect();
          window.__dockFrames.push({ w: r.width, h: r.height, op: Number(getComputedStyle(list).opacity), carried: d.classList.contains('is-dragging') });
        }
        if (!window.__dockStop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const grip = await page.locator('[data-pinned-tools-grip]').boundingBox();
    const start = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await moveMouse(page, start, { x: 320, y: 540 });
    await moveMouse(page, { x: 320, y: 540 }, { x: 640, y: 880 });
    await page.waitForTimeout(400);
    await page.mouse.up();
    await expect(dock).toHaveAttribute('data-placement', 'bottom');
    await page.waitForTimeout(500);
    const frames = await page.evaluate(() => { window.__dockStop = true; return window.__dockFrames; });
    const carried = frames.filter((f) => f.carried);
    expect(carried.length).toBeGreaterThan(20);
    expect(Math.min(...carried.map((f) => f.op)), 'tools faded while carried').toBeGreaterThan(0.95);
    let worstStep = 0;
    for (let i = 1; i < frames.length; i++) {
      worstStep = Math.max(worstStep, Math.abs(frames[i].w - frames[i - 1].w), Math.abs(frames[i].h - frames[i - 1].h));
    }
    // The 320 ms morph moves the box up to ~45px a frame; the old drop swapped
    // in a stand-in and stepped ~200px in one.
    expect(worstStep, 'dock box jumped a frame').toBeLessThan(90);

    // 2. Reorder: drag the first pin three slots along the row.
    const first = await page.locator('[data-pin-slot="m0"]').boundingBox();
    const startLeft = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-pin-slot]')].map((el) => [el.dataset.pinSlot, el.getBoundingClientRect().left])));
    const from = { x: first.x + first.width / 2, y: first.y + first.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await moveMouse(page, from, { x: from.x + first.width * 3.4, y: from.y }, 30);
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      window.__pinFrames = [];
      const tick = () => {
        window.__pinFrames.push(Object.fromEntries([...document.querySelectorAll('[data-pin-slot]')].map((el) => [el.dataset.pinSlot, el.getBoundingClientRect().left])));
        if (window.__pinFrames.length < 40) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.mouse.up();
    await page.waitForTimeout(800);
    const pinFrames = await page.evaluate(() => window.__pinFrames);
    for (const id of ['m1', 'm2', 'm3']) {
      // Each slid one slot toward the start while carried; once dropped it
      // must never be drawn back in its old slot.
      const back = pinFrames.filter((f) => Math.abs(f[id] - startLeft[id]) < 4).length;
      expect(back, `${id} jumped back a slot on drop`).toBe(0);
    }
    await expect(page.locator('[data-pinned-tools-dock] [data-pin-slot]').nth(3)).toHaveAttribute('data-pin-slot', 'm0');

    // 3. Right-click a pin: its own menu, not the page menu behind the dock.
    await page.locator('[data-pin-id="m1"]').click({ button: 'right' });
    await expect(page.locator('[data-pinned-tools-pin-menu]')).toBeVisible();
    await expect(page.getByRole('menu', { name: /^Page \d+ actions$/ })).toHaveCount(0);
  } finally {
    await admin.from('documents').delete().eq('id', doc.id);
    await admin.storage.from('documents').remove([doc.path]);
  }
});
