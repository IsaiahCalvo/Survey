// Owner, 2026-11-24 (audit round 5, #6): a Commenter reads everything and
// may comment, reply and resolve, but never draws. Nightly flag
// commenter-role puts the role in the pickers; the rights are server-side.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as Y from 'yjs';
import { bytesToPgHex } from '../../supabase/functions/_shared/pgBytea.js';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

async function sheetPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText('Commenter sheet page 1', { x: 72, y: 700, size: 24, font });
  return Buffer.from(await pdf.save());
}

function oneMarkUpdate(markId) {
  const doc = new Y.Doc();
  doc.transact(() => {
    const entry = new Y.Map();
    doc.getMap('marks').set(markId, entry);
    entry.set('p', 1);
    const fields = new Y.Map();
    entry.set('o', fields);
    for (const [k, v] of Object.entries({ type: 'rect', id: markId, left: 150, top: 220, width: 160, height: 90, stroke: '#e53935', strokeWidth: 3 })) fields.set(k, v);
  });
  return bytesToPgHex(Y.encodeStateAsUpdate(doc));
}

test('a Commenter comments, replies and resolves, but cannot draw', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const commenter = await apiClientFor(E2E_ACCOUNTS.viewer);
  const ids = {
    owner: (await owner.auth.getUser()).data.user.id,
    commenter: (await commenter.auth.getUser()).data.user.id,
  };
  const name = `Commenter sheet ${RUN}.pdf`;
  const docId = crypto.randomUUID();
  const bytes = await sheetPdf();
  const path = `${ids.owner}/${docId}.pdf`;
  await must('upload', admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id: docId, user_id: ids.owner, project_id: E2E_PROJECT.id, name, file_path: path, file_size: bytes.length, page_count: 1,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  await must('commenter grant', admin.from('document_collaborators').insert({
    document_id: docId, user_id: ids.commenter, email: E2E_ACCOUNTS.viewer.email, role: 'commenter', status: 'active',
  }).select('id'));

  try {
    expect(await must('role', commenter.rpc('get_my_document_role', { doc_id: docId }))).toBe('commenter');
    // Comments: yes. Drawing: no.
    const thread = await must('owner thread', owner.rpc('add_mark_comment', { p_document_id: docId, p_page_number: 1, p_body: 'Is this door right?' }));
    const mine = await must('commenter thread', commenter.rpc('add_mark_comment', { p_document_id: docId, p_page_number: 1, p_body: 'Commenter note' }));
    await must('edit own', commenter.rpc('edit_mark_comment', { p_comment_id: mine.id, p_body: 'Commenter note, edited' }));
    const draw = await commenter.rpc('append_annotation_update', {
      p_document_id: docId, p_client_id: `commenter-${RUN}`, p_client_seq: 1, p_data: oneMarkUpdate(`commenter-rect-${RUN}`),
    });
    expect(draw.error).toBeTruthy();

    await page.addInitScript(() => {
      localStorage.setItem('survey.flag.mark-comments', '1');
      localStorage.setItem('survey.flag.commenter-role', '1');
    });
    await signIn(page, E2E_ACCOUNTS.viewer);
    await page.goto(`/?docId=${docId}&comment=${thread.id}`);
    const panel = page.getByTestId('comments-panel');
    const row = panel.locator(`[data-comment-thread="${thread.id}"]`);
    await expect(row).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Comment-only access')).toBeVisible({ timeout: 30_000 });

    // Reply in the app.
    await row.locator(`[data-comment-reply="${thread.id}"]`).click();
    const input = row.locator('[data-comment-input]');
    await input.fill('Yes, it swings in.');
    await page.keyboard.press('Enter');
    await expect(row).toContainText('Yes, it swings in.', { timeout: 20_000 });
    await expect.poll(async () => (await admin.from('mark_comments').select('author_id, body').eq('thread_id', thread.id)).data, { timeout: 20_000 })
      .toEqual([{ author_id: ids.commenter, body: 'Yes, it swings in.' }]);

    // Resolve in the app.
    await row.locator(`[data-comment-resolve="${thread.id}"]`).click();
    await expect.poll(async () => (await admin.from('mark_comments').select('resolved_at').eq('id', thread.id).single()).data?.resolved_at, { timeout: 20_000 }).toBeTruthy();
  } finally {
    await admin.from('documents').delete().eq('id', docId);
  }
});
