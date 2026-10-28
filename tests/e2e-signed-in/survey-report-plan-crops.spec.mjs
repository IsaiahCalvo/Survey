// Nightly 'survey-report': the PDF report puts a crop of the plan beside each
// item with an issue ("Where the issues are"), cut from the stored plan, with
// the item's box and a pin on it.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

const FIXTURE = 'debug/fixtures/clickable-link-test.pdf';

test('the PDF report shows where each issue is on the plan', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const docId = randomUUID();
  const templateId = randomUUID();
  const stamp = Date.now();
  const templateName = `E2E Crops ${stamp}`;
  const docName = `E2E Crops ${stamp}.pdf`;
  const bytes = fs.readFileSync(path.resolve(FIXTURE));
  const filePath = `${ownerId}/${docId}.pdf`;
  const must = (r) => { if (r.error) throw r.error; return r.data; };
  must(await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true }));
  must(await admin.from('templates').insert({
    id: templateId, user_id: ownerId, name: templateName, description: 'survey-report-plan-crops.spec',
    config: { modules: [{ id: 'm', name: 'Doors', categories: [{ id: 'c', name: 'Door', checklist: [{ id: 'lock', text: 'Lock works' }] }] }], entities: [] },
  }));
  must(await admin.from('documents').insert({ id: docId, user_id: ownerId, project_id: E2E_PROJECT.id, name: docName, file_path: filePath, file_size: bytes.length, page_count: 1 }));
  must(await admin.from('document_templates').insert({ document_id: docId, template_id: templateId, linked_by: ownerId }));
  try {
    await page.addInitScript(() => localStorage.setItem('survey.flag.survey-report', '1'));
    await signIn(page, E2E_ACCOUNTS.owner);
    // One item that failed its line, over the sheet's title; one that passed.
    await page.evaluate(async ({ id }) => {
      const sync = await import('/src/services/annotationDocSync.js');
      const { supabase } = await import('/src/supabaseClient.js');
      const { data: who } = await supabase.auth.getUser();
      const handle = await sync.openAnnotationDoc({ documentId: id, supabase, actorUserId: who.user.id, enableLocal: false, enableRealtime: false });
      const base = { moduleId: 'm', regionId: null, categoryId: 'c', color: null, pageNumber: 1 };
      handle.applySurveyMarkers({
        'crop-bad': { ...base, id: 'crop-bad', name: 'Door 7', bounds: { x: 70, y: 60, width: 200, height: 40 }, checklistResponses: { lock: { selection: 'N' } } },
        'crop-good': { ...base, id: 'crop-good', name: 'Door 8', bounds: { x: 70, y: 300, width: 40, height: 40 }, checklistResponses: { lock: { selection: 'Y' } } },
      });
      await handle.drain();
      handle.destroy();
    }, { id: docId });

    await page.getByText(docName, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] canvas').first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Survey', exact: true }).click();
    await page.getByText(templateName, { exact: true }).filter({ visible: true }).first().click();
    await expect(page.getByRole('button', { name: 'Show Survey Markers in Door' })).toBeVisible({ timeout: 30_000 });

    const download = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByRole('button', { name: 'Report', exact: true }).click();
    await page.getByRole('menu', { name: 'Report format' }).getByRole('menuitem', { name: 'PDF (.pdf)' }).click();
    const file = await download;
    const out = new Uint8Array(fs.readFileSync(await file.path()));
    fs.writeFileSync(test.info().outputPath('report.pdf'), out);
    const pdf = await pdfjs.getDocument({ data: out }).promise;
    const last = await pdf.getPage(pdf.numPages);
    const words = (await last.getTextContent()).items.map((it) => it.str).join(' ');
    expect(words).toContain('Where the issues are');
    expect(words).toContain('Door 7');
    expect(words).toContain('Door · Page 1');
    // The crop is the plan itself: its title text is in the page.
    expect(words).toContain('Interactive PDF test');
    expect(words).not.toContain('Door 8');
  } finally {
    await admin.from('documents').delete().eq('id', docId);
    await admin.storage.from('documents').remove([filePath]);
    await admin.from('templates').delete().eq('id', templateId);
  }
});
