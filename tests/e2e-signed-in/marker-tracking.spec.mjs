// Survey item tracking (Nightly, flag 'marker-tracking'): set a status, give
// the item to someone on the document and a due date, see it late on the
// closed row, filter the list with the chips, and find it all again after a
// reload (it is the marker's own field in the synced annotation doc).
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

const FIXTURE = 'debug/fixtures/clickable-link-test.pdf';
const MARKERS = [
  { id: 'track-a', pageNumber: 1, name: 'Door A', bounds: { x: 100, y: 120, width: 40, height: 40 } },
  { id: 'track-b', pageNumber: 1, name: 'Door B', bounds: { x: 220, y: 120, width: 40, height: 40 } },
];

function dayKey(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function seed(admin) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const editorId = data.users.find((u) => u.email === E2E_ACCOUNTS.editor.email).id;
  const docId = randomUUID();
  const templateId = randomUUID();
  const stamp = Date.now();
  const templateName = `E2E Tracking ${stamp}`;
  const docName = `E2E Tracking ${stamp}.pdf`;
  const bytes = fs.readFileSync(path.resolve(FIXTURE));
  const filePath = `${ownerId}/${docId}.pdf`;
  const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true });
  if (up.error) throw up.error;
  const template = await admin.from('templates').insert({
    id: templateId, user_id: ownerId, name: templateName, description: 'marker-tracking.spec',
    config: { modules: [{ id: 'm-doors', name: 'Doors', categories: [{ id: 'c-door', name: 'Door', checklist: [] }] }], entities: [] },
  });
  if (template.error) throw template.error;
  const doc = await admin.from('documents').insert({
    id: docId, user_id: ownerId, project_id: E2E_PROJECT.id, name: docName, file_path: filePath, file_size: bytes.length, page_count: 1,
  });
  if (doc.error) throw doc.error;
  const link = await admin.from('document_templates').insert({ document_id: docId, template_id: templateId, linked_by: ownerId });
  if (link.error) throw link.error;
  return { docId, docName, filePath, templateId, templateName, ownerId, editorId };
}

function addMarkers(page, documentId) {
  const records = Object.fromEntries(MARKERS.map((m) => [m.id, {
    ...m, moduleId: 'm-doors', regionId: null, categoryId: 'c-door', checklistResponses: {}, color: null,
  }]));
  return page.evaluate(async ({ docId, markers }) => {
    const sync = await import('/src/services/annotationDocSync.js');
    const { supabase } = await import('/src/supabaseClient.js');
    const { data } = await supabase.auth.getUser();
    const handle = await sync.openAnnotationDoc({ documentId: docId, supabase, actorUserId: data.user.id, enableLocal: false, enableRealtime: false });
    handle.applySurveyMarkers(markers);
    await handle.drain();
    handle.destroy();
  }, { docId: documentId, markers: records });
}

function storedTracking(page, documentId) {
  return page.evaluate(async (docId) => {
    const sync = await import('/src/services/annotationDocSync.js');
    const { supabase } = await import('/src/supabaseClient.js');
    const { data } = await supabase.auth.getUser();
    const handle = await sync.openAnnotationDoc({ documentId: docId, supabase, actorUserId: data.user.id, enableLocal: false, enableRealtime: false });
    const markers = handle.getSurveyMarkers();
    handle.destroy();
    return Object.fromEntries(Object.entries(markers).map(([id, m]) => [id, m.tracking || null]));
  }, documentId);
}

async function openSurvey(page, seeded) {
  await page.getByText(seeded.docName, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByText(seeded.templateName, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Show Survey Markers in Door' }).click();
  await expect(page.locator('.survey-rail__marker-line')).toHaveCount(MARKERS.length, { timeout: 30_000 });
}

const rowOf = (page, name) => page.locator('.survey-rail__marker-line').filter({ has: page.locator(`input[value="${name}"]`) });

async function pick(page, scope, label, option) {
  await scope.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('listbox', { name: label }).getByRole('option', { name: option, exact: true }).click();
}

test('tracking: status, assigned to and due date on a survey item, with list chips', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const seeded = await seed(admin);
  try {
    await page.addInitScript(() => localStorage.setItem('survey.flag.marker-tracking', '1'));
    await signIn(page, E2E_ACCOUNTS.owner);
    await addMarkers(page, seeded.docId);
    await openSurvey(page, seeded);

    // Door A: in progress, Eddie has it, due yesterday.
    await rowOf(page, 'Door A').getByRole('button', { name: 'Expand marker details' }).click();
    const tracking = page.getByTestId('survey-tracking');
    await expect(tracking).toHaveCount(1);
    await pick(page, tracking, 'Status', 'In progress');
    await pick(page, tracking, 'Assigned to', E2E_ACCOUNTS.editor.label);
    await tracking.locator('[data-tracking-due]').fill(dayKey(-1));
    await expect(tracking).toContainText('1 day late');
    await expect(tracking.getByRole('button', { name: 'Status', exact: true })).toHaveAttribute('data-value', 'in-progress');
    await rowOf(page, 'Door A').getByRole('button', { name: 'Collapse marker details' }).click();
    const badgeA = rowOf(page, 'Door A').locator('[data-tracking-badge]');
    await expect(badgeA).toHaveAttribute('data-tracking-badge', 'late');
    await expect(badgeA).toHaveText('EE');

    // Door B: done, given to me.
    await rowOf(page, 'Door B').getByRole('button', { name: 'Expand marker details' }).click();
    await pick(page, page.getByTestId('survey-tracking'), 'Status', 'Done');
    await pick(page, page.getByTestId('survey-tracking'), 'Assigned to', `${E2E_ACCOUNTS.owner.label} (me)`);
    await rowOf(page, 'Door B').getByRole('button', { name: 'Collapse marker details' }).click();
    await expect(rowOf(page, 'Door B').locator('[data-tracking-badge]')).toHaveText('Me');

    // The chips.
    const rows = page.locator('.survey-rail__marker-line');
    const chip = (key) => page.locator(`[data-tracking-filter="${key}"]`);
    await chip('overdue').click();
    await expect(rows).toHaveCount(1);
    await expect(rowOf(page, 'Door A')).toHaveCount(1);
    await chip('overdue').click();
    await chip('hideDone').click();
    await expect(rows).toHaveCount(1);
    await expect(rowOf(page, 'Door B')).toHaveCount(0);
    await chip('hideDone').click();
    await chip('mine').click();
    await expect(rows).toHaveCount(1);
    await expect(rowOf(page, 'Door B')).toHaveCount(1);
    await chip('mine').click();
    await expect(rows).toHaveCount(2);

    // Stored on the markers themselves.
    await expect.poll(async () => (await storedTracking(page, seeded.docId))['track-a']?.assigneeId, { timeout: 20_000 }).toBe(seeded.editorId);
    const stored = await storedTracking(page, seeded.docId);
    expect(stored['track-a']).toMatchObject({ status: 'in-progress', assigneeId: seeded.editorId, due: dayKey(-1), updatedBy: seeded.ownerId });
    expect(stored['track-b']).toMatchObject({ status: 'done', assigneeId: seeded.ownerId, due: null });

    // After a reload it is all still there.
    await page.reload();
    // The open tab comes back by itself; the Survey panel may too.
    await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] canvas').first()).toBeVisible({ timeout: 60_000 });
    const lines = page.locator('.survey-rail__marker-line');
    if (!(await lines.first().isVisible().catch(() => false))) {
      await page.waitForTimeout(3000);
      if (!(await lines.first().isVisible().catch(() => false))) {
        const surveyButton = page.getByRole('button', { name: 'Survey', exact: true });
        if ((await surveyButton.getAttribute('aria-pressed')) !== 'true') await surveyButton.click();
        const show = page.getByRole('button', { name: 'Show Survey Markers in Door' });
        if (!(await show.isVisible().catch(() => false))) await page.getByText(seeded.templateName, { exact: true }).filter({ visible: true }).first().click();
        if ((await show.getAttribute('aria-pressed')) !== 'true') await show.click();
      }
    }
    await expect(lines).toHaveCount(MARKERS.length, { timeout: 30_000 });
    await expect(rowOf(page, 'Door A').locator('[data-tracking-badge]')).toHaveAttribute('data-tracking-badge', 'late');
    await rowOf(page, 'Door A').getByRole('button', { name: 'Expand marker details' }).click();
    await expect(page.getByTestId('survey-tracking').getByRole('button', { name: 'Assigned to', exact: true })).toHaveAttribute('data-value', seeded.editorId);
    await page.screenshot({ path: test.info().outputPath('marker-tracking.png') });

    // Back to nothing set: the field goes away.
    await pick(page, page.getByTestId('survey-tracking'), 'Status', 'Open');
    await pick(page, page.getByTestId('survey-tracking'), 'Assigned to', 'Nobody');
    await page.getByTestId('survey-tracking').locator('[data-tracking-due]').fill('');
    await expect.poll(async () => (await storedTracking(page, seeded.docId))['track-a'], { timeout: 20_000 }).toBeNull();
  } finally {
    await admin.from('documents').delete().eq('id', seeded.docId);
    await admin.storage.from('documents').remove([seeded.filePath]);
    await admin.from('templates').delete().eq('id', seeded.templateId);
  }
});
