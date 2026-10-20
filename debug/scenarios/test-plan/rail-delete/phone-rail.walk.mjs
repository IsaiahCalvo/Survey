// Phone check for the Survey rail (390x844): open the survey, list the
// categories, take shots. The category Select/Delete row is desktop-only by
// design, so this only proves the phone rail still opens and lists categories.
//   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5631 node debug/scenarios/test-plan/rail-delete/phone-rail.walk.mjs [out-dir]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { FakeBackend } from '../tp-fake-backend.mjs';
import { PHONE } from '../tp-local-doc.mjs';
import { openWindow } from '../tp-actions.mjs';
import { TEMPLATES } from '../lib.mjs';

const OUT = process.argv[2] || new URL('../../../../artifacts/rail-delete/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const DOC = '7e57d0c0-0000-4000-8000-000000000552';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const backend = new FakeBackend({ documentId: DOC });
const W = await openWindow(browser, backend, DOC, 'Package 2 - Rev 4 -- IC.pdf', { device: PHONE, phone: true, templates: TEMPLATES });
const { page } = W;
// The live branch's tab-strip dialog host can push the phone viewer down
// (fixed separately); hide it so the walk sees the viewer.
await page.addStyleTag({ content: '[data-tab-strip-dialogs]{display:none!important}' });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/phone-1-open.png` });
const open = page.getByRole('button', { name: /survey/i }).filter({ visible: true }).first();
await open.click().catch((e) => console.log('no survey button', e.message));
await page.waitForTimeout(1500);
const tpl = page.getByRole('button', { name: /Test Plan Template/ }).filter({ visible: true }).first();
if (await tpl.count()) { await tpl.click(); await page.waitForTimeout(1500); }
await page.screenshot({ path: `${OUT}/phone-2-survey.png` });
const text = await page.evaluate(() => document.body.innerText.slice(0, 2000));
console.log(JSON.stringify({ hasCameras: text.includes('Cameras'), hasDoors: text.includes('Doors'), errors: W.errors.slice(0, 5), scrollW: await page.evaluate(() => document.documentElement.scrollWidth) }));
await browser.close();
