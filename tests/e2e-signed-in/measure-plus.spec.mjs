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

async function drawLength(page, surface, x1, x2, y) {
  await page.locator('[data-measure-tool="menu"]').filter({ visible: true }).first().click();
  await page.locator('[data-measure-tool="length"]').click();
  const box = await surface.boundingBox();
  await page.mouse.move(box.x + x1, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y, { steps: 8 });
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

    const reading = await drawLength(page, surface, 150, 450, 300);
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
  } finally {
    if (!process.env.KEEP) await admin.from('documents').delete().in('id', ids);
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
    for (const sel of ['[data-measure-scale-kind]', '[data-measure-display]', '[data-measure-precision]', '[data-measure-set-default]']) {
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
