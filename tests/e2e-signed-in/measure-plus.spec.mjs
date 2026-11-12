// Drawboard's measure formats (beta flag 'measure-plus', deep/measure-extras.md
// §1, §3, §7). A custom scale "1″ = 8′" reads feet-inches with primes; the
// same line restamps to decimal feet when Units change; "Set as default"
// carries the scale to a file that has none of its own.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

async function onePagePdf(text) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([792, 612]).drawText(text, { x: 72, y: 540, size: 24, font });
  return Buffer.from(await pdf.save());
}

async function seedDocument(admin, userId, name, text) {
  const id = crypto.randomUUID();
  const bytes = await onePagePdf(text);
  await must('upload', admin.storage.from('documents').upload(`${userId}/${id}.pdf`, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id, user_id: userId, name, file_path: `${userId}/${id}.pdf`, file_size: bytes.length, page_count: 1,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  return id;
}

async function openDocument(page, name, text) {
  await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.getByText(text)).toBeVisible({ timeout: 60_000 });
  return page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
}

async function drawLength(page, surface, x1, x2, y, { dimPreview = false } = {}) {
  await page.locator('[data-measure-tool="menu"]').filter({ visible: true }).first().click();
  await page.locator('[data-measure-tool="length"]').click();
  const box = await surface.boundingBox();
  await page.mouse.move(box.x + x1, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y, { steps: 8 });
  // The draft is the mark: the dimension line shows while dragging.
  if (dimPreview) await expect(surface.locator('.shape-creation-preview [data-dimension-line] text[data-dimension-caption]')).toHaveCount(1);
  await page.mouse.up();
  // With 'measure-plus' a new Length is a dimension line with its caption
  // inline; without it, the old line and pill.
  const dim = surface.locator('[data-dimension-line] text[data-dimension-caption]');
  const pill = surface.locator('.measure-labels .measure-label[data-measure-kind="length"] text');
  await expect(dim.or(pill)).toHaveCount(1, { timeout: 15_000 });
  return (await dim.count()) ? dim : pill;
}

async function openScaleDialog(page) {
  const menu = page.locator('[data-measure-tool="menu"]').filter({ visible: true });
  if (!(await menu.count())) await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  await menu.first().click();
  await page.getByText('Page scale…').click();
  return page.getByRole('dialog', { name: 'Set page scale' });
}

// Pick a value from one of the dialog's drop-downs (ValueSelect).
async function pick(page, dialog, attr, label, optionName) {
  await dialog.locator(`[${attr}] button`).first().click();
  await page.getByRole('listbox', { name: label }).getByRole('option', { name: optionName, exact: true }).click();
}
const valueOf = (dialog, attr) => dialog.locator(`[${attr}] button`).first();

// "84′-8 1/4″" → inches.
function feetInches(text) {
  const m = text.match(/^(?:([\d,]+)′)?-?(?:(\d+)?(?: ?(\d+)\/(\d+))?″)?$/);
  if (!m) return NaN;
  return Number((m[1] || '0').replace(/,/g, '')) * 12 + Number(m[2] || 0) + (m[3] ? Number(m[3]) / Number(m[4]) : 0);
}

test('custom scale reads feet-inches, Units restamp the line, Set as default carries over', async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    localStorage.setItem('survey.flag.measure-plus', '1');
    // The Measurement card (its own beta flag) carries Leader and Inline / Above.
    localStorage.setItem('survey.flag.measure-edit', '1');
    if (!sessionStorage.getItem('measure-plus-reset')) {
      localStorage.removeItem('survey.measure.defaultScale');
      sessionStorage.setItem('measure-plus-reset', '1');
    }
  });
  const owner = E2E_ACCOUNTS.owner;
  const admin = adminClient();
  const api = await apiClientFor(owner);
  const { data: { user } } = await api.auth.getUser();
  const nameA = `Formats A ${RUN}.pdf`;
  const nameB = `Formats B ${RUN}.pdf`;
  const ids = [
    await seedDocument(admin, user.id, nameA, 'Formats page A'),
    await seedDocument(admin, user.id, nameB, 'Formats page B'),
  ];

  try {
    await signIn(page, owner);
    const surface = await openDocument(page, nameA, 'Formats page A');
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();

    // Custom: 1″ on the sheet = 8′, feet-inches at 1/4.
    let dialog = await openScaleDialog(page);
    await dialog.locator('[data-measure-scale-kind-option="custom"]').click();
    await expect(dialog.locator('[data-measure-preset]')).toHaveCount(0);
    await expect(valueOf(dialog, 'data-measure-display')).toHaveAttribute('data-value', 'ftin');
    await dialog.locator('[data-measure-custom-paper]').fill('1');
    await dialog.locator('[data-measure-custom-real]').fill("8'");
    await pick(page, dialog, 'data-measure-precision', 'Precision', '1/4');
    await page.screenshot({ path: 'test-results/measure-plus-dialog.png' });
    await dialog.locator('[data-measure-apply]').click();
    await expect(dialog).toBeHidden();

    const reading = await drawLength(page, surface, 150, 450, 300, { dimPreview: true });
    // Drawboard's dimension line: offset line in two pieces round the caption,
    // two extension lines, two open chevrons, and no pill.
    const dimLine = surface.locator('[data-dimension-line]');
    await expect(dimLine).toHaveCount(1);
    await expect(dimLine.locator('polyline')).toHaveCount(2);
    expect(await dimLine.locator('line').count()).toBe(4);
    await expect(surface.locator('.measure-labels .measure-label[data-measure-kind="length"]')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('measure-plus-dimension.png') });
    // A click on the offset line (what the user sees) picks the mark.
    const bar = page.locator('[data-selection-quick-bar][data-visible="true"]');
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await expect(bar).toHaveCount(0);
    const seg = await dimLine.locator('line').nth(2).boundingBox();
    await page.mouse.click(seg.x + seg.width / 2, seg.y + seg.height / 2);
    await expect(bar).toBeVisible();
    // Measurement card: Leader moves the line off the points; Above keeps it
    // whole with the caption beside it; Inline breaks it again.
    await bar.getByRole('button', { name: 'Measurement' }).click();
    const card = page.getByRole('dialog', { name: 'Measurement' });
    const leader = card.locator('[data-measure-edit-leader]');
    await expect(leader).toHaveValue('15.31');
    const lineY = async () => Number(await dimLine.locator('line').nth(2).getAttribute('y1'));
    const yBefore = await lineY();
    await leader.fill('40');
    await leader.press('Enter');
    await expect.poll(async () => Math.round(Math.abs((await lineY()) - yBefore) * 100) / 100).toBe(24.69);
    await leader.press('ArrowUp');
    await expect(leader).toHaveValue('41');
    await card.locator('[data-measure-edit-place="above"]').click();
    await expect(card.locator('[data-measure-edit-place="above"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(dimLine.locator('line')).toHaveCount(3);
    await page.screenshot({ path: test.info().outputPath('measure-plus-above.png') });
    await card.locator('[data-measure-edit-place="inline"]').click();
    await expect(dimLine.locator('line')).toHaveCount(4);
    // Caption style (Drawboard's Caption pop-over): size in pt, text colour,
    // background and its opacity, each one undo step.
    const caption = dimLine.locator('text[data-dimension-caption]');
    const ptField = card.locator('[data-measure-edit-caption-pt]');
    await expect(ptField).toHaveValue('9');
    await ptField.fill('14');
    await ptField.press('Enter');
    await expect(caption).toHaveAttribute('font-size', '14');
    await ptField.press('ArrowDown');
    await expect(caption).toHaveAttribute('font-size', '13');
    await card.locator('[data-measure-edit-caption-color="blue"]').click();
    await expect(caption).toHaveAttribute('fill', '#0066D4');
    await expect(card.locator('[data-measure-edit-caption-bg-opacity]')).toHaveCount(0);
    await card.locator('[data-measure-edit-caption-bg="yellow"]').click();
    const bgRect = dimLine.locator('rect[data-dimension-caption-bg]');
    await expect(bgRect).toHaveAttribute('fill', '#FFF9C4');
    await expect(bgRect).toHaveAttribute('fill-opacity', '1');
    await card.locator('[data-measure-edit-caption-bg-opacity="0.5"]').click();
    await expect(bgRect).toHaveAttribute('fill-opacity', '0.5');
    await page.screenshot({ path: test.info().outputPath('measure-plus-caption-style.png') });
    await page.keyboard.press('Control+z');
    await expect(bgRect).toHaveAttribute('fill-opacity', '1');
    await card.locator('[data-measure-edit-caption-bg="none"]').click();
    await expect(bgRect).toHaveCount(0);
    await card.locator('[data-measure-edit-caption-color="auto"]').click();
    await ptField.fill('9');
    await ptField.press('Enter');
    await expect(caption).toHaveAttribute('font-size', '9');
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    // The leader pill on the line: dragging it past the clicked points flips
    // the line to the other side, in one undo step.
    const pill = surface.locator('[data-handle="leader"]');
    await expect(pill).toHaveCount(1);
    await expect(surface.locator('[data-handle="midpoint"]')).toHaveCount(0);
    const pb = await pill.boundingBox();
    await page.screenshot({ path: test.info().outputPath('measure-plus-leader-pill.png') });
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await page.mouse.down();
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2 + 50, { steps: 5 });
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2 + 100, { steps: 5 });
    await page.mouse.up();
    await bar.getByRole('button', { name: 'Measurement' }).click();
    await expect(leader).toHaveValue(/^-\d/);
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await page.keyboard.press('Control+z');
    await bar.getByRole('button', { name: 'Measurement' }).click();
    await expect(leader).toHaveValue('41');
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    // Right-click: Reset leader line puts it back at the default offset.
    const segNow = await dimLine.locator('line').nth(2).boundingBox();
    await page.mouse.click(segNow.x + segNow.width / 2, segNow.y + segNow.height / 2, { button: 'right' });
    const menu = page.locator('[data-annotation-context-menu]');
    await expect(menu).toBeVisible();
    await menu.getByText('Reset leader line', { exact: true }).click();
    await expect(menu).toBeHidden();
    await expect.poll(async () => Math.round(Math.abs((await lineY()) - yBefore) * 100) / 100).toBe(0);
    // Drag the caption off the line: it keeps an elbow leader, the line goes
    // whole; right-click Reset caption position puts it back.
    const grab = surface.locator('[data-handle="dim-caption"]');
    await expect(grab).toHaveCount(1);
    const gb = await grab.boundingBox();
    await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
    await page.mouse.down();
    await page.mouse.move(gb.x + gb.width / 2 + 40, gb.y + gb.height / 2 + 40, { steps: 4 });
    await page.mouse.move(gb.x + gb.width / 2 + 90, gb.y + gb.height / 2 + 80, { steps: 4 });
    await page.mouse.up();
    await expect(dimLine.locator('[data-dimension-elbow]')).toHaveCount(1);
    await expect(dimLine.locator('line')).toHaveCount(3);
    await page.screenshot({ path: test.info().outputPath('measure-plus-caption-moved.png') });
    const segMoved = await dimLine.locator('line').nth(2).boundingBox();
    await page.mouse.click(segMoved.x + segMoved.width / 4, segMoved.y + segMoved.height / 2, { button: 'right' });
    await expect(menu).toBeVisible();
    await menu.getByText('Reset caption position', { exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(dimLine.locator('[data-dimension-elbow]')).toHaveCount(0);
    await expect(dimLine.locator('line')).toHaveCount(4);
    // The small circle above the caption turns it (Shift: 15° steps), one
    // Undo step; Reset caption position puts it level again.
    const turnGrab = surface.locator('[data-handle="dim-caption-turn"]');
    await expect(turnGrab).toHaveCount(1);
    const tb = await turnGrab.boundingBox();
    const cb = await surface.locator('[data-handle="dim-caption"]').boundingBox();
    const cx = cb.x + cb.width / 2;
    const cy = cb.y + cb.height / 2;
    const reach = cy - (tb.y + tb.height / 2);
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
    await page.mouse.down();
    await page.keyboard.down('Shift');
    await page.mouse.move(cx + reach * 0.7, cy - reach * 0.7, { steps: 4 });
    await page.mouse.move(cx + reach, cy + 2, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expect(caption).toHaveAttribute('transform', /^rotate\(90 /);
    await page.screenshot({ path: test.info().outputPath('measure-plus-caption-turned.png') });
    await page.keyboard.press('Control+z');
    await expect(caption).toHaveAttribute('transform', /^rotate\(0 /);
    await page.keyboard.press('Control+Shift+z');
    await expect(caption).toHaveAttribute('transform', /^rotate\(90 /);
    const segTurned = await dimLine.locator('line').nth(2).boundingBox();
    await page.mouse.click(segTurned.x + segTurned.width / 8, segTurned.y + segTurned.height / 2, { button: 'right' });
    await expect(menu).toBeVisible();
    await menu.getByText('Reset caption position', { exact: true }).click();
    await expect(caption).toHaveAttribute('transform', /^rotate\(0 /);
    await page.keyboard.press('Escape');
    await expect(reading).toHaveText(/^(?:[\d,]+′(?:-\d+(?: \d+\/\d)?″)?|(?:\d+ )?\d+(?:\/\d)?″)$/);
    const ftin = feetInches((await reading.textContent()).trim());
    expect(ftin).toBeGreaterThan(12);

    // The same line in decimal feet at 0.001 agrees to the 1/4″ step.
    await page.keyboard.press('Escape');
    dialog = await openScaleDialog(page);
    await dialog.locator('[data-measure-scale-kind-option="custom"]').click();
    await pick(page, dialog, 'data-measure-display', 'Units', 'Decimal feet');
    await expect(valueOf(dialog, 'data-measure-precision')).toHaveAttribute('data-value', '2');
    await pick(page, dialog, 'data-measure-precision', 'Precision', '0.001');
    await dialog.locator('[data-measure-custom-paper]').fill('1');
    await dialog.locator('[data-measure-custom-real]').fill('8');
    await dialog.locator('[data-measure-set-default]').check();
    await dialog.locator('[data-measure-apply]').click();
    await expect(dialog).toBeHidden();
    await expect(reading).toHaveText(/^[\d,]+\.\d{3} ft$/);
    const ft = Number((await reading.textContent()).replace(/[^\d.]/g, ''));
    expect(Math.abs(ft * 12 - ftin)).toBeLessThanOrEqual(0.125 + 1e-6);

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('survey.measure.defaultScale') || 'null'));
    expect(saved).toMatchObject({ unit: 'ft', display: 'ft', precision: 3, ptPerUnit: 9 });

    // A file with no scale of its own starts at the default.
    await page.getByRole('button', { name: `Close ${nameA}` }).click();
    const surfaceB = await openDocument(page, nameB, 'Formats page B');
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    const readingB = await drawLength(page, surfaceB, 150, 450, 300);
    await expect(readingB).toHaveText(/^[\d,]+\.\d{3} ft$/);
    await expect(readingB).not.toContainText('no scale');

    // Perimeter, Drawboard's way: finished at its last point (a double-click)
    // it stays open, a polylength of three sides; a click back on the first
    // point closes it and counts the fourth side.
    await page.keyboard.press('Escape');
    const sb = await surfaceB.boundingBox();
    const perimeterAt = async (x0, y0, close) => {
      await page.locator('[data-measure-tool="menu"]').click();
      await page.locator('[data-measure-tool="perimeter"]').click();
      const pts = [[x0, y0], [x0 + 120, y0], [x0 + 120, y0 + 60], [x0, y0 + 60]];
      for (const [x, y] of pts.slice(0, 3)) await page.mouse.click(sb.x + x, sb.y + y);
      if (close) {
        await page.mouse.click(sb.x + pts[3][0], sb.y + pts[3][1]);
        await page.mouse.click(sb.x + x0, sb.y + y0);
      } else {
        await page.mouse.dblclick(sb.x + pts[3][0], sb.y + pts[3][1]);
      }
      await page.keyboard.press('Escape');
    };
    await perimeterAt(150, 120, false);
    const openLabel = surfaceB.locator('.measure-labels .measure-label[data-measure-kind="polylength"]');
    await expect(openLabel).toHaveCount(1, { timeout: 15_000 });
    await expect(surfaceB.locator('.measure-labels .measure-label[data-measure-kind="perimeter"]')).toHaveCount(0);
    await perimeterAt(150, 480, true);
    const closedLabel = surfaceB.locator('.measure-labels .measure-label[data-measure-kind="perimeter"]');
    await expect(closedLabel).toHaveCount(1, { timeout: 15_000 });
    const ftOf = async (loc) => Number((await loc.locator('text').first().textContent()).replace(/[^\d.]/g, ''));
    const open = await ftOf(openLabel);
    const closed = await ftOf(closedLabel);
    // Three sides (120 + 60 + 120) against four (+ 60): a ratio of 300 : 360.
    expect(Math.abs(open / closed - 300 / 360)).toBeLessThan(0.02);
    // The open run shows each side's own length on the side (Drawboard's
    // segment captions); they add up to its total. A closed Perimeter has none.
    const segCaps = surfaceB.locator('.measure-segment-captions [data-segment-caption]');
    await expect(segCaps).toHaveCount(3);
    const segFt = await segCaps.evaluateAll((els) => els.map((el) => Number(el.textContent.replace(/[^\d.]/g, ''))));
    expect(Math.abs(segFt[0] / segFt[1] - 2)).toBeLessThan(0.05);
    expect(Math.abs(segFt.reduce((a, b) => a + b, 0) - open) / open).toBeLessThan(0.01);
    // The Measurement card's Segment captions: Upright sets them level, Off
    // hides them; a Perimeter (off by default) shows its four sides on Inline.
    const barB = page.locator('[data-selection-quick-bar][data-visible="true"]');
    await page.keyboard.press('v');
    await page.mouse.click(sb.x + 180, sb.y + 120);
    await expect(barB).toBeVisible();
    await barB.getByRole('button', { name: 'Measurement' }).click();
    const cardB = page.getByRole('dialog', { name: 'Measurement' });
    await expect(cardB.locator('[data-measure-edit-segments="inline"]')).toHaveAttribute('aria-pressed', 'true');
    await cardB.locator('[data-measure-edit-segments="upright"]').click();
    await expect(cardB.locator('[data-measure-edit-segments="upright"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(segCaps).toHaveCount(3);
    const turns = await segCaps.evaluateAll((els) => els.map((el) => el.getAttribute('transform')));
    expect(turns.every((t) => /^rotate\(0 /.test(t))).toBe(true);
    await cardB.locator('[data-measure-edit-segments="off"]').click();
    await expect(segCaps).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.mouse.click(sb.x + 180, sb.y + 480);
    await expect(barB).toBeVisible();
    await barB.getByRole('button', { name: 'Measurement' }).click();
    await expect(cardB.locator('[data-measure-edit-segments="off"]')).toHaveAttribute('aria-pressed', 'true');
    await cardB.locator('[data-measure-edit-segments="inline"]').click();
    await expect(segCaps).toHaveCount(4);
    await page.screenshot({ path: test.info().outputPath('measure-plus-segments.png') });
    await page.keyboard.press('Escape');
    await page.screenshot({ path: test.info().outputPath('measure-plus-perimeter.png') });
  } finally {
    if (!process.env.KEEP) await admin.from('documents').delete().in('id', ids);
  }
});

test('calibrate: Drawboard\'s note with a close x; a traced span typed as 40\' reads back exactly 40′', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem('survey.flag.measure-plus', '1');
    // The plain chip flag stays off: the calibrating note shows anyway.
    localStorage.setItem('survey.flag.measure-scale-chip', '0');
    localStorage.setItem('survey.flag.measure-edit', '1');
    localStorage.removeItem('survey.measure.defaultScale');
  });
  const owner = E2E_ACCOUNTS.owner;
  const admin = adminClient();
  const api = await apiClientFor(owner);
  const { data: { user } } = await api.auth.getUser();
  const name = `Calibrate ${RUN}.pdf`;
  const id = await seedDocument(admin, user.id, name, 'Calibrate page');
  try {
    await signIn(page, owner);
    const surface = await openDocument(page, name, 'Calibrate page');
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    let dialog = await openScaleDialog(page);
    await dialog.getByText('Calibrate instead').click();
    await expect(dialog).toBeHidden();
    const note = page.locator('[data-measure-calibrating]');
    await expect(note).toContainText('Trace a known distance to set the scale');
    // The x puts the tool down.
    await note.getByRole('button', { name: 'Stop calibrating' }).click();
    await expect(note).toHaveCount(0);

    dialog = await openScaleDialog(page);
    await dialog.getByText('Calibrate instead').click();
    await expect(note).toBeVisible();
    const box = await surface.boundingBox();
    await page.mouse.move(box.x + 150, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 450, box.y + 300, { steps: 8 });
    await page.mouse.up();
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-measure-real-length]').fill("40'");
    await dialog.locator('[data-measure-apply]').click();
    await expect(dialog).toBeHidden();
    await expect(note).toHaveCount(0);
    // The traced line stays as a Length (a dimension line) reading exactly
    // 40′: the full traced length is kept, not rounded.
    const kept = surface.locator('[data-dimension-line] text[data-dimension-caption]');
    await expect(kept).toHaveCount(1, { timeout: 15_000 });
    await expect(kept).toHaveText('40′');
    await expect(surface.locator('.measure-labels .measure-label[data-measure-kind="length"]')).toHaveCount(0);
    // Length stays armed after calibrating: a new one over the same span
    // elsewhere reads the same.
    await expect(page.locator('[data-measure-tool="length"][aria-pressed="true"], [data-measure-tool="menu"][aria-pressed="true"]').first()).toBeVisible();
    await page.mouse.move(box.x + 150, box.y + 480);
    await page.mouse.down();
    await page.mouse.move(box.x + 450, box.y + 480, { steps: 8 });
    await page.mouse.up();
    await expect(kept).toHaveCount(2, { timeout: 15_000 });
    await expect(kept.nth(1)).toHaveText('40′');

    // Per-mark scale: the second Length picks 1/4" = 1' in the Measurement
    // card and reads on it; the first stays on the page's 40′.
    const bar = page.locator('[data-selection-quick-bar][data-visible="true"]');
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    const second = surface.locator('[data-dimension-line]').nth(1);
    const seg = await second.locator('line').nth(2).boundingBox();
    await page.mouse.click(seg.x + seg.width / 2, seg.y + seg.height / 2);
    await expect(bar).toBeVisible();
    await bar.getByRole('button', { name: 'Measurement' }).click();
    const card = page.getByRole('dialog', { name: 'Measurement' });
    await expect(card.locator('[data-measure-edit-scale]')).toHaveAttribute('data-measure-edit-scale', 'page');
    await card.locator('[data-measure-edit-scale] button').first().click();
    await page.getByRole('listbox', { name: 'Scale' }).getByRole('option', { name: `1/4" = 1'`, exact: true }).click();
    await expect(card.locator('[data-measure-edit-scale]')).toHaveAttribute('data-measure-edit-scale', '1/4');
    await expect(kept.nth(1)).not.toHaveText('40′');
    await expect(kept.nth(0)).toHaveText('40′');
    const inchesOf = async (loc) => feetInches(await loc.textContent());
    const quarter = await inchesOf(kept.nth(1));
    expect(quarter).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await expect(bar).toHaveCount(0);

    // A new page scale (1/8" = 1') moves the first, to twice the 1/4" one,
    // but not the one on its own scale; "Apply to existing measurements"
    // brings that one along too.
    dialog = await openScaleDialog(page);
    // A calibrated scale reopens on Custom; presets are one tap away.
    await dialog.locator('[data-measure-scale-kind-option="preset"]').click();
    await dialog.locator('[data-measure-preset-option="1/8"]').click();
    await expect(dialog.locator('[data-measure-apply-existing]')).not.toBeChecked();
    await dialog.locator('[data-measure-apply]').click();
    await expect(kept.nth(0)).not.toHaveText('40′');
    expect(Math.abs((await inchesOf(kept.nth(0))) - 2 * quarter)).toBeLessThanOrEqual(0.5);
    expect(await inchesOf(kept.nth(1))).toBe(quarter);
    dialog = await openScaleDialog(page);
    await dialog.locator('[data-measure-scale-kind-option="preset"]').click();
    await dialog.locator('[data-measure-preset-option="1/8"]').click();
    await dialog.locator('[data-measure-apply-existing]').check();
    await dialog.locator('[data-measure-apply]').click();
    await expect.poll(() => inchesOf(kept.nth(1))).not.toBe(quarter);
    expect(await kept.nth(1).textContent()).toBe(await kept.nth(0).textContent());
  } finally {
    if (!process.env.KEEP) await admin.from('documents').delete().eq('id', id);
  }
});

test('custom scales: an applied one is listed in Set page scale and the Measurement card, and its x removes it', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem('survey.flag.measure-plus', '1');
    localStorage.setItem('survey.flag.measure-edit', '1');
    if (!sessionStorage.getItem('custom-scales-reset')) {
      localStorage.removeItem('survey.measure.defaultScale');
      localStorage.removeItem('survey:measure-custom-scales');
      sessionStorage.setItem('custom-scales-reset', '1');
    }
  });
  const owner = E2E_ACCOUNTS.owner;
  const admin = adminClient();
  const api = await apiClientFor(owner);
  const { data: { user } } = await api.auth.getUser();
  const name = `Custom scales ${RUN}.pdf`;
  const id = await seedDocument(admin, user.id, name, 'Custom scales page');
  try {
    await signIn(page, owner);
    const surface = await openDocument(page, name, 'Custom scales page');
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    let dialog = await openScaleDialog(page);
    await expect(dialog.locator('[data-measure-custom-scales]')).toHaveCount(0);
    await dialog.locator('[data-measure-scale-kind-option="custom"]').click();
    await dialog.locator('[data-measure-custom-paper]').fill('1');
    await dialog.locator('[data-measure-custom-real]').fill("8'");
    // The Title starts empty and shows what the numbers read.
    await expect(dialog.locator('[data-measure-custom-title]')).toHaveAttribute('placeholder', '1″ = 8′');
    await dialog.locator('[data-measure-apply]').click();
    await expect(dialog).toBeHidden();
    // A second custom scale, in metres.
    dialog = await openScaleDialog(page);
    await dialog.locator('[data-measure-scale-kind-option="custom"]').click();
    await pick(page, dialog, 'data-measure-display', 'Units', 'm');
    await dialog.locator('[data-measure-custom-paper]').fill('2');
    await dialog.locator('[data-measure-custom-real]').fill('10');
    await dialog.locator('[data-measure-apply]').click();
    await expect(dialog).toBeHidden();

    dialog = await openScaleDialog(page);
    const chips = dialog.locator('[data-measure-custom-scale]');
    await expect(chips).toHaveCount(2);
    await expect(chips.nth(0)).toHaveText('2″ = 10 m');
    await expect(chips.nth(0)).toHaveAttribute('aria-checked', 'true');
    await expect(chips.nth(1)).toHaveText('1″ = 8′');
    await page.screenshot({ path: test.info().outputPath('measure-plus-custom-scales.png') });
    // A chip fills the custom row with what was typed.
    await chips.nth(1).click();
    await expect(dialog.locator('[data-measure-custom-real]')).toHaveValue("8'");
    await expect(valueOf(dialog, 'data-measure-display')).toHaveAttribute('data-value', 'ftin');
    await expect(chips.nth(1)).toHaveAttribute('aria-checked', 'true');
    await dialog.locator('[data-measure-apply]').click();
    await expect(dialog).toBeHidden();

    // The Measurement card's Scale list ends with them; picking one puts the
    // mark on it.
    const reading = await drawLength(page, surface, 150, 450, 300);
    const pageText = await reading.textContent();
    const bar = page.locator('[data-selection-quick-bar][data-visible="true"]');
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    const seg = await surface.locator('[data-dimension-line] line').nth(2).boundingBox();
    await page.mouse.click(seg.x + seg.width / 2, seg.y + seg.height / 2);
    await expect(bar).toBeVisible();
    await bar.getByRole('button', { name: 'Measurement' }).click();
    const card = page.getByRole('dialog', { name: 'Measurement' });
    await card.locator('[data-measure-edit-scale] button').first().click();
    const list = page.getByRole('listbox', { name: 'Scale' });
    await expect(list.getByRole('option', { name: '1″ = 8′', exact: true })).toBeVisible();
    await list.getByRole('option', { name: '2″ = 10 m', exact: true }).click();
    await expect(card.locator('[data-measure-edit-scale]')).toHaveAttribute('data-measure-edit-scale', /^custom:\d$/);
    await expect(reading).toHaveText(/ m$/);
    expect(await reading.textContent()).not.toBe(pageText);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);

    // The x takes a scale off the list, and it stays off after a reload.
    // Applied again, 1″ = 8′ is the newest.
    dialog = await openScaleDialog(page);
    await expect(chips.nth(0)).toHaveText('1″ = 8′');
    await dialog.locator('[data-measure-custom-scale-remove="1"]').click();
    await expect(chips).toHaveCount(1);
    await expect(chips.nth(0)).toHaveText('1″ = 8′');
    // A typed Title names a new custom scale.
    await chips.nth(0).click();
    await dialog.locator('[data-measure-custom-title]').fill('Site plan');
    await dialog.locator('[data-measure-apply]').click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page.getByText('Custom scales page')).toBeVisible({ timeout: 60_000 });
    dialog = await openScaleDialog(page);
    await expect(dialog).toContainText('now Site plan');
    await expect(dialog.locator('[data-measure-custom-title]')).toHaveValue('Site plan');
    await expect(dialog.locator('[data-measure-custom-scale]')).toHaveText(['Site plan', '1″ = 8′']);
  } finally {
    if (!process.env.KEEP) await admin.from('documents').delete().eq('id', id);
  }
});

test('without the flag the dialog has no custom scale, units or default', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => localStorage.setItem('survey.flag.measure-plus', '0'));
  const owner = E2E_ACCOUNTS.owner;
  const admin = adminClient();
  const api = await apiClientFor(owner);
  const { data: { user } } = await api.auth.getUser();
  const name = `Formats off ${RUN}.pdf`;
  const id = await seedDocument(admin, user.id, name, 'Formats page off');
  try {
    await signIn(page, owner);
    const surface = await openDocument(page, name, 'Formats page off');
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    const dialog = await openScaleDialog(page);
    await expect(dialog.locator('[data-measure-preset-option="1/4"]')).toBeVisible();
    for (const sel of ['[data-measure-custom-scales]', '[data-measure-scale-kind]', '[data-measure-display]', '[data-measure-precision]', '[data-measure-set-default]', '[data-measure-apply-existing]']) {
      await expect(dialog.locator(sel)).toHaveCount(0);
    }
    await dialog.locator('[data-measure-preset-option="1/4"]').click();
    await dialog.locator('[data-measure-apply]').click();
    const reading = await drawLength(page, surface, 150, 450, 300);
    await expect(reading).toHaveText(/^\d+' \d+"$/);
  } finally {
    if (!process.env.KEEP) await admin.from('documents').delete().eq('id', id);
  }
});

for (const layout of [{ name: 'phone web', native: false }, { name: 'phone app', native: true }]) {
  test.describe(`measure formats, ${layout.name}`, () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the custom row, Units and Precision fit and apply on a phone', async ({ page }) => {
      test.setTimeout(180_000);
      await page.addInitScript((native) => {
        localStorage.setItem('survey.flag.measure-plus', '1');
        if (native) window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} };
      }, layout.native);
      const owner = E2E_ACCOUNTS.owner;
      const admin = adminClient();
      const api = await apiClientFor(owner);
      const { data: { user } } = await api.auth.getUser();
      const name = `Formats ${layout.native ? 'app' : 'web'} ${RUN}.pdf`;
      const id = await seedDocument(admin, user.id, name, 'Formats phone page');
      try {
        await signIn(page, owner);
        await page.getByText(name, { exact: true }).filter({ visible: true }).first().tap();
        await page.waitForTimeout(1200);
        const open = page.getByRole('button', { name: 'Open file' });
        if (await open.isVisible().catch(() => false)) await open.tap();
        const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
        await expect(surface.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
        await page.waitForTimeout(1200);
        await page.getByRole('button', { name: 'Shapes', exact: true }).filter({ visible: true }).first().tap();
        await page.locator('[data-measure-tool="menu"]').filter({ visible: true }).first().tap();
        await page.getByText('Page scale…').filter({ visible: true }).first().tap();
        const dialog = page.getByRole('dialog', { name: 'Set page scale' });
        await expect(dialog).toBeVisible();
        await dialog.locator('[data-measure-scale-kind-option="custom"]').tap();
        await page.waitForTimeout(300);
        for (const sel of ['[data-measure-custom-row]', '[data-measure-display]', '[data-measure-precision]']) {
          const r = await dialog.locator(sel).boundingBox();
          expect(r.x, sel).toBeGreaterThanOrEqual(0);
          expect(r.x + r.width, sel).toBeLessThanOrEqual(390);
        }
        await dialog.locator('[data-measure-custom-paper]').fill('1');
        await dialog.locator('[data-measure-custom-real]').fill("8' 6\"");
        await dialog.locator('[data-measure-precision] button').first().tap();
        await page.getByRole('listbox', { name: 'Precision' }).getByRole('option', { name: '1/8', exact: true }).tap();
        await expect(valueOf(dialog, 'data-measure-precision')).toHaveAttribute('data-value', '8');
        await expect(dialog.locator('[data-measure-apply]')).toBeEnabled();
        await page.screenshot({ path: test.info().outputPath(`measure-plus-${layout.native ? 'app' : 'web'}.png`) });
        await dialog.locator('[data-measure-apply]').scrollIntoViewIfNeeded();
        await dialog.locator('[data-measure-apply]').tap();
        await expect(dialog).toBeHidden();
      } finally {
        if (!process.env.KEEP) await admin.from('documents').delete().eq('id', id);
      }
    });
  });
}
