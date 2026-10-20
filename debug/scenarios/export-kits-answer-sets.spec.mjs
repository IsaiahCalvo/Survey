// Custom builds library end to end (export kits #865/#868, answer sets #869).
//
// Picks an Excel layout and an answer set on a template in the real template
// editor, opens the real viewer, places a survey marker, answers its checklist,
// exports to Excel and reads the downloaded workbook: header order, column
// mapping, the answer dropdown, the Entity dropdown and centred cells.
// The standard template must still export exactly today's layout.
//
//   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5199 npx playwright test \
//     --config debug/playwright.config.mjs debug/scenarios/export-kits-answer-sets.spec.mjs
// Local fake data only; every request off the dev server is blocked.
import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';

const ENTITIES = [{ id: 'gw1', name: 'GW-1', color: '#2563eb' }, { id: 'gw2', name: 'GW-2', color: '#ef4444' }];
const CHECKLIST = [{ id: 'lt', text: 'Lock type ok' }, { id: 'ir', text: 'Gateway in range' }];
const template = (id, name) => ({
  id, name, entities: ENTITIES,
  modules: [{ id: `${id}-m`, name: 'Doors', categories: [{ id: `${id}-c`, name: 'Level 1', checklist: CHECKLIST }] }],
});
const TEMPLATES = [template('std', 'Standard Survey'), template('lock', 'Lock Survey')];

test.use({
  video: 'off',
  acceptDownloads: true,
  ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
});
test.describe.configure({ timeout: 240_000, mode: 'serial' });

async function seed(context) {
  await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
  await context.addInitScript((t) => { if (!localStorage.getItem('mobileWorkflowTemplates')) localStorage.setItem('mobileWorkflowTemplates', JSON.stringify(t)); }, TEMPLATES);
}

// Pick the layout and answers for "Lock Survey" in the template editor, then save.
async function pickInEditor(page) {
  await page.goto('/?hubPreview=1&workflowE2E=1&signedIn=1');
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 90_000 });
  await page.getByRole('tab', { name: /Templates/ }).or(page.getByRole('button', { name: /^Templates$/ })).first().click();
  await page.getByText('Lock Survey', { exact: true }).first().click();
  await page.getByRole('combobox', { name: 'Excel layout' }).selectOption('wireless-lock-schedule');
  await page.getByRole('combobox', { name: 'Checklist answers' }).selectOption('pass-fail-na');
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await expect.poll(async () => page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('mobileWorkflowTemplates') || '[]').find((x) => x.name === 'Lock Survey');
    return t ? `${t.exportKitId}|${(t.answerSet || []).map((a) => a.value).join(',')}` : null;
  }), { timeout: 15_000 }).toBe('wireless-lock-schedule|Pass,Fail,N/A');
}

// Open the viewer on `templateName`, place one marker on GW-1, answer both items, export.
async function surveyAndExport(page, templateName, answers) {
  await page.goto('/?testPdf=clickable-link-test.pdf&surveyTemplateWorkflowE2E=1');
  await page.getByRole('toolbar', { name: 'Survey panel', exact: true }).getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(templateName) }).click();
  const layer = page.locator('[data-svg-annotation-layer]').first();
  await expect(layer).toBeVisible({ timeout: 60_000 });
  const box = await layer.boundingBox();
  await page.mouse.move(box.x + 90, box.y + 100); await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 160, { steps: 8 }); await page.mouse.up();
  const modal = page.getByRole('dialog', { name: 'Categorize Survey Marker' });
  if (await modal.isVisible().catch(() => false)) {
    const cat = modal.getByRole('combobox', { name: 'Category', exact: true });
    if (await cat.count()) await cat.selectOption({ index: 1 }).catch(() => {});
    await modal.getByRole('combobox', { name: 'Entity', exact: true }).selectOption('gw1');
    await modal.getByRole('button', { name: 'Add Survey Marker' }).click();
    await expect(modal).toBeHidden();
  }
  const rail = page.locator('.survey-rail');
  const marker = rail.locator('[id^="highlight-item-"]').first();
  for (const [itemText, value] of answers) {
    await marker.getByRole('group', { name: itemText }).getByRole('button', { name: value, exact: true }).click();
  }
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    rail.getByRole('button', { name: 'Export to Excel' }).click(),
  ]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c)));
  return wb;
}

const sheetOf = (wb) => wb.worksheets.find((s) => !s.name.startsWith('_') && s.rowCount > 0);
const rowValues = (ws, n) => ws.getRow(n).values.slice(1);
const listOf = (cell) => cell.dataValidation?.formulae?.[0];

test('standard template exports today\'s layout with Y / N / N/A', async ({ page, context }) => {
  await seed(context);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const wb = await surveyAndExport(page, 'Standard Survey', [['Lock type ok', 'Y'], ['Gateway in range', 'N/A']]);
  const ws = sheetOf(wb);
  expect(rowValues(ws, 1)).toEqual(['Row ID', 'Changed By', 'Changed Date', 'Item', 'Lock type ok', 'Gateway in range', 'Entity', 'Notes']);
  const r2 = rowValues(ws, 2);
  expect(r2.slice(4, 7)).toEqual(['Y', 'N/A', 'GW-1']);
  expect(listOf(ws.getCell('E2'))).toBe('"Y,N,N/A"');
  expect(ws.getCell('E2').dataValidation.error).toBe('Please select Y, N, or N/A');
  expect(listOf(ws.getCell('G2'))).toBe('"GW-1,GW-2"');
  expect(ws.getCell('G2').alignment?.horizontal).toBe('center');
  expect(ws.getCell('H2').alignment?.horizontal).toBeUndefined();
  expect(ws.getColumn(8).width).toBe(50);
  expect(errors).toEqual([]);
});

test('editor-picked lock layout and Pass / Fail answers reach the workbook', async ({ page, context }) => {
  await seed(context);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await pickInEditor(page);
  const wb = await surveyAndExport(page, 'Lock Survey', [['Lock type ok', 'Pass'], ['Gateway in range', 'Fail']]);
  const ws = sheetOf(wb);
  expect(rowValues(ws, 1)).toEqual(['Row ID', 'Changed By', 'Changed Date', 'Door', 'Gateway', 'Lock type ok', 'Gateway in range', 'Notes']);
  const r2 = rowValues(ws, 2);
  expect(r2.slice(4, 7)).toEqual(['GW-1', 'Pass', 'Fail']);
  // Entity dropdown on the Gateway column (E), answer dropdown on F:G.
  expect(listOf(ws.getCell('E2'))).toBe('"GW-1,GW-2"');
  expect(listOf(ws.getCell('F2'))).toBe('"Pass,Fail,N/A"');
  expect(listOf(ws.getCell('G2'))).toBe('"Pass,Fail,N/A"');
  for (const a of ['A2', 'D2', 'E2', 'F2', 'G2']) expect(ws.getCell(a).alignment?.horizontal, a).toBe('center');
  expect(ws.getCell('H2').alignment?.horizontal).toBeUndefined();
  expect(ws.getColumn(8).width).toBe(50);
  expect(ws.getColumn(1).hidden).toBe(true);
  // Import maps the renamed headers back: tests/exportFormatsRegistry.test.mjs (toStandardHeaders).
  expect(errors).toEqual([]);
});
