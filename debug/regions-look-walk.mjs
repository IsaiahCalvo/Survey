// Screenshots of the Spaces rail, the region edit toolbar and the Move region
// menu, then draws a polygon, deletes it, and checks the polygon keys.
// Usage: node debug/regions-look-walk.mjs <outDir> [baseURL]  (PW_CHROMIUM=<path> to pick a browser)
import { chromium } from '@playwright/test';
const out = process.argv[2] || '/tmp/regions-shots';
const base = process.argv[3] || 'http://127.0.0.1:5173';
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
const button = (name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
await page.goto(`${base}/?testPdf=order-pages.pdf`);
await page.waitForFunction(() => window.__fix19SurveyRegionHarness && window.__pdfjsViewerPerf, null, { timeout: 120000 });
await page.evaluate(() => window.__fix19SurveyRegionHarness.setup());
await button('Spaces').click();
await button('Open Fix19 Space A').click();
await page.waitForTimeout(500);
const rail = page.locator('.spaces-panel').first();
await rail.screenshot({ path: `${out}/1-rail.png` });
await button('Edit Spaces').click();
await page.waitForTimeout(400);
await rail.screenshot({ path: `${out}/2-rail-edit.png` });
await button('Edit the regions on page 1').click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/3-region-edit.png` });
await button('Cancel').click();
await page.waitForTimeout(300);
await button('Move or copy region on page 1').click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/4-move-dialog.png`, clip: { x: 0, y: 80, width: 700, height: 420 } });
// Polygon: four corners, the rubber band, then close on the first corner.
await page.keyboard.press('Escape');
await button('Edit the regions on page 1').click();
await page.waitForTimeout(500);
await page.locator('[data-area-tool="polygon"]').click();
const box = await page.locator('[data-region-edit-layer]').first().boundingBox();
const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
const doneX = async (tag) => console.log('Done x', tag, await page.locator('[data-area-actions]').evaluate((el) => [...el.children].map((c) => c.textContent.slice(0, 12) + ':' + Math.round(c.getBoundingClientRect().x) + '/' + Math.round(c.getBoundingClientRect().width)).join(' ')));
await doneX('polygon armed');
const corners = [[0.55, 0.45], [0.85, 0.5], [0.8, 0.8], [0.5, 0.75]];
for (const [fx, fy] of corners) { await page.mouse.click(...at(fx, fy)); await page.waitForTimeout(120); }
await doneX('4 corners');
await page.mouse.move(...at(0.555, 0.455));
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/5-polygon-drawing.png` });
await page.mouse.click(...at(0.555, 0.455));
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/6-polygon-closed.png` });
const count = () => page.evaluate(() => document.querySelectorAll('[data-region-edit-layer] path').length);
console.log('paths after close', await count());
// Pick it with Select and press Delete.
await page.keyboard.press('v');
await page.mouse.click(...at(0.7, 0.62));
await page.waitForTimeout(250);
await page.screenshot({ path: `${out}/7-picked.png` });
await doneX('picked');
const deleteEnabled = await page.getByRole('button', { name: 'Delete area' }).isEnabled();
await page.keyboard.press('Delete');
await page.waitForTimeout(300);
console.log('delete enabled before key', deleteEnabled, 'after key enabled', await page.getByRole('button', { name: 'Delete area' }).isEnabled());
await page.screenshot({ path: `${out}/8-deleted.png` });
// Keys: Backspace takes a corner back, Escape drops, Enter closes.
await page.locator('[data-area-tool="polygon"]').click();
const preview = () => page.locator('[data-region-polygon-preview] circle').count();
await page.mouse.click(...at(0.2, 0.8)); await page.mouse.click(...at(0.4, 0.8));
console.log('corners', await preview());
await page.keyboard.press('Backspace'); console.log('after backspace', await preview());
await page.keyboard.press('Escape'); console.log('after escape', await preview());
for (const [fx, fy] of [[0.15, 0.85], [0.35, 0.85], [0.3, 0.95]]) await page.mouse.click(...at(fx, fy));
await page.keyboard.press('Enter'); await page.waitForTimeout(200);
console.log('after enter', await preview(), 'session still open', await page.locator('[data-area-actions]').count());
await page.screenshot({ path: `${out}/9-enter-closed.png` });
// Lasso tooltip order
console.log('tools', await page.locator('[data-area-tool]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))));
await browser.close();
