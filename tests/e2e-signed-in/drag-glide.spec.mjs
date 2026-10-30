// Drag to reorder glides, frame by frame (owner 2026-10-30: "when I drag and
// drop, the animation isn't clean … expanded and compact … make it feel
// professional"). Spaces had its glide switched off: the passed rows jumped a
// whole row in one frame and the dropped row snapped 17-48px. This walks a
// Spaces drag with one space open and records every frame: no row may cover
// 70%+ of a move in a single frame, no dashed landing slot is drawn, and an
// open space's fold arrow stays turned while the space is held.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

const RUN = crypto.randomUUID().slice(0, 8);
const DOC_NAME = `Drag glide ${RUN}.pdf`;

async function sheetsPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= 6; n += 1) {
    doc.addPage([1224, 792]).drawText(`SHEET ${n} ${RUN}`, { x: 48, y: 700, size: 48, font, color: rgb(0.1, 0.1, 0.45) });
  }
  return Buffer.from(await doc.save());
}

const button = (page, name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
const nameInput = (page, name) => page.locator(`input.space-card__name[value="${name}"]`).filter({ visible: true }).first();
const grip = (page, name) => page.locator('.space-card', { has: nameInput(page, name) }).filter({ visible: true }).first().locator('[data-space-drag-handle]');
const order = (page) => page.locator('.spaces-list input.space-card__name').filter({ visible: true }).evaluateAll((nodes) => nodes.map((node) => node.value));

// Every frame from now until stop(): each space's top and whether it is lifted.
const record = (page) => page.evaluate(() => {
  window.__dragFrames = [];
  window.__dragRecording = true;
  const tick = () => {
    if (!window.__dragRecording) return;
    const list = [...document.querySelectorAll('.spaces-list [data-sortable-rearrange-list]')].find((node) => node.offsetParent);
    if (list) {
      window.__dragFrames.push({
        t: performance.now(),
        slot: Boolean(document.querySelector('[data-drag-slot]')),
        items: [...list.querySelectorAll(':scope > [data-sortable-rearrange-item]')].map((node) => ({
          name: node.querySelector('.space-card__name')?.value,
          top: node.getBoundingClientRect().top,
          lifted: node.hasAttribute('data-drag-lifted'),
        })),
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

// A "jump": a move of 8px+ done 70%+ in one frame. The held row is skipped
// while it follows the pointer (it moves with it), not after the drop.
function jumpsIn(frames, upAt) {
  const jumps = [];
  const names = [...new Set(frames.flatMap((frame) => frame.items.map((item) => item.name)))];
  const lifted = frames.flatMap((frame) => frame.items).find((item) => item.lifted)?.name;
  for (const name of names) {
    let previous = null;
    let run = [];
    const flush = () => {
      const total = Math.abs(run.reduce((sum, step) => sum + step, 0));
      if (total >= 8 && Math.max(...run.map(Math.abs)) / total > 0.7) jumps.push(`${name} ${Math.round(total)}px`);
      run = [];
    };
    for (const frame of frames) {
      const item = frame.items.find((entry) => entry.name === name);
      if (!item) { previous = null; continue; }
      if (previous != null && !(name === lifted && frame.t < upAt)) {
        const step = item.top - previous;
        if (Math.abs(step) > 0.3) run.push(step); else if (run.length) flush();
      }
      previous = item.top;
    }
    if (run.length) flush();
  }
  return jumps;
}

async function dragSpace(page, name, dy) {
  const box = await grip(page, name).boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await record(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 30; i += 1) {
    await page.mouse.move(x, y + (dy * i) / 30);
    await page.waitForTimeout(16);
  }
  const arrow = await page.evaluate(() => {
    const svg = document.querySelector('[data-drag-lifted] .space-card.is-expanded .space-card__chevron > svg');
    return svg ? getComputedStyle(svg).transform : null;
  });
  await page.waitForTimeout(200);
  const upAt = await page.evaluate(() => performance.now());
  await page.mouse.up();
  await page.waitForTimeout(600);
  const frames = await page.evaluate(() => { window.__dragRecording = false; return window.__dragFrames; });
  return { frames, upAt, arrow };
}

test('Spaces drag: rows glide apart, the drop settles, no dashed slot, open or folded', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const bytes = await sheetsPdf();
  const id = crypto.randomUUID();
  const filePath = `${user.id}/${id}.pdf`;
  await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' });
  await admin.from('documents').insert({
    id, user_id: user.id, project_id: null, name: DOC_NAME, file_path: filePath, file_size: bytes.length, page_count: 6,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  });

  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(DOC_NAME, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]').first()).toBeVisible({ timeout: 60_000 });
    await button(page, 'Spaces').click();
    for (const [name, pages] of [['Alpha', '1-2'], ['Bravo', '3'], ['Charlie', '4-6'], ['Delta', '1']]) {
      await button(page, 'Create space').click();
      await expect(page.locator('.space-card__name:focus')).toHaveCount(1);
      await page.keyboard.type(name, { delay: 10 });
      await page.keyboard.press('Enter');
      const add = page.locator('.space-card__add-input:focus');
      await expect(add).toHaveCount(1);
      await add.fill(pages);
      await add.press('Enter');
      await expect(nameInput(page, name)).toBeVisible();
    }
    if (await button(page, 'Done editing Spaces').count()) await button(page, 'Done editing Spaces').click();
    for (const name of ['Alpha', 'Bravo', 'Charlie', 'Delta']) {
      const fold = page.getByRole('button', { name: `Fold ${name}` }).filter({ visible: true });
      if (await fold.count()) await fold.first().click();
    }
    await page.waitForTimeout(500);

    // Folded: the last space up to the top.
    const before = await order(page);
    const folded = await dragSpace(page, before.at(-1), -110);
    await expect.poll(() => order(page)).not.toEqual(before);
    expect(jumpsIn(folded.frames, folded.upAt)).toEqual([]);
    expect(folded.frames.some((frame) => frame.slot)).toBe(false);

    // Open: Charlie (three regions, a tall row) held and moved, its arrow turned.
    await page.getByRole('button', { name: 'Open Charlie' }).filter({ visible: true }).first().click();
    await page.waitForTimeout(500);
    const openBefore = await order(page);
    const open = await dragSpace(page, 'Charlie', openBefore.indexOf('Charlie') < 2 ? 120 : -80);
    await expect.poll(() => order(page)).not.toEqual(openBefore);
    expect(jumpsIn(open.frames, open.upAt)).toEqual([]);
    expect(open.arrow).not.toBe('none');

    // A folded space carried past the open one.
    const pastBefore = await order(page);
    const carried = pastBefore.find((name) => name !== 'Charlie');
    const past = await dragSpace(page, carried, pastBefore.indexOf(carried) < pastBefore.indexOf('Charlie') ? 200 : -200);
    await expect.poll(() => order(page)).not.toEqual(pastBefore);
    expect(jumpsIn(past.frames, past.upAt)).toEqual([]);
  } finally {
    await admin.from('documents').delete().eq('id', id);
  }
});
