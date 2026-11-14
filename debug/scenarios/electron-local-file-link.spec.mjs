// Desktop app: a PDF opened from the computer saves back to that file with
// Cmd/Ctrl+S, and a change another app makes to it is noticed at once and
// never overwritten (flag 'outside-edits', src/services/localFileLink.js,
// 2026-11-14). Drawboard for Mac writes back but never notices the other
// app, so its next Save wipes that app's work.
//
// Run: start Vite on ELECTRON_REPRO_PORT (default 5203), then
//   xvfb-run -a npx playwright test debug/scenarios/electron-local-file-link.spec.mjs --trace off
import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { dragPage, tool } from './test-plan/tp-actions.mjs';

const PORT = process.env.ELECTRON_REPRO_PORT || '5203';
const OUT = process.env.LFL_OUT || null;

let app;
let page;
let dir;

test.describe.configure({ mode: 'serial', timeout: 180_000 });

async function sourcePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText('Local file link', { x: 72, y: 720, size: 24, font });
  return Buffer.from(await pdf.save());
}

const shot = async (name) => { if (OUT) await page.screenshot({ path: join(OUT, `${name}.png`) }); };
const toast = (text) => page.getByText(text).filter({ visible: true }).first();
const squaresIn = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  return (doc.getPage(0).node.Annots()?.asArray() || [])
    .map((ref) => doc.context.lookup(ref, PDFDict))
    .filter((d) => d.get(PDFName.of('Subtype')) === PDFName.of('Square'));
};

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'survey-lfl-'));
  writeFileSync(join(dir, 'plan.pdf'), await sourcePdf());
  app = await electron.launch({
    args: ['.', `--user-data-dir=${join(dir, 'user-data')}`],
    env: { ...process.env, NODE_ENV: 'development', DEV_PORT: PORT, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
  });
  page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message, (e.stack || '').split('\n').slice(0, 6).join(' | ')));
  page.on('console', async (m) => {
    if (m.type() !== 'error') return;
    const parts = await Promise.all(m.args().map((a) => a.evaluate((v) => (v && v.stack) ? v.stack : (v && v.componentStack) ? v.componentStack.slice(0, 600) : String(v)).catch(() => '?')));
    console.log('[console.error]', parts.join(' || ').slice(0, 2500));
  });
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => {
    localStorage.setItem('survey.flag.outside-edits', '1');
    localStorage.setItem('survey.flag.device-files', '1');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  // The Open dialog answers with our file (the real one needs a person).
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, join(dir, 'plan.pdf'));
});

test.afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => app?.close().catch(() => {}));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('save back, notice another app, never overwrite it', async () => {
  const file = join(dir, 'plan.pdf');
  const original = readFileSync(file);

  // Open the file from the computer, signed out.
  const upload = page.getByRole('button', { name: 'Upload', exact: true }).filter({ visible: true }).first();
  await expect(upload).toBeVisible({ timeout: 60_000 });
  // Signed out, the sign-in sheet opens at start; a person closes it first.
  const sheet = page.locator('.auth-modal-overlay');
  await page.waitForTimeout(1_000);
  if (await sheet.isVisible()) { await page.keyboard.press('Escape'); await expect(sheet).toBeHidden({ timeout: 10_000 }); }
  await upload.click();
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1_500);
  await shot('01-open');

  // A rectangle, then Ctrl+S writes the marked-up PDF over the file.
  await tool(page, 'Shapes', 'Rectangle');
  await dragPage(page, 1, [[60, 80], [140, 120], [220, 160]]);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  await page.mouse.click(5, 300);
  await page.keyboard.press('Control+S');
  await expect(toast('Saved to plan.pdf')).toBeVisible({ timeout: 20_000 });
  await shot('02-saved');
  const saved = readFileSync(file);
  expect(Buffer.compare(saved, original)).not.toBe(0);
  const squares = await squaresIn(saved);
  expect(squares).toHaveLength(1);
  // Survey's own write is not "another app": no notice.
  await page.waitForTimeout(2_000);
  await expect(page.getByText('was changed in another app')).toHaveCount(0);

  // "Acrobat" recolours the mark and saves.
  const doc = await PDFDocument.load(saved);
  const [square] = (doc.getPage(0).node.Annots()?.asArray() || [])
    .map((ref) => doc.context.lookup(ref, PDFDict))
    .filter((d) => d.get(PDFName.of('Subtype')) === PDFName.of('Square'));
  square.set(PDFName.of('C'), doc.context.obj([0, 0, 1]));
  const theirs = Buffer.from(await doc.save());
  writeFileSync(file, theirs);
  await expect(toast('plan.pdf was changed in another app.')).toBeVisible({ timeout: 20_000 });
  await shot('03-noticed');

  // Ctrl+S now refuses to overwrite their work.
  await page.keyboard.press('Control+S');
  await expect(toast('so it was not overwritten')).toBeVisible({ timeout: 20_000 });
  await shot('04-refused');
  expect(Buffer.compare(readFileSync(file), theirs)).toBe(0);

  // "Open the changed file" opens what the other app saved, blue mark and all.
  await page.getByRole('button', { name: 'Open the changed file' }).first().click();
  await expect.poll(async () => page.evaluate(() => [...document.querySelectorAll('[data-overlay-page="1"]')]
    .filter((n) => n.checkVisibility())
    .flatMap((n) => [...n.querySelectorAll('rect[stroke]')])
    .map((n) => String(n.getAttribute('stroke')).toLowerCase())), { timeout: 60_000 }).toContain('#0000ff');
  await expect(page.getByText('so it was not overwritten')).toHaveCount(0);
  await shot('05-reopened');
});
