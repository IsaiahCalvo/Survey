// Survey rail walk: place a Camera and a Door Survey Marker, then in the rail
// click Select, tick both categories (Select all), click Delete and confirm.
// Checks that BOTH categories go away and that no deleted marker stays drawn
// on the page. Everything is answered in memory (no account, no network).
// Run with a dev server up (`npx vite --port 5631`):
//   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5631 node debug/scenarios/test-plan/rail-delete/category-delete.walk.mjs [all|cameras] [out-dir]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { FakeBackend } from '../tp-fake-backend.mjs';
import { DESKTOP } from '../tp-local-doc.mjs';
import { openWindow, waitFor } from '../tp-actions.mjs';
import { TEMPLATES, at, drag, enterSurvey, surveyMarkers } from '../lib.mjs';

const which = process.argv[2] || 'all';
const OUT = process.argv[3] || new URL('../../../../artifacts/rail-delete/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PDF = 'Package 2 - Rev 4 -- IC.pdf';
const DOC = '7e57d0c0-0000-4000-8000-000000000551';

const railCategoryNames = (page) => page.evaluate(() => [...document.querySelectorAll('.survey-subrow__cats button[aria-label]')]
  .filter((b) => b.getBoundingClientRect().width > 0).map((b) => b.getAttribute('aria-label')));

async function place(page, category, x0, y0) {
  await page.locator(`.survey-subrow__cats button[aria-label="${category}"]`).filter({ visible: true }).first().click();
  await page.waitForTimeout(350);
  const [ax, ay] = await at(page, x0, y0);
  const [bx, by] = await at(page, x0 + 40, y0 + 40);
  await drag(page, ax, ay, bx, by);
  await page.waitForTimeout(700);
  await page.evaluate(() => document.activeElement?.blur?.());
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const backend = new FakeBackend({ documentId: DOC });
const W = await openWindow(browser, backend, DOC, PDF, { device: DESKTOP, templates: TEMPLATES });
const { page } = W;
const shot = (n) => page.screenshot({ path: `${OUT}/${which}-${n}.png` });
await enterSurvey(page);
await page.evaluate(() => document.activeElement?.blur?.());
await place(page, 'Cameras', 200, 640);
await place(page, 'Doors', 320, 640);
const placed = await waitFor(async () => {
  const m = await surveyMarkers(page);
  return m.length >= 2 ? m : null;
}, { timeout: 15_000 });
await waitFor(() => (backend.table('document_annotations').length >= 2 ? true : null), { timeout: 20_000 });
await page.waitForTimeout(2500);
const before = { categories: await railCategoryNames(page), markers: placed.map((m) => m.id) };
await shot('1-placed');
const actions = page.locator('.survey-rail__cats-actions').filter({ visible: true }).first();
await actions.getByRole('button', { name: 'Select', exact: true }).click();
await page.waitForTimeout(300);
if (which === 'all') await actions.getByRole('button', { name: 'Select all' }).click();
else {
  const [cx, cy] = await page.evaluate(() => {
    const el = [...document.querySelectorAll('span, div')].find((e) => e.textContent.trim() === 'Cameras'
      && e.children.length === 0 && e.getBoundingClientRect().x > 1000);
    const r = el.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  });
  await page.mouse.click(cx, cy);
}
await page.waitForTimeout(300);
await shot('2-selected');
await actions.getByRole('button', { name: 'Delete', exact: true }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: /^Delete categor/ }).filter({ visible: true }).first().click();
await page.waitForTimeout(600);
const soon = (await surveyMarkers(page)).map((m) => m.id);
await page.waitForTimeout(2500);
await shot('3-after-delete');
const after = {
  categories: await railCategoryNames(page),
  markersOnPageAt600ms: soon,
  markersOnPageAt3s: (await surveyMarkers(page)).map((m) => m.id),
  serverRows: backend.table('document_annotations').map((r) => r.annotation_id),
};
await page.reload();
await page.waitForTimeout(6000);
await backend?.settle?.();
await enterSurvey(page).catch(() => {});
await page.waitForTimeout(1500);
await shot('4-after-reload');
const afterReload = { markersOnPage: (await surveyMarkers(page)).map((m) => m.id) };
console.log(JSON.stringify({ which, before, after, afterReload, errors: W.errors.slice(0, 5) }, null, 1));
await browser.close();
