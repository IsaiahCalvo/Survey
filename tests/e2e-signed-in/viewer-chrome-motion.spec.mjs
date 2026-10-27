// Smooth chrome (owner note 2026-10-26, item 38): "Top bars need to come down
// smoothly ... Switching between tabs needs to be smooth as well."
//  - At the top of a document, the Survey bar coming down makes room for the
//    page (it used to cover the page's top) and the page glides down with it:
//    no frame moves it more than a few px. Leaving Survey glides it back.
//  - Going Home and back to the document shows it exactly as it was left: the
//    Survey panel does not slide in again and the page does not move.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

const FIXTURE = 'debug/fixtures/package2-rev4.pdf';

async function seed(admin) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const docId = randomUUID();
  const templateId = randomUUID();
  const stamp = Date.now();
  const templateName = `E2E Motion ${stamp}`;
  const docName = `E2E Motion ${stamp}.pdf`;
  const bytes = fs.readFileSync(path.resolve(FIXTURE));
  const filePath = `${ownerId}/${docId}.pdf`;
  const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), {
    contentType: 'application/pdf', upsert: true,
  });
  if (up.error) throw up.error;
  const template = await admin.from('templates').insert({
    id: templateId, user_id: ownerId, name: templateName, description: 'viewer-chrome-motion.spec',
    config: {
      modules: [{ id: 'm-sec', name: 'Security', categories: [{ id: 'c-cam', name: 'Camera', checklist: [] }] }],
      entities: [{ id: 'e-gc', name: 'GC', color: '#E53935' }],
    },
  });
  if (template.error) throw template.error;
  const doc = await admin.from('documents').insert({
    id: docId, user_id: ownerId, project_id: E2E_PROJECT.id, name: docName,
    file_path: filePath, file_size: bytes.length, page_count: 36,
  });
  if (doc.error) throw doc.error;
  const link = await admin.from('document_templates').insert({ document_id: docId, template_id: templateId, linked_by: ownerId });
  if (link.error) throw link.error;
  return { docId, docName, filePath, templateId, templateName };
}

async function cleanup(admin, seeded) {
  await admin.from('documents').delete().eq('id', seeded.docId);
  await admin.storage.from('documents').remove([seeded.filePath]);
  await admin.from('templates').delete().eq('id', seeded.templateId);
}

// Every frame for `ms`: the first page's top, the Survey bar's bottom and the
// Survey panel's left edge (null while not drawn, or in a tab behind, which
// keeps its layout: docs/TAB-SWITCHING.md S9).
function startRecording(page, ms) {
  return page.evaluate((duration) => new Promise((resolve) => {
    const out = [];
    const t0 = performance.now();
    const rectOf = (sel) => {
      const n = [...document.querySelectorAll(sel)].find((el) => !el.closest('[data-tab-behind]'));
      const r = n?.getBoundingClientRect();
      return r && r.width > 0 && r.height > 0 ? r : null;
    };
    const tick = () => {
      const pg = rectOf('.survey-pdfjs-page-div[data-page-number="1"]');
      out.push({
        t: performance.now() - t0,
        page: pg ? pg.top : null,
        bar: rectOf('[data-viewer-top-push="true"]')?.bottom ?? null,
        panel: rectOf('#survey-rail-panel')?.left ?? null,
      });
      if (performance.now() - t0 < duration) requestAnimationFrame(tick);
      else resolve(out);
    };
    requestAnimationFrame(tick);
  }), ms);
}

// The biggest move between two frames, per 60 Hz frame: a dev build on a
// busy runner drops frames, and a glide that skipped two frames is still a
// glide; a jump is a bar's height in one frame.
const steps = (frames, key) => {
  let worst = 0;
  for (let i = 1; i < frames.length; i += 1) {
    const a = frames[i - 1][key];
    const b = frames[i][key];
    const frameCount = Math.max(1, (frames[i].t - frames[i - 1].t) / (1000 / 60));
    if (a !== null && b !== null) worst = Math.max(worst, Math.abs(b - a) / frameCount);
  }
  return worst;
};

test('the Survey bar makes room as it comes down, and a tab switch leaves the document as it was', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const seeded = await seed(admin);
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(seeded.docName, { exact: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] canvas').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(800);
    await page.evaluate(() => { document.querySelector('[data-touch-pdf-surface]').scrollTop = 0; });
    await page.waitForTimeout(500);
    const before = await page.evaluate(() => document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]').getBoundingClientRect().top);

    // Into Survey at the top of the document.
    let recording = startRecording(page, 1500);
    await page.getByRole('button', { name: 'Survey', exact: true }).first().click();
    await page.getByText(seeded.templateName, { exact: true }).first().click().catch(() => {});
    let frames = await recording;
    const landed = frames.at(-1);
    console.log('[motion] enter', JSON.stringify({ before, landed, pageStep: steps(frames, 'page') }));
    expect(landed.bar, 'the Survey bar is up').not.toBeNull();
    expect(landed.page, 'the page sits below the Survey bar, not under it').toBeGreaterThanOrEqual(landed.bar);
    // The glide is time-based, so a stalled main thread right after the bar
    // lands shows as one bigger frame (CI saw 13.8 px once; locally 5-6 px).
    // A step is the bar's whole 35 px in one frame, which this still catches.
    expect(steps(frames, 'page'), 'the page glides down, never steps').toBeLessThan(20);

    // Home and back: nothing slides in again and nothing moves.
    const tabs = page.locator('.tab-bar');
    await tabs.getByText('Home', { exact: true }).click();
    await expect(page.locator('[data-touch-pdf-surface]')).toBeHidden();
    await page.waitForTimeout(500);
    recording = startRecording(page, 900);
    await tabs.getByText(seeded.docName, { exact: true }).click();
    frames = (await recording).filter((f) => f.page !== null);
    console.log('[motion] back', JSON.stringify({ first: frames[0], last: frames.at(-1), panelStep: steps(frames, 'panel') }));
    expect(frames.length).toBeGreaterThan(5);
    expect(Math.abs(frames.at(-1).page - landed.page), 'the page is where it was left').toBeLessThan(1);
    expect(steps(frames, 'page'), 'the page does not move').toBeLessThan(1);
    expect(steps(frames, 'bar'), 'the Survey bar does not drop in again').toBeLessThan(1);
    expect(steps(frames, 'panel'), 'the Survey panel does not slide in again').toBeLessThan(1);
  } finally {
    await cleanup(admin, seeded);
  }
});
