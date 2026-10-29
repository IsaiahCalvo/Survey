// Excel sync audit (2026-10-28): "Export data" in the browser is a plain copy.
// It used to register a new live workbook, which for an owner retired the real
// shared workbook (linked from the desktop app) so it refused every sync after.
// The download must leave the live registration alone, carry no sync token, and
// carry the hidden sheet -> category list the import now matches sheets by.
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { E2E_ACCOUNTS, E2E_SURVEY } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

const LIVE_WORKBOOK_ID = 'wb_e2e_live_desktop_link';

async function clearRegistrations() {
  await adminClient().from('excel_workbook_registrations').delete()
    .eq('document_id', E2E_SURVEY.documentId).eq('template_id', E2E_SURVEY.templateId);
}

test.beforeAll(async () => {
  const db = adminClient();
  await clearRegistrations();
  const { data: users } = await db.auth.admin.listUsers();
  const owner = users.users.find((u) => u.email === E2E_ACCOUNTS.owner.email);
  // The workbook the owner linked from the desktop app.
  const { error } = await db.from('excel_workbook_registrations').insert({
    document_id: E2E_SURVEY.documentId,
    template_id: E2E_SURVEY.templateId,
    workbook_id: LIVE_WORKBOOK_ID,
    token_hash: 'e2e-not-a-real-hash',
    token_expiry: new Date(Date.now() + 86_400_000).toISOString(),
    capability_tier: 'local',
    registered_by: owner.id,
  });
  expect(error).toBeNull();
});

test.afterAll(clearRegistrations);

test('an owner\'s browser download keeps the live workbook and carries the sheet list', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByRole('button', { name: 'Documents', exact: true }).or(page.getByRole('tab', { name: 'Documents', exact: true })).filter({ visible: true }).first().click();
  await page.getByText(E2E_SURVEY.documentName, { exact: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]:visible').first().waitFor({ timeout: 60_000 });

  const category = page.getByRole('button', { name: `Show Survey Markers in ${E2E_SURVEY.categoryName}` });
  const latest = page.getByRole('button', { name: 'Use latest version' });
  if (!(await category.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Survey', exact: true }).click();
    const chooser = page.getByText('Choose a survey template', { exact: true });
    await expect(chooser.or(category).or(latest).first()).toBeVisible({ timeout: 30_000 });
    if (await chooser.isVisible()) await page.getByText(E2E_SURVEY.templateName, { exact: true }).last().click();
  }
  if (await latest.isVisible({ timeout: 5_000 }).catch(() => false)) await latest.click();
  await expect(category).toBeVisible({ timeout: 30_000 });

  const download = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Export data' }).filter({ visible: true }).first().click();
  const file = await download;
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(readFileSync(await file.path()));

  // The live workbook is still the live one, and no new registration was made.
  const { data: regs } = await adminClient().from('excel_workbook_registrations')
    .select('workbook_id, revoked_at')
    .eq('document_id', E2E_SURVEY.documentId).eq('template_id', E2E_SURVEY.templateId);
  expect(regs).toEqual([{ workbook_id: LIVE_WORKBOOK_ID, revoked_at: null }]);

  const meta = book.getWorksheet('_SurveyMetadata');
  expect(meta).toBeTruthy();
  expect(meta.getCell('B5').value ?? null).toBeNull(); // no workbook id
  expect(meta.getCell('B6').value ?? null).toBeNull(); // no sync token

  // The hidden sheet list names the visible sheet with its space and category ids.
  const visible = book.worksheets.filter((ws) => ws.state === 'visible').map((ws) => ws.name);
  const rows = [];
  for (let r = 10; meta.getCell(`A${r}`).value === 'sheet'; r += 1) {
    rows.push([meta.getCell(`B${r}`).value, meta.getCell(`C${r}`).value, meta.getCell(`D${r}`).value]);
  }
  const doorSheet = rows.find((row) => row[2] === E2E_SURVEY.categoryId);
  expect(doorSheet).toBeTruthy();
  expect(doorSheet[1]).toBe(E2E_SURVEY.moduleId);
  expect(visible).toContain(doorSheet[0]);
});
