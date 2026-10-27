// Locate on page (owner note 2026-10-26, item 28): "it doesn't automatically
// go to it every single time and center on it ... It should zoom properly to
// the extents of it as well, and it should do that on the first click."
// A 36-sheet drawing with Survey Markers on far-apart sheets: every first click
// on Locate lands the marker centred in the part of the viewer you can see
// (between the open panels) and zoomed so it fills a fair share of it.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

const FIXTURE = 'debug/fixtures/package2-rev4.pdf';

const MARKERS = [
  { id: 'm-p1-small', pageNumber: 1, name: 'Camera 1', bounds: { x: 420, y: 600, width: 24, height: 24 } },
  { id: 'm-p14-wide', pageNumber: 14, name: 'Camera 2', bounds: { x: 420, y: 150, width: 220, height: 70 } },
  { id: 'm-p30-mid', pageNumber: 30, name: 'Camera 3', bounds: { x: 600, y: 380, width: 60, height: 60 } },
  { id: 'm-p2-tall', pageNumber: 2, name: 'Camera 4', bounds: { x: 300, y: 200, width: 40, height: 300 } },
];

async function seed(admin) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const docId = randomUUID();
  const templateId = randomUUID();
  const templateName = `E2E Locate ${Date.now()}`;
  const docName = `E2E Locate ${Date.now()}.pdf`;
  const bytes = fs.readFileSync(path.resolve(FIXTURE));
  const filePath = `${ownerId}/${docId}.pdf`;
  const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), {
    contentType: 'application/pdf', upsert: true,
  });
  if (up.error) throw up.error;
  const template = await admin.from('templates').insert({
    id: templateId, user_id: ownerId, name: templateName, description: 'survey-locate-marker.spec',
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

// The markers go in through the app's own annotation-doc module, signed in as
// the owner (Node cannot load the app's ESM sources here).
function addMarkers(page, documentId) {
  const records = Object.fromEntries(MARKERS.map((m) => [m.id, {
    ...m, moduleId: 'm-sec', regionId: null, categoryId: 'c-cam', checklistResponses: {}, color: null,
  }]));
  return page.evaluate(async ({ docId, markers }) => {
    const sync = await import('/src/services/annotationDocSync.js');
    const { supabase } = await import('/src/supabaseClient.js');
    const { data } = await supabase.auth.getUser();
    const handle = await sync.openAnnotationDoc({
      documentId: docId, supabase, actorUserId: data.user.id, enableLocal: false, enableRealtime: false,
    });
    handle.applySurveyMarkers(markers);
    await handle.drain();
    handle.destroy();
  }, { docId: documentId, markers: records });
}

async function cleanup(admin, seeded) {
  await admin.from('documents').delete().eq('id', seeded.docId);
  await admin.storage.from('documents').remove([seeded.filePath]);
  await admin.from('templates').delete().eq('id', seeded.templateId);
}

// Where the marker is drawn, against the part of the viewer no panel covers.
function measure(page, markerId) {
  return page.evaluate((id) => {
    const scroller = document.querySelector('[data-touch-pdf-surface]');
    const group = document.querySelector(`[data-survey-marker-id="${id}"]`);
    const el = group?.querySelector(':scope > rect') || group;
    if (!scroller || !el) return null;
    const v = scroller.getBoundingClientRect();
    let left = v.left;
    let right = v.right;
    for (const node of document.querySelectorAll('[data-viewer-occluder="side"]')) {
      const r = node.getBoundingClientRect();
      if (!(r.width > 0) || r.bottom <= v.top || r.top >= v.bottom) continue;
      if (r.left <= v.left + 4 && r.right > left) left = Math.min(r.right, v.right);
      if (r.right >= v.right - 4 && r.left < right) right = Math.max(r.left, v.left);
    }
    // The tool bars over the top of the viewer.
    let top = v.top;
    for (const node of document.querySelectorAll('[data-viewer-occluder="bar"]')) {
      const r = node.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.top <= top + 2 && r.bottom > top) top = Math.min(r.bottom, v.bottom);
    }
    const m = el.getBoundingClientRect();
    return {
      dx: m.left + m.width / 2 - (left + right) / 2,
      dy: m.top + m.height / 2 - (top + v.bottom) / 2,
      fillW: m.width / (right - left),
      fillH: m.height / (v.bottom - top),
    };
  }, markerId);
}

test('Locate on page centres and zooms to the marker on the first click, every time', async ({ page }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const seeded = await seed(admin);
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await addMarkers(page, seeded.docId);
    await page.getByText(seeded.docName, { exact: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] canvas').first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Survey', exact: true }).click();
    await page.getByText(seeded.templateName, { exact: true }).first().click();
    await page.getByRole('button', { name: 'Show Survey Markers in Camera' }).click();
    const rows = page.locator('.survey-rail__marker-line');
    await expect(rows).toHaveCount(MARKERS.length, { timeout: 30_000 });

    const order = [0, 2, 1, 3, 0, 3, 2, 1];
    for (const index of order) {
      const marker = MARKERS[index];
      // The marker's name is its row's text field.
      const row = rows.filter({ has: page.locator(`input[value="${marker.name}"]`) });
      await row.getByRole('button', { name: 'Locate on page' }).click();
      await page.waitForTimeout(200);
      const landed = await measure(page, marker.id);
      await page.waitForTimeout(700);
      const at = await measure(page, marker.id);
      console.log(`[locate] ${marker.name} p${marker.pageNumber}`, JSON.stringify(at));
      expect(at, `${marker.name} is drawn after Locate`).not.toBeNull();
      // Landed at once and stays: nothing pushes the page after (the survey
      // bar used to leave and come back while the pick changed hands).
      expect(landed, `${marker.name} is on screen within 200 ms`).not.toBeNull();
      expect(Math.abs(at.dy - landed.dy), `${marker.name} does not move after landing`).toBeLessThan(1.5);
      expect(Math.abs(at.dx), `${marker.name} centred across`).toBeLessThan(6);
      expect(Math.abs(at.dy), `${marker.name} centred down`).toBeLessThan(6);
      expect(Math.max(at.fillW, at.fillH), `${marker.name} zoomed to its extents`).toBeGreaterThan(0.2);
    }
  } finally {
    await cleanup(admin, seeded);
  }
});
