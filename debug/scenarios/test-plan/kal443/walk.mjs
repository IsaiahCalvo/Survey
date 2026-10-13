// KAL-443 walk: copy a document between projects on the real hub (Dashboard)
// with every Supabase call answered in memory (no account, no network).
// Run with a dev server up: `npx vite --port 5611`, then
//   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5611 node debug/scenarios/test-plan/kal443/walk.mjs [phone]
// Prints the documents table after each step; screenshots go to artifacts/KAL-443/.
// KAL-443 end-to-end walk on the real hub (Dashboard) + in-memory backend.
import { open, OUT, docRows, visibleControls, USER, PDF_SHA, PA, PB } from './walk-lib.mjs';
const phone = process.argv[2] === 'phone';
const t0 = Date.now(); process.on('exit', () => console.error(`walk took ${Math.round((Date.now() - t0) / 1000)}s`));
const tag = (process.env.TAG ? process.env.TAG + '-' : '') + (phone ? 'phone' : 'desk');
const w = await open(phone ? { viewport: { width: 390, height: 844 }, phone: true } : {});
const { page, backend, objects } = w;
page.on('crash', () => console.log('PAGE CRASHED'));
page.on('close', () => console.log('PAGE CLOSED'));
const shot = (n) => page.screenshot({ path: `${OUT}/${tag}-${n}.png` });
const toastText = async () => page.evaluate(() => window.__toasts.splice(0).join(' | '));
const out = {};
const goHome = async () => {
  const back = page.getByRole('button', { name: phone ? 'Back to documents' : /^Close / });
  if (await back.count()) { await back.first().click(); await page.waitForTimeout(2500); }
};
await goHome();
await shot('0-home');
out.controls0 = await visibleControls(page);

async function selectRow(name) {
  const sel = page.getByRole('button', { name: 'Select', exact: true }).filter({ visible: true });
  if (await sel.count()) await sel.first().click();
  await page.waitForTimeout(400);
  await page.locator('[data-document-id]').filter({ visible: true }).filter({ hasText: name }).filter({ hasText: 'Tower A' }).first().click();
  await page.waitForTimeout(400);
}
async function copyTo(name, project, step) {
  await selectRow(name);
  await page.getByRole('button', { name: 'Copy', exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(500);
  const dialog = page.getByRole('dialog', { name: 'Move or copy documents' });
  await dialog.getByRole('button', { name: project, exact: true }).click();
  await shot(`${step}-dialog`);
  await dialog.getByRole('button', { name: 'Copy here' }).click();
  await page.waitForTimeout(2500);
  out[`${step}-toast`] = await toastText();
  await shot(`${step}-after`);
  const done = page.getByRole('button', { name: 'Done', exact: true });
  if (await done.count()) await done.first().click().catch(() => {});
}

// 1. Copy Riser.pdf from Tower A into Tower B.
await copyTo('Riser.pdf', 'Tower B', '1-copy');
out.after1 = docRows(backend);
out.objects1 = [...objects.keys()];
// 2. Copy it into Tower B again: the duplicate check catches it.
await copyTo('Riser.pdf', 'Tower B', '2-copy-again');
out.after2 = docRows(backend);
// 3. Duplicate in Tower A: a second document is still made.
await selectRow('Riser.pdf');
await page.getByRole('button', { name: 'Duplicate', exact: true }).first().click();
await page.waitForTimeout(2500);
out['3-toast'] = await toastText();
await shot('3-duplicate');
out.after3 = docRows(backend);
// 3b. Copy dialog into the project it already lives in: also a second document.
await copyTo('Riser.pdf', 'Tower A', '3b-copy-same-project');
out.after3b = docRows(backend);
out.objectsAfterCopies = [...objects.keys()].map((k) => k.slice(-16));
out.storageAfterCopies = w.storageLog.filter((l) => !l.startsWith('GET'));
console.log(JSON.stringify(out, null, 1));
// `short` (argv[3]) stops here so one run stays under two minutes.
if (process.argv[3] === 'short') {
  // Open the Tower B copy: it reads its own stored object.
  const bCopyRow = page.locator('[data-document-id]').filter({ visible: true }).filter({ hasText: 'Riser (Copy).pdf' }).filter({ hasText: 'Tower B' }).first();
  await bCopyRow.click();
  await page.waitForTimeout(9000);
  await shot('short-open-copy');
  console.log('opened', await page.locator('.survey-pdfjs-page-div').count(), 'pages rendered');
  await w.browser.close(); process.exit(0);
}
// 4. Refresh: the list still shows all three documents.
await page.reload();
await page.waitForTimeout(8000);
await goHome();
await shot('4-after-refresh');
out.listAfterRefresh = await page.evaluate(() => [...document.querySelectorAll('[data-document-id]')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.textContent.trim().slice(0, 60)));
// 5. Preview of each copy renders (wait for the queue under load).
for (const label of ['Tower A', 'Tower B']) {
  const row = page.locator('[data-document-id]').filter({ visible: true }).filter({ hasText: 'Riser (Copy).pdf' }).filter({ hasText: label }).first();
  if (await row.count()) { await row.click(); await page.waitForTimeout(9000); await shot(`5-preview-copy-${label.replace(' ', '')}`); await goHome(); }
}
// 6. Archive the Tower B copy, then copy Riser.pdf into Tower B again.
// (The fake backend has no archive RPC, so put the Tower B copy in Archive directly.)
const bCopy = backend.table('documents').find((r) => r.project_id === PB);
bCopy.user_archived_at = '2026-10-13T00:00:00.000Z';
await page.reload(); await page.waitForTimeout(8000);
await goHome();
out.afterArchive = docRows(backend).map((r, i) => ({ ...r, archivedAt: backend.table('documents')[i].user_archived_at || null }));
await copyTo('Riser.pdf', 'Tower B', '6-copy-after-archive');
out.after6 = docRows(backend).map((r, i) => ({ ...r, archivedAt: backend.table('documents')[i].user_archived_at || null }));
out.objectsEnd = [...objects.keys()];
out.errors = w.errors.filter((e) => !/ERR_FAILED|net::/.test(e)).slice(0, 10);
out.storage = w.storageLog.filter((l) => !l.startsWith('GET')).slice(0, 30);
console.log(JSON.stringify(out, null, 1));
await w.browser.close();
