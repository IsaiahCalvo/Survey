// Smooth jump to a text search hit (owner 2026-11-09): "when I click on
// different line items, it's just snapping to that line item, but I want it to
// be an animation. If it's on different pages, it should scroll to it ... It
// shouldn't zoom in so much ... you want to read the surrounding paragraphs."
// And: "the selected item is gold, and the other found items are also gold."
//
// On the owner's 36-sheet drawing set, every click on a result (a hit on the
// same sheet and hits many sheets away) moves there over several frames with
// no one-frame cut, lands centred in the part of the viewer you can see, reads
// at a modest size (not blown up), and the current hit is orange while the
// others stay yellow.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';
import { SLOW, SLOW_TIME_SCRIPT } from './slowTime.mjs';

const FIXTURE = 'debug/fixtures/package2-rev4.pdf';
const QUERY = 'Schneider';

async function seed(admin) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const docId = randomUUID();
  const docName = `E2E Search glide ${Date.now()}.pdf`;
  const bytes = fs.readFileSync(path.resolve(FIXTURE));
  const filePath = `${ownerId}/${docId}.pdf`;
  const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), {
    contentType: 'application/pdf', upsert: true,
  });
  if (up.error) throw up.error;
  const doc = await admin.from('documents').insert({
    id: docId, user_id: ownerId, project_id: E2E_PROJECT.id, name: docName,
    file_path: filePath, file_size: bytes.length, page_count: 36,
  });
  if (doc.error) throw doc.error;
  return { docId, docName, filePath };
}

async function cleanup(admin, seeded) {
  await admin.from('documents').delete().eq('id', seeded.docId);
  await admin.storage.from('documents').remove([seeded.filePath]);
}


// Records, every animation frame, where the current hit is drawn relative to
// the middle of the part of the viewer no panel or tool strip covers.
function startRecorder(page) {
  return page.evaluate(() => {
    const frames = [];
    window.__hitFrames = frames;
    const t0 = performance.now();
    const visibleCentre = () => {
      const scroller = document.querySelector('[data-touch-pdf-surface]');
      if (!scroller) return null;
      const v = scroller.getBoundingClientRect();
      let left = v.left;
      let right = v.right;
      for (const node of document.querySelectorAll('[data-viewer-occluder="side"]')) {
        const r = node.getBoundingClientRect();
        if (!(r.width > 0) || r.bottom <= v.top || r.top >= v.bottom) continue;
        if (r.left <= v.left + 4 && r.right > left) left = Math.min(r.right, v.right);
        if (r.right >= v.right - 4 && r.left < right) right = Math.max(r.left, v.left);
      }
      let top = v.top;
      for (const node of document.querySelectorAll('[data-viewer-occluder="bar"]')) {
        const r = node.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.top <= top + 2 && r.bottom > top) top = Math.min(r.bottom, v.bottom);
      }
      return { x: (left + right) / 2, y: (top + v.bottom) / 2 };
    };
    const scroller = document.querySelector('[data-touch-pdf-surface]');
    const atLimit = () => ({
      x: scroller.scrollLeft <= 1 || scroller.scrollLeft >= scroller.scrollWidth - scroller.clientWidth - 1,
      y: scroller.scrollTop <= 1 || scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1,
    });
    const tick = () => {
      if (window.__hitFrames !== frames) return;
      const nodes = Array.from(document.querySelectorAll('[data-search-highlight-current="true"]'))
        .filter((node) => {
          const r = node.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
      const c = visibleCentre();
      if (nodes.length && c) {
        const r = nodes[0].getBoundingClientRect();
        const v = scroller.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        frames.push({
          t: performance.now() - t0,
          id: nodes[0].closest('svg')?.getAttribute('data-search-highlight-active') || '',
          dx: cx - c.x,
          dy: cy - c.y,
          // The line's height: the short side (a label on a drawing can run
          // up the sheet, so its box is tall and thin).
          h: Math.min(r.width, r.height),
          inView: cx >= v.left && cx <= v.right && cy >= v.top && cy <= v.bottom,
          limit: atLimit(),
        });
      } else {
        frames.push({ t: performance.now() - t0, missing: true });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const stopRecorder = (page) => page.evaluate(() => {
  const frames = window.__hitFrames || [];
  window.__hitFrames = null;
  return frames;
});

function analyse(frames) {
  const drawn = frames.filter((f) => !f.missing);
  const last = drawn[drawn.length - 1];
  // Every frame the hit you clicked is drawn inside the viewer, until it lands.
  // (The step from the previous hit to this one is a different highlight, and
  // a far page is reached by a deliberate jump to one screen short of it, so
  // neither counts as the move.)
  const seen = drawn.filter((f) => f.id === last?.id && f.inView);
  let moving = 0;
  let biggestStep = 0;
  let total = 0;
  for (let i = 1; i < seen.length; i += 1) {
    const step = Math.hypot(seen[i].dx - seen[i - 1].dx, seen[i].dy - seen[i - 1].dy);
    if (step > 0.5) moving += 1;
    biggestStep = Math.max(biggestStep, step);
    total += step;
  }
  return { last, moving, biggestStep, total, seen: seen.length };
}

test('clicking a search result glides there, lands centred, zooms only a little, and stands out', async ({ page }) => {
  test.setTimeout(420_000);
  const admin = adminClient();
  const seeded = await seed(admin);
  try {
    await page.addInitScript(SLOW_TIME_SCRIPT);
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(seeded.docName, { exact: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] canvas').first()).toBeVisible({ timeout: 60_000 });

    await page.getByRole('button', { name: 'Search text', exact: true }).first().click();
    const input = page.getByLabel('Search text in PDF');
    await input.fill(QUERY);
    const rows = page.locator('.search-text-result');
    await expect.poll(() => rows.count(), { timeout: 60_000 }).toBeGreaterThan(6);
    const count = await rows.count();
    const pages = await rows.evaluateAll((nodes) => nodes.map((n) => Number(n.getAttribute('data-result-page'))));

    // First hit, then one on the same sheet if there is one, then hits many
    // sheets away (both directions).
    const order = [0];
    const sameSheet = pages.findIndex((p, i) => i > 0 && p === pages[0]);
    if (sameSheet > 0) order.push(sameSheet);
    order.push(count - 1, Math.floor(count / 2), 1);

    for (const index of order) {
      // Let any drawing from the last jump finish first.
      await page.waitForTimeout(1500);
      await page.evaluate((s) => window.__setTimeScale(s), SLOW);
      await startRecorder(page);
      await rows.nth(index).click();
      // About 1.2 s of page time: the scroll (320 ms) and the fly (up to
      // 520 ms) are over by then.
      await page.waitForTimeout(1200 / SLOW);
      const frames = await stopRecorder(page);
      await page.evaluate(() => window.__setTimeScale(1));
      const { last, moving, biggestStep, total, seen } = analyse(frames);
      console.log(`[search-glide] result ${index} p${pages[index]}`, JSON.stringify({ last, moving, biggestStep: Math.round(biggestStep), total: Math.round(total), seen }));
      if (process.env.SEARCH_GLIDE_DEBUG) console.log(JSON.stringify(frames.map((f) => (f.missing ? [Math.round(f.t)] : [Math.round(f.t), Math.round(f.dx), Math.round(f.dy), Math.round(f.h), f.limit.x ? 'X' : '', f.limit.y ? 'Y' : '', f.inView ? '' : 'out']))));
      expect(last, `result ${index} is drawn after the jump`).toBeTruthy();
      // Lands centred in the free view (unless the page cannot scroll that far).
      if (!last.limit.x) expect(Math.abs(last.dx), `result ${index} centred across`).toBeLessThan(8);
      if (!last.limit.y) expect(Math.abs(last.dy), `result ${index} centred down`).toBeLessThan(8);
      // Zooms only a little: the hit's line is small body-text size, not huge.
      expect(last.h, `result ${index} line height on screen`).toBeLessThan(26);
      if (total > 40) {
        // It moved over several frames, never most of the way in one frame.
        expect(moving, `result ${index} animates`).toBeGreaterThanOrEqual(4);
        expect(biggestStep / total, `result ${index} has no one-frame cut`).toBeLessThan(0.7);
      }
      // Nothing moves once it has landed.
      const settled = frames.filter((f) => !f.missing && f.t > frames[frames.length - 1].t - 400);
      for (const f of settled) {
        expect(Math.abs(f.dx - last.dx) + Math.abs(f.dy - last.dy), `result ${index} still after landing`).toBeLessThan(1.5);
      }
    }

    // The current hit is orange; the other hits stay yellow.
    const colours = await page.evaluate(() => {
      const current = document.querySelector('[data-search-highlight-current="true"]')?.getAttribute('fill');
      const other = document.querySelector('.search-highlight-svg-rect:not([data-search-highlight-current])')?.getAttribute('fill');
      return { current, other };
    });
    expect(colours.current).toMatch(/^rgba\(255, 140, 0/);
    if (colours.other) expect(colours.other).toMatch(/^rgba\(255, 235, 59/);
  } finally {
    await cleanup(admin, seeded);
  }
});
