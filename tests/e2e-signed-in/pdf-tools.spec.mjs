import { PDFDocument } from 'pdf-lib';
import { E2E_ACCOUNTS, E2E_DOCUMENT, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, openSampleDocument, signIn, test } from './helpers.mjs';

// PDF tools inside the app (src/components/PdfToolsDialog.jsx): run a tool on
// a stored document and save the result as a new document next to it.

const ROTATED = 'E2E Sample Drawing (rotated).pdf';

async function removeRotatedCopies() {
  const admin = adminClient();
  const { data: rows } = await admin.from('documents').select('id, file_path').eq('name', ROTATED);
  for (const row of rows || []) {
    if (row.file_path) await admin.storage.from('documents').remove([row.file_path]);
    await admin.from('documents').delete().eq('id', row.id);
  }
}

test.beforeEach(removeRotatedCopies);
test.afterEach(removeRotatedCopies);

test('owner rotates a document from the Documents list and saves it as a new document', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(E2E_DOCUMENT.name, { exact: true }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'PDF tools…' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(E2E_DOCUMENT.name)).toBeVisible();
  await dialog.getByRole('button', { name: /Rotate pages/ }).click();
  await dialog.getByRole('button', { name: 'Turn every page' }).click({ timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Run' }).click();
  await expect(dialog.getByText('Your document is ready')).toBeVisible({ timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Save as new document' }).click();
  await expect(dialog.getByText('Saved as a new document')).toBeVisible({ timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Done' }).click();

  // The copy is a real document in the same project, and its page is turned.
  const admin = adminClient();
  await expect.poll(async () => {
    const { data } = await admin.from('documents').select('id').eq('name', ROTATED).eq('project_id', E2E_PROJECT.id);
    return data?.length || 0;
  }, { timeout: 30_000 }).toBe(1);
  const { data: row } = await admin.from('documents').select('file_path').eq('name', ROTATED).single();
  const { data: blob, error } = await admin.storage.from('documents').download(row.file_path);
  expect(error).toBeNull();
  const pdf = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
  expect(pdf.getPage(0).getRotation().angle).toBe(90);
  // The original is untouched.
  const { data: original } = await admin.from('documents').select('name').eq('id', E2E_DOCUMENT.id).single();
  expect(original.name).toBe(E2E_DOCUMENT.name);
});

test('the viewer export menu opens PDF tools on the open document', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSampleDocument(page);
  await page.getByRole('button', { name: 'More export options' }).click();
  await page.getByRole('menuitem', { name: 'PDF tools…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(E2E_DOCUMENT.name)).toBeVisible();
  await dialog.getByRole('button', { name: /Compress/ }).click();
  await dialog.getByRole('button', { name: 'Run' }).click();
  await expect(dialog.getByText('Your document is ready')).toBeVisible({ timeout: 60_000 });
  await expect(dialog.getByRole('button', { name: 'Save as new document' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the document menu opens PDF tools as a full-screen sheet', async ({ page }) => {
    await signIn(page, E2E_ACCOUNTS.owner);
    const row = page.getByText(E2E_DOCUMENT.name, { exact: true }).filter({ visible: true }).first();
    await expect(row).toBeVisible();
    await page.getByRole('button', { name: 'More', exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('menuitem', { name: 'PDF tools…' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: /Split/ })).toBeVisible();
    // Polled: the dialog opens with a short scale-up (styles/motion.css).
    await expect.poll(async () => Math.round((await dialog.boundingBox()).width)).toBe(390);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);
    await dialog.getByRole('button', { name: 'Close' }).click();
  });
});
