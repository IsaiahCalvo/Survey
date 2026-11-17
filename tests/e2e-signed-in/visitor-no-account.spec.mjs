// KAL-658: a visitor uses Survey with no account. The no-account flags are
// not set in the browser (that path is on for everyone). They close the sign-in
// card, upload a PDF, mark it up, change its pages and export it. A reload
// brings the file back with its marks and its page changes. The tools that
// need an account say so and offer Sign in, and the server is never asked
// about a file it does not hold.
import fs from 'node:fs';
import { PDFDocument } from '@cantoo/pdf-lib';
import { DESKTOP, PHONE } from '../../debug/scenarios/test-plan/tp-local-doc.mjs';
import { expect, test } from './helpers.mjs';

const PAGE = '.survey-pdfjs-page-div[data-page-number="1"]';
const FIXTURE = 'debug/fixtures/order-pages.pdf'; // 8 pages
const NAME = 'Visitor pages.pdf';

const marks = (page) => page.evaluate(() => document.querySelectorAll('[data-annotation-id]').length);
const pageCount = (page) => page.evaluate(() => document.querySelectorAll('.survey-pdfjs-page-div').length);

async function drawBox(page) {
  const box = await page.locator(PAGE).boundingBox();
  await page.keyboard.press('r');
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
}

async function openAsVisitor(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Continue without an account' }).click({ timeout: 60_000 });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Upload PDF' }).filter({ visible: true }).first().click();
  await (await chooser).setFiles({ name: NAME, mimeType: 'application/pdf', buffer: fs.readFileSync(FIXTURE) });
  await expect(page.locator(PAGE)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('dialog', { name: 'Welcome back' })).toHaveCount(0);
  await page.waitForTimeout(1_500);
}

test.describe('desktop', () => {
  test.use(DESKTOP);

  test('a visitor uploads, marks up, changes pages and exports; a reload keeps it all', async ({ page }) => {
    test.setTimeout(240_000);
    // Anything sent to the server that names the file kept on this device.
    const leaked = [];
    page.on('request', (request) => {
      if (/device-[0-9a-f-]{8,}/.test(`${request.url()} ${request.postData() || ''}`)) leaked.push(`${request.method()} ${request.url()}`);
    });

    // The Comments tab has its own flag, which a fresh test database leaves off.
    await page.addInitScript(() => localStorage.setItem('survey.flag.mark-comments', '1'));
    await openAsVisitor(page);
    await drawBox(page);
    await expect.poll(() => marks(page)).toBe(1);

    await page.getByRole('button', { name: 'Pages', exact: true }).first().click();
    await page.getByRole('button', { name: 'Page 3 actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('Deleted page 3')).toBeVisible();
    await expect.poll(() => pageCount(page)).toBe(7);

    // Export: the PDF that leaves has the seven pages and the mark.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export annotated PDF' }).click();
    const exported = await PDFDocument.load(fs.readFileSync(await (await download).path()));
    expect(exported.getPageCount()).toBe(7);
    expect(exported.getPage(0).node.Annots()?.size() ?? 0).toBe(1);

    // The tools that need an account say so; Sign in on the toast opens the card.
    await page.getByRole('button', { name: 'Survey', exact: true }).first().click();
    const ask = page.getByText('Survey tools need an account. Sign in to use them.');
    await expect(ask.first()).toBeVisible();
    await expect(page.getByText('Choose a survey template')).toHaveCount(0);
    await page.getByRole('button', { name: 'Comments', exact: true }).first().click();
    await expect(page.locator('[data-needs-account="comments"]')).toContainText('Comments are for files in an account');
    await page.getByRole('button', { name: 'History', exact: true }).first().click();
    await expect(page.locator('[data-needs-account="history"]')).toContainText('History starts once this file is in an account');
    await page.locator('[data-needs-account="history"]').getByRole('button', { name: 'Sign in' }).click();
    const card = page.getByRole('dialog', { name: 'Welcome back' });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Close' }).click();
    await expect(card).toBeHidden();

    // A reload: the file is listed, and opens with seven pages and the mark.
    await page.waitForTimeout(1_000);
    await page.reload({ waitUntil: 'domcontentloaded' });
    // Closing the card counts as going on without an account for the tab
    // (KAL-752), so it does not come back on the reload.
    await expect(page.getByText('These files are only on this device', { exact: false }).filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Continue without an account' })).toHaveCount(0);
    await page.getByText(NAME, { exact: true }).filter({ visible: true }).first().dblclick();
    await expect(page.locator(PAGE)).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => pageCount(page), { timeout: 20_000 }).toBe(7);
    await expect.poll(() => marks(page), { timeout: 20_000 }).toBe(1);

    expect(leaked, leaked.join('\n')).toEqual([]);
  });
});

test.describe('phone', () => {
  test.use(PHONE);

  test('a visitor opens a PDF and is told Survey tools need an account', async ({ page }) => {
    test.setTimeout(180_000);
    await openAsVisitor(page);
    await page.getByRole('button', { name: 'Open survey' }).click();
    await expect(page.getByText('Survey tools need an account. Sign in to use them.').first()).toBeVisible();
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(page.locator('[data-needs-account="history"]').filter({ visible: true }).first()).toBeVisible();
  });
});
