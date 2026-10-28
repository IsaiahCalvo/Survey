// Nightly beta 'own-excel-layouts' (plan 2026-10-27, step 1): upload the
// sheet your company uses, match its columns by hand, save it as your own
// Excel layout, pick it for a template, and Export data writes that layout.
import ExcelJS from 'exceljs';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { E2E_ACCOUNTS, E2E_SURVEY } from './accounts.mjs';
import { adminClient, clientFromPageSession, expect, signIn, test } from './helpers.mjs';

let original = null;

async function clearLayouts() {
  await adminClient().from('own_export_kits').delete().like('id', 'own-%');
}

test.beforeAll(async () => {
  const { data } = await adminClient().from('templates').select('config').eq('id', E2E_SURVEY.templateId).single();
  original = data.config;
  await clearLayouts();
});

test.afterAll(async () => {
  if (original) await adminClient().from('templates').update({ config: original }).eq('id', E2E_SURVEY.templateId);
  await clearLayouts();
});

async function theirSheet() {
  const book = new ExcelJS.Workbook();
  const ws = book.addWorksheet('Door schedule');
  // A title above the headers, as real schedules have.
  ws.addRow(['ACME DOOR SCHEDULE']);
  ws.addRow([]);
  ws.addRow(['Door No.', 'Fire rating', 'Checks', 'Remarks', 'Inspected by']);
  const file = join(mkdtempSync(join(tmpdir(), 'own-layout-')), 'Acme door schedule.xlsx');
  writeFileSync(file, Buffer.from(await book.xlsx.writeBuffer()));
  return file;
}

async function openTemplate(page) {
  await page.getByRole('tab', { name: /Templates/ }).or(page.getByRole('button', { name: /^Templates$/ })).filter({ visible: true }).first().click();
  await page.getByText(E2E_SURVEY.templateName, { exact: true }).filter({ visible: true }).first().click();
  const layout = page.getByRole('button', { name: 'Excel layout', exact: true }).filter({ visible: true }).first();
  await expect(layout).toBeVisible({ timeout: 30_000 });
  return layout;
}

test('flag off: no "Your own sheet" choice', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('survey.flag.own-excel-layouts', '0'));
  await signIn(page, E2E_ACCOUNTS.owner);
  const layout = await openTemplate(page);
  await layout.click();
  const list = page.getByRole('listbox', { name: 'Excel layout' });
  await expect(list.getByRole('option', { name: /Wireless lock schedule/ })).toHaveCount(1);
  await expect(list.getByRole('option', { name: /Your own sheet/ })).toHaveCount(0);
});

test('make a layout from your own sheet, pick it, and Export data uses it', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('survey.flag.own-excel-layouts', '1'));
  await signIn(page, E2E_ACCOUNTS.owner);
  const layout = await openTemplate(page);
  await layout.click();
  await page.getByRole('listbox', { name: 'Excel layout' }).getByRole('option', { name: 'Your own sheet…' }).click();

  const dialog = page.getByRole('dialog', { name: 'Your own Excel layout' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save layout' })).toBeDisabled();
  await dialog.getByLabel('Your Excel sheet').setInputFiles(await theirSheet());
  await expect(dialog.getByLabel('Layout name')).toHaveValue('Acme door schedule');
  const pick = async (column, choice) => {
    await dialog.getByRole('button', { name: `Survey puts in ${column}`, exact: true }).click();
    await page.getByRole('listbox', { name: `Survey puts in ${column}` }).getByRole('option', { name: choice, exact: true }).click();
  };
  await pick('Door No.', 'Item name');
  await pick('Checks', 'Checklist lines');
  await pick('Remarks', 'Notes');
  await pick('Inspected by', 'Changed by');
  await page.screenshot({ path: 'test-results/own-excel-layout.png' });
  await dialog.getByRole('button', { name: 'Save layout' }).click();
  await expect(dialog).toBeHidden();
  await expect(layout).toHaveAttribute('data-value', /^own-acme-door-schedule-[a-z0-9]+$/);
  const kitId = await layout.getAttribute('data-value');

  // Saved on the account, read only by its owner.
  const mine = await (await clientFromPageSession(page)).from('own_export_kits').select('id, label');
  expect(mine.data).toEqual([{ id: kitId, label: 'Acme door schedule' }]);

  await page.getByRole('button', { name: 'Save', exact: true }).filter({ visible: true }).first().click();
  await expect.poll(async () => {
    const { data } = await adminClient().from('templates').select('config').eq('id', E2E_SURVEY.templateId).single();
    return [data.config.exportKitId ?? null, data.config.ownExportKit?.columns?.[3]?.header ?? null];
  }, { timeout: 20_000 }).toEqual([kitId, 'Door No.']);

  // Export data on the survey writes their columns, in their order.
  // The template carries a copy of the layout, so it works for someone who
  // does not have it on their account: take it off this one and reload.
  await clearLayouts();
  await page.reload();
  await expect(layout).toHaveText(/Acme door schedule/, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Documents', exact: true }).or(page.getByRole('tab', { name: 'Documents', exact: true })).filter({ visible: true }).first().click();
  await page.getByText(E2E_SURVEY.documentName, { exact: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]:visible').first().waitFor({ timeout: 60_000 });
  const category = page.getByRole('button', { name: `Show Survey Markers in ${E2E_SURVEY.categoryName}` });
  // The drawing keeps the template as it was; the new layout is a new version.
  const latest = page.getByRole('button', { name: 'Use latest version' });
  if (!(await category.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Survey', exact: true }).click();
    const chooser = page.getByText('Choose a survey template', { exact: true });
    await expect(chooser.or(category).or(latest).first()).toBeVisible({ timeout: 30_000 });
    if (await chooser.isVisible()) await page.getByText(E2E_SURVEY.templateName, { exact: true }).last().click();
  }
  await latest.click({ timeout: 15_000 });
  await expect(category).toBeVisible();

  const download = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Export data' }).filter({ visible: true }).first().click();
  const file = await download;
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(readFileSync(await file.path()));
  const sheet = book.worksheets.find((ws) => ws.state === 'visible');
  const headers = sheet.getRow(1).values.slice(1);
  const lines = E2E_SURVEY.checklist.map((l) => l.text);
  expect(headers).toEqual(['Row ID', 'Inspected by', 'Changed Date', 'Door No.', ...lines, 'Remarks', 'Entity']);
});

test('another account can neither read your layouts nor add one for you', async () => {
  const { apiClientFor } = await import('./helpers.mjs');
  const db = adminClient();
  const { data: users } = await db.auth.admin.listUsers();
  const owner = users.users.find((u) => u.email === E2E_ACCOUNTS.owner.email);
  await db.from('own_export_kits').insert({ user_id: owner.id, id: 'own-private', label: 'Private', definition: { columns: [] } });
  const free = await apiClientFor(E2E_ACCOUNTS.free);
  expect((await free.from('own_export_kits').select('id')).data).toEqual([]);
  const forged = await free.from('own_export_kits').insert({ user_id: owner.id, id: 'own-forged', label: 'Forged', definition: {} });
  expect(forged.error).toBeTruthy();
  await free.auth.signOut();
});
