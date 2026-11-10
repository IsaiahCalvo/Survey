// Smart ink (beta flag 'smart-ink', Drawboard's hold to straighten): rest the
// pen for half a second at the end of a stroke and it snaps - the preview
// turns into the shape at once - then lands as a real Line / Rectangle /
// Ellipse in the pen's colour. Released without the rest, it stays ink.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

async function seedDoc(admin, owner, label) {
  const ownerId = (await owner.auth.getUser()).data.user.id;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText(`${label} drawing`, { x: 72, y: 740, size: 18, font });
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
  await page.waitForTimeout(1200);
}

const MARKS = '[data-overlay-page="1"] [data-annotation-id]';
// What each mark on page 1 is drawn with: line, rect, ellipse, or ink (path).
const markKinds = (page) => page.locator(MARKS).evaluateAll((nodes) => {
  const seen = new Map();
  for (const n of nodes) {
    const id = n.getAttribute('data-annotation-id');
    if (seen.has(id)) continue;
    const shape = n.querySelector('line, rect:not([fill="none"][stroke="none"]), ellipse');
    seen.set(id, shape ? shape.tagName.toLowerCase() : 'ink');
  }
  return [...seen.values()];
});

// A wobbly stroke through page points (612 x 792), optionally resting at the end.
async function stroke(page, pts, { rest = 0 } = {}) {
  const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  const at = ([x, y]) => ({ x: box.x + (box.width * x) / 612, y: box.y + (box.height * y) / 792 });
  const first = at(pts[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  let k = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const a = at(pts[i - 1]);
    const b = at(pts[i]);
    for (let s = 1; s <= 10; s += 1) {
      k += 1;
      const wob = Math.sin(k * 1.7) * 1.2;
      await page.mouse.move(a.x + ((b.x - a.x) * s) / 10 + wob, a.y + ((b.y - a.y) * s) / 10 - wob);
    }
  }
  if (rest) {
    await page.waitForTimeout(rest);
    await expect(page.locator('.freehand-creation-preview[data-smart-ink]')).toHaveCount(1);
  }
  await page.mouse.up();
}

const RECT = [[120, 200], [320, 200], [320, 320], [120, 320], [122, 206]];
const LINE = [[100, 450], [300, 470], [500, 490]];
const OVAL = Array.from({ length: 25 }, (_, i) => {
  const t = (i / 24) * Math.PI * 1.97;
  return [420 + 90 * Math.cos(t), 250 + 60 * Math.sin(t)];
});

for (const size of [{ name: 'desktop', width: 1400, height: 900 }, { name: 'phone', width: 390, height: 844 }]) {
  test(`smart ink (${size.name}): a resting stroke snaps to a line, rectangle or ellipse; a quick one stays ink`, async ({ page }) => {
    test.setTimeout(180_000);
    const admin = adminClient();
    const owner = await apiClientFor(E2E_ACCOUNTS.owner);
    const doc = await seedDoc(admin, owner, `Smart ink ${size.name}`);
    try {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.addInitScript(() => localStorage.setItem('survey.flag.smart-ink', '1'));
      await signIn(page, E2E_ACCOUNTS.owner);
      await openDoc(page, doc);
      await page.keyboard.press('p');
      await stroke(page, LINE, { rest: 800 });
      await expect.poll(() => markKinds(page)).toEqual(['line']);
      await stroke(page, RECT, { rest: 800 });
      await expect.poll(() => markKinds(page)).toEqual(['line', 'rect']);
      if (size.name === 'desktop') {
        await stroke(page, OVAL, { rest: 800 });
        await expect.poll(() => markKinds(page)).toEqual(['line', 'rect', 'ellipse']);
      }
      await page.screenshot({ path: test.info().outputPath(`smart-ink-${size.name}.png`) });
      // The same box released at once stays ink.
      const before = (await markKinds(page)).length;
      await stroke(page, RECT.map(([x, y]) => [x + 20, y + 200]));
      await expect.poll(async () => (await markKinds(page)).slice(before)).toEqual(['ink']);
      if (size.name === 'desktop') {
        // One Undo takes the ink away, a second the ellipse: one step each.
        await page.keyboard.press('Escape');
        await page.keyboard.press('Control+z');
        await expect.poll(() => markKinds(page)).toEqual(['line', 'rect', 'ellipse']);
        await page.keyboard.press('Control+z');
        await expect.poll(() => markKinds(page)).toEqual(['line', 'rect']);
      }
    } finally {
      await admin.from('documents').delete().eq('id', doc.id);
      await admin.storage.from('documents').remove([doc.path]);
    }
  });
}

test('smart ink: with the flag off a resting stroke stays ink', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const doc = await seedDoc(admin, owner, 'Smart ink off');
  try {
    await page.setViewportSize({ width: 1400, height: 900 });
    await signIn(page, E2E_ACCOUNTS.owner);
    await openDoc(page, doc);
    await page.keyboard.press('p');
    const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
    const at = ([x, y]) => ({ x: box.x + (box.width * x) / 612, y: box.y + (box.height * y) / 792 });
    await page.mouse.move(at(LINE[0]).x, at(LINE[0]).y);
    await page.mouse.down();
    await page.mouse.move(at(LINE[2]).x, at(LINE[2]).y, { steps: 20 });
    await page.waitForTimeout(800);
    await expect(page.locator('.freehand-creation-preview[data-smart-ink]')).toHaveCount(0);
    await page.mouse.up();
    await expect.poll(() => markKinds(page)).toEqual(['ink']);
  } finally {
    await admin.from('documents').delete().eq('id', doc.id);
    await admin.storage.from('documents').remove([doc.path]);
  }
});
