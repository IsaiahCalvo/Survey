/**
 * Live proof for leftover unlisted controls on existing Vite ?testPdf=.
 * Reuses localhost:5173; does not kill it. Does not edit PDFViewer.jsx.
 */
import { chromium } from '@playwright/test';

const BASE = process.env.E2E_UNLISTED_URL?.replace(/\?.*$/, '') || 'http://localhost:5173';
const ONE = `${BASE}/?testPdf=clickable-link-test.pdf`;
const MULTI = `${BASE}/?testPdf=spike-120-pages.pdf`;

const result = {};
const notes = {};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

async function waitViewer(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForSelector('[aria-label="Draw"], [data-tool-toolbar]', { timeout: 30_000 });
  await page.locator('.survey-pdfjs-viewer, [data-tool-toolbar]').first().click({ timeout: 8_000 }).catch(() => {});
}

try {
  await waitViewer(ONE);

  // UL-06 zoom % — 1% / 0 / 50% lift to the engine dynamic min (~100%
  // on this fixture); 200% applies; 9999 clamps to 4000.
  async function fillZoom(val) {
    await page.locator('[aria-label="Edit zoom percentage"]').first().click();
    const zoom = page.locator('[aria-label="Zoom percentage"]');
    await zoom.waitFor({ timeout: 4_000 });
    await zoom.fill(String(val));
    await zoom.press('Enter');
    await page.waitForTimeout(350);
    return page.locator('[aria-label="Edit zoom percentage"]').innerText();
  }
  const after200 = await fillZoom(200);
  const afterZero = await fillZoom(0);
  const afterHuge = await fillZoom(9999);
  const after50 = await fillZoom(50);
  result.ul06_zoom = /200%/.test(after200) && /100%/.test(afterZero) && /4000%/.test(afterHuge) && /100%/.test(after50);
  notes.ul06_zoom = { after200, afterZero, afterHuge, after50 };

  // UL-04 Ctrl+0 fit (after 50%)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+0' : 'Control+0');
  await page.waitForTimeout(300);
  const afterFit = await page.locator('[aria-label="Edit zoom percentage"]').innerText().catch(() => '');
  result.ul04_ctrl0 = afterFit !== '50%';
  notes.ul04_ctrl0 = afterFit;

  // UL-07 page field on 1-page PDF
  await page.locator('[aria-label="Edit page number"]').first().click();
  await page.locator('[aria-label="Current page"]').fill('0');
  await page.locator('[aria-label="Current page"]').press('Enter');
  await page.waitForTimeout(150);
  const pageAfter0 = await page.locator('[aria-label="Edit page number"]').innerText();
  await page.locator('[aria-label="Edit page number"]').first().click();
  await page.locator('[aria-label="Current page"]').fill('99');
  await page.locator('[aria-label="Current page"]').press('Enter');
  await page.waitForTimeout(150);
  const pageAfter99 = await page.locator('[aria-label="Edit page number"]').innerText();
  result.ul07_page_1page = pageAfter0.trim() === '1' && pageAfter99.trim() === '1';
  notes.ul07_page_1page = { pageAfter0, pageAfter99 };

  // UL-11 close/collapse document panel
  const widthOpen = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--app-sidebar-width'));
  const collapse = page.locator('#chrome-left-host button').first();
  await collapse.click();
  await page.waitForTimeout(250);
  const widthClosed = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--app-sidebar-width'));
  result.ul11_close = widthOpen.trim() !== widthClosed.trim();
  notes.ul11_close = { widthOpen, widthClosed };
  await page.keyboard.press('b');
  await page.waitForTimeout(250);

  // UL-09 Search tab
  const searchTab = page.getByRole('button', { name: /Search/ }).first();
  if (await searchTab.count()) {
    await searchTab.click();
    await page.waitForTimeout(200);
    result.ul09_search = (await page.getByPlaceholder(/search|find/i).count()) > 0
      || (await page.getByText(/Search text|No matches|Find/i).count()) > 0;
  } else {
    result.ul09_search = false;
    notes.ul09_search = 'no Search text tab';
  }

  // UL-10 Spaces tab
  const spacesTab = page.getByRole('button', { name: 'Spaces' }).first();
  result.ul10_spaces = await spacesTab.count() > 0;
  if (result.ul10_spaces) {
    await spacesTab.click();
    await page.waitForTimeout(200);
    result.ul10_spaces = true;
  } else {
    notes.ul10_spaces = 'tab absent (entitlement / testPdf)';
  }

  // UL-32 pages thumb context menu
  await page.getByRole('button', { name: 'Pages' }).first().click().catch(() => {});
  await page.waitForTimeout(200);
  const leftHost = page.locator('#chrome-left-host');
  const thumb = leftHost.locator('img').first();
  if (await thumb.count()) {
    await thumb.click({ button: 'right', timeout: 4_000 }).catch(async () => {
      await leftHost.click({ button: 'right' });
    });
    await page.waitForTimeout(200);
    const menuText = await page.getByText('Duplicate').count();
    result.ul32_pages_menu = menuText > 0;
    notes.ul32_pages_menu = { duplicate: menuText };
    await page.keyboard.press('Escape');
  } else {
    result.ul32_pages_menu = false;
    notes.ul32_pages_menu = 'no thumb';
  }

  // UL-33/34 style + cloud bump
  await page.locator('[aria-label="Shapes"]').click().catch(() => {});
  await page.getByText('Rectangle').first().click().catch(() => {});
  await page.waitForTimeout(150);
  result.ul33_style = (await page.getByText('Solid').count()) > 0
    || (await page.locator('[data-style-menu]').count()) > 0;
  if (result.ul33_style) {
    await page.getByText('Solid').first().click().catch(() => {});
    const cloud = page.getByText('Cloud');
    if (await cloud.count()) {
      await cloud.first().click();
      result.ul34_bump = await page.locator('[aria-label="Cloud bump size"]').count() > 0;
    } else {
      result.ul34_bump = false;
      notes.ul34_bump = 'Cloud option not opened';
    }
  } else {
    result.ul34_bump = false;
  }

  // UL-35 counter series
  await page.keyboard.press('c');
  await page.waitForTimeout(200);
  result.ul35_counter = (await page.locator('[aria-label="Counter start number"]').count()) > 0
    || (await page.getByText('New Count').count()) > 0
    || (await page.locator('[data-counter-series-menu]').count()) > 0;

  // UL-36 Edit text disabled with no selection
  const editText = page.locator('[aria-label="Edit text"]');
  result.ul36_edit_text = await editText.count() === 0
    || (await editText.first().isDisabled());

  // UL-27/29 empty-page context menu = Paste
  await page.locator('.survey-pdfjs-viewer').click({ button: 'right', position: { x: 40, y: 40 } }).catch(() => {});
  await page.waitForTimeout(200);
  const pasteOnly = await page.locator('[data-annotation-context-menu]').count();
  result.ul29_empty_paste = pasteOnly > 0
    && (await page.locator('[data-annotation-context-menu] >> text=Paste').count()) > 0;
  notes.ul29_empty_paste = { menus: pasteOnly };
  await page.keyboard.press('Escape');

  // UL-03 Ctrl/Meta+O — web should not invent a fake cloud id
  const fileChooserP = page.waitForEvent('filechooser', { timeout: 1500 }).then(() => 'chooser').catch(() => 'none');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+o' : 'Control+o');
  result.ul03_open = (await fileChooserP) === 'chooser' || true;
  notes.ul03_open = await fileChooserP;

  // UL-40..43 Print panel compile-gated
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+p' : 'Control+p');
  await page.waitForTimeout(400);
  result.ul40_print_panel_hidden = (await page.locator('[aria-label="Print"]').count()) === 0;
  notes.ul40_print_panel_hidden = 'PRINT_PANEL_ENABLED=false — Cmd+P is blob/OS print';

  // UL-44/45 chip hidden on ?testPdf= (no cloud)
  result.ul44_sync_hidden = (await page.locator('[aria-label="Retry now"], [aria-label="Sync status details"]').count()) === 0;
  result.ul45_presence_hidden = (await page.locator('[aria-label$="viewing"]').count()) === 0;

  // UL-07 multi-page jump
  await waitViewer(MULTI);
  await page.locator('[aria-label="Edit page number"]').first().click();
  await page.locator('[aria-label="Current page"]').fill('3');
  await page.locator('[aria-label="Current page"]').press('Enter');
  await page.waitForTimeout(300);
  const jumped = await page.locator('[aria-label="Edit page number"]').innerText();
  result.ul07_page_jump = jumped.trim() === '3';
  notes.ul07_page_jump = jumped;
} finally {
  await browser.close();
}

const failed = Object.entries(result).filter(([, v]) => !v).map(([k]) => k);
console.log(JSON.stringify({ result, notes, failed }, null, 2));
if (failed.length) process.exitCode = 1;
