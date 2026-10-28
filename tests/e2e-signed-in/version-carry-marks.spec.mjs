// "Upload as new version" brings the old copy's marks and survey markers
// across to the same page and spot (src/services/documentVersionMarks.js),
// then archives the old copy. Before, the new version opened empty.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as Y from 'yjs';
import { syncSurveyMarkersToDoc } from '../../supabase/functions/_shared/surveyMarkerDocSync.js';
import { bytesToPgHex } from '../../supabase/functions/_shared/pgBytea.js';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

async function sheetPdf(label) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 2; i += 1) {
    const page = pdf.addPage([612, 792]);
    page.drawText(`${label} page ${i}`, { x: 72, y: 700, size: 24, font });
  }
  return Buffer.from(await pdf.save());
}

test('a new version keeps the old copy\'s marks in the same spot', async ({ page }) => {
  test.setTimeout(180_000);
  const owner = E2E_ACCOUNTS.owner;
  const admin = adminClient();
  const api = await apiClientFor(owner);
  const { data: { user } } = await api.auth.getUser();
  const name = `Carry sheet ${RUN}.pdf`;
  const markId = `carry-rect-${RUN}`;
  const markerId = `surveyMarker-carry-${RUN}`;

  // The first version: a real PDF with one rectangle on page 2 and one survey marker.
  const oldId = crypto.randomUUID();
  const oldBytes = await sheetPdf('Rev A');
  const oldPath = `${user.id}/${oldId}.pdf`;
  await must('upload v1', admin.storage.from('documents').upload(oldPath, new Blob([oldBytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('v1 row', admin.from('documents').insert({
    id: oldId, user_id: user.id, project_id: null, name, file_path: oldPath, file_size: oldBytes.length, page_count: 2,
    content_sha256: crypto.createHash('sha256').update(oldBytes).digest('hex'),
  }));
  const source = new Y.Doc();
  // A mark as the store keeps it (annotationMarkStore.js): marks[key] = { p: page, o: fields }.
  source.transact(() => {
    const entry = new Y.Map();
    source.getMap('marks').set(markId, entry);
    entry.set('p', 2);
    const fields = new Y.Map();
    entry.set('o', fields);
    const rect = { type: 'rect', id: markId, left: 150, top: 220, width: 120, height: 60, stroke: '#e53935', strokeWidth: 3, fill: 'transparent' };
    for (const [k, v] of Object.entries(rect)) fields.set(k, v);
  });
  syncSurveyMarkersToDoc(source, { [markerId]: { annotationId: markerId, pageNumber: 1, name: 'Carry panel' } });
  await must('seed marks', api.rpc('append_annotation_update', {
    p_document_id: oldId, p_client_id: `seed-${RUN}`, p_client_seq: 1, p_data: bytesToPgHex(Y.encodeStateAsUpdate(source)),
  }));

  try {
    await signIn(page, owner);
    // Same name, new contents -> the app asks; take "Upload as new version".
    const chooser = page.waitForEvent('filechooser');
    await page.locator('button.documents-desktop-upload').filter({ visible: true }).first().click();
    await (await chooser).setFiles({ name, mimeType: 'application/pdf', buffer: await sheetPdf('Rev B') });
    const ask = page.getByRole('dialog', { name: 'You already have this file name' });
    await expect(ask).toBeVisible();
    await expect(ask).toContainText('brings your marks across to the same spots');
    await ask.getByRole('button', { name: 'Upload as new version' }).click();

    await expect(page.getByText('Brought 2 marks across from the old version')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Rev B page 1')).toBeVisible({ timeout: 60_000 });

    // The new row holds the copy, written once under the old document's writer id.
    const { data: rows } = await admin.from('documents').select('id, user_archived_at, archived').eq('name', name).eq('user_id', user.id);
    const fresh = rows.find((r) => r.id !== oldId);
    expect(fresh, JSON.stringify(rows)).toBeTruthy();
    const { data: wal } = await admin.from('annotation_updates').select('client_id, client_seq').eq('document_id', fresh.id);
    expect(wal.filter((r) => r.client_id === `version-carry-${oldId}`)).toHaveLength(1);

    // The rectangle is drawn on page 2 of the new version.
    await page.getByText('Rev B page 2').scrollIntoViewIfNeeded();
    await expect(page.locator(`[data-annotation-id="${markId}"]`).first()).toBeAttached({ timeout: 30_000 });

    // The old copy left the active list once the new bytes were stored.
    await expect.poll(async () => {
      const { data } = await admin.from('documents').select('user_archived_at, archived').eq('id', oldId).single();
      return Boolean(data?.user_archived_at || data?.archived);
    }, { timeout: 30_000 }).toBe(true);
  } finally {
    await admin.from('documents').delete().eq('name', name).eq('user_id', user.id);
  }
});
