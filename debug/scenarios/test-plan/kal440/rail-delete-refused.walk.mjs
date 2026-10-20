// KAL-440 walk: delete a whole category (and its Survey Marker) from the
// Survey rail while the database refuses the DELETE the way row-level security
// does (200, zero rows, no error), then again with the delete allowed.
// Everything is answered in memory (no account, no network).
// Run with a dev server up (`npx vite --port 5612`):
//   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5612 node debug/scenarios/test-plan/kal440/rail-delete-refused.walk.mjs [refused|allowed]
// Prints what the person was told and what the server still holds; shots go
// to artifacts/KAL-440/.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { FakeBackend } from '../tp-fake-backend.mjs';
import { DESKTOP } from '../tp-local-doc.mjs';
import { openWindow, waitFor } from '../tp-actions.mjs';
import { TEMPLATES, at, drag, enterSurvey, surveyMarkers } from '../lib.mjs';

const OUT = new URL('../../../../artifacts/KAL-440/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PDF = 'Package 2 - Rev 4 -- IC.pdf';

async function run(refuse, docId) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const backend = new FakeBackend({ documentId: docId });
  const W = await openWindow(browser, backend, docId, PDF, { device: DESKTOP, templates: TEMPLATES });
  const { page, context } = W;
  const deletes = [];
  await context.route(/\.supabase\.co\/rest\/v1\/document_annotations/, (route) => {
    if (route.request().method() === 'DELETE') deletes.push(route.request().url());
    if (refuse && route.request().method() === 'DELETE') {
      return route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
        body: '[]',
      });
    }
    return route.fallback();
  });
  await page.evaluate(() => {
    window.__toasts = [];
    window.addEventListener('app-toast', (e) => window.__toasts.push(`${e.detail.type}: ${e.detail.message}`));
  });
  const shot = (n) => console.log('[shot]', n) || page.screenshot({ path: `${OUT}/rail-${refuse ? 'refused' : 'allowed'}-${n}.png` });
  await enterSurvey(page);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.locator('.survey-subrow__cats button[aria-label="Cameras"]').filter({ visible: true }).first().click();
  await page.waitForTimeout(350);
  const [ax, ay] = await at(page, 200, 640);
  const [bx, by] = await at(page, 240, 680);
  await drag(page, ax, ay, bx, by);
  await page.waitForTimeout(700);
  await page.evaluate(() => document.activeElement?.blur?.());
  const marker = await waitFor(async () => (await surveyMarkers(page))[0], { timeout: 15_000 });
  const rowsFor = () => backend.table('document_annotations').filter((r) => r.annotation_id === marker?.id);
  const stored = await waitFor(() => (rowsFor().length ? rowsFor() : null), { timeout: 20_000 });
  await page.waitForTimeout(3000);
  await shot('1-placed');
  // Rail: Select, Select all, Delete, confirm.
  const actions = page.locator('.survey-rail__cats-actions').filter({ visible: true }).first();
  await actions.getByRole('button', { name: 'Select', exact: true }).click();
  await page.waitForTimeout(300);
  if (process.argv[3] === 'all') await actions.getByRole('button', { name: 'Select all' }).click();
  else {
    // Tick only the Cameras row in the rail (the right-hand panel).
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
  await shot('3-confirm');
  await page.getByRole('button', { name: /^Delete categor/ }).filter({ visible: true }).first().click();
  await page.waitForTimeout(900);
  await shot('3b-told');
  const gone = await waitFor(async () => ((await surveyMarkers(page)).some((m) => m.id === marker.id) ? null : true), { timeout: 8000 });
  await page.waitForTimeout(2500);
  await shot('4-after-delete');
  const out = {
    refuse,
    markerPlaced: Boolean(marker),
    rowStoredBeforeDelete: Boolean(stored),
    goneFromScreen: Boolean(gone),
    deleteRequests: deletes.length,
    markersOnScreenAfter: (await surveyMarkers(page)).map((m) => m.id),
    serverRowsAfter: rowsFor().map((r) => r.annotation_id),
    toasts: await page.evaluate(() => window.__toasts),
    errors: W.errors.slice(0, 5),
  };
  await browser.close();
  return out;
}

const which = process.argv[2] || 'both';
if (which !== 'allowed') console.log(JSON.stringify(await run(true, '7e57d0c0-0000-4000-8000-000000000442'), null, 1));
if (which !== 'refused') console.log(JSON.stringify(await run(false, '7e57d0c0-0000-4000-8000-000000000443'), null, 1));
