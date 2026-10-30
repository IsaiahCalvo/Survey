// Comments on marks (Nightly, flag 'mark-comments'): a thread on a picked
// mark from the selection bar's Comment button, an @mention, a live reply
// from someone else, a link that opens one comment, edit and delete. Writes
// go only through the checked functions (add/edit/delete_mark_comment).
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
  pdf.addPage([612, 792]).drawText('Comment sheet page 1', { x: 72, y: 700, size: 24, font });
  return Buffer.from(await pdf.save());
}

test('comments: start on a mark, mention, live reply, link to a comment, edit and delete', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const editor = await apiClientFor(E2E_ACCOUNTS.editor);
  const viewer = await apiClientFor(E2E_ACCOUNTS.viewer);
  const stranger = await apiClientFor(E2E_ACCOUNTS.free);
  const ids = {};
  for (const [key, client] of Object.entries({ owner, editor, stranger })) {
    ids[key] = (await client.auth.getUser()).data.user.id;
  }
  const name = `Comment sheet ${RUN}.pdf`;
  const docId = crypto.randomUUID();
  const bytes = await sheetPdf();
  const path = `${ids.owner}/${docId}.pdf`;
  await must('upload', admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id: docId, user_id: ids.owner, project_id: E2E_PROJECT.id, name, file_path: path, file_size: bytes.length, page_count: 1,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  // One filled rectangle on page 1.
  const markId = `comment-rect-${RUN}`;
  const source = new Y.Doc();
  source.transact(() => {
    const entry = new Y.Map();
    source.getMap('marks').set(markId, entry);
    entry.set('p', 1);
    const fields = new Y.Map();
    entry.set('o', fields);
    const rect = { type: 'rect', id: markId, left: 150, top: 220, width: 160, height: 90, stroke: '#e53935', strokeWidth: 3, fill: '#ffe082' };
    for (const [k, v] of Object.entries(rect)) fields.set(k, v);
  });
  await must('seed mark', owner.rpc('append_annotation_update', {
    p_document_id: docId, p_client_id: `seed-${RUN}`, p_client_seq: 1, p_data: bytesToPgHex(Y.encodeStateAsUpdate(source)),
  }));

  try {
    // Access: no one outside the document, and no viewer, can post; nobody
    // writes the table directly; a mention of someone off the document is dropped.
    expect((await stranger.rpc('add_mark_comment', { p_document_id: docId, p_page_number: 1, p_body: 'hi' })).error?.message).toContain('Document not found');
    expect((await viewer.rpc('add_mark_comment', { p_document_id: docId, p_page_number: 1, p_body: 'hi' })).error?.message).toContain('Document not found');
    expect((await owner.from('mark_comments').insert({ document_id: docId, page_number: 1, body: 'direct', author_id: ids.owner })).error).toBeTruthy();
    const pageNote = await must('page comment', editor.rpc('add_mark_comment', {
      p_document_id: docId, p_page_number: 1, p_body: 'Page note', p_mentions: [ids.stranger, ids.owner],
    }));
    expect(pageNote.mentions).toEqual([ids.owner]);
    expect((await stranger.from('mark_comments').select('id').eq('document_id', docId)).data).toEqual([]);
    expect((await viewer.from('mark_comments').select('id').eq('document_id', docId)).data).toHaveLength(1);
    expect((await owner.rpc('edit_mark_comment', { p_comment_id: pageNote.id, p_body: 'not mine' })).error?.message).toContain('Comment not found');
    const people = await must('people', owner.rpc('mark_comment_people', { p_document_id: docId }));
    expect(people.map((p) => p.user_id)).toEqual(expect.arrayContaining([ids.owner, ids.editor]));
    expect(await must('stranger people', stranger.rpc('mark_comment_people', { p_document_id: docId }))).toEqual([]);
    // A comment whose author account is gone (author_id set to null) fails
    // closed: an editor cannot delete it, only the owner can.
    const orphan = await must('orphan comment', editor.rpc('add_mark_comment', { p_document_id: docId, p_page_number: 1, p_body: 'Orphan' }));
    await must('drop author', admin.from('mark_comments').update({ author_id: null }).eq('id', orphan.id).select('id'));
    expect((await editor.rpc('delete_mark_comment', { p_comment_id: orphan.id })).error?.message).toContain('Comment not found');
    expect((await must('owner deletes orphan', owner.rpc('delete_mark_comment', { p_comment_id: orphan.id }))).deleted_at).toBeTruthy();

    await page.addInitScript(() => localStorage.setItem('survey.flag.mark-comments', '1'));
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.getByText('Comment sheet page 1')).toBeVisible({ timeout: 60_000 });
    const mark = page.locator(`[data-overlay-page="1"] [data-annotation-id="${markId}"]`).first();
    await expect(mark).toBeAttached({ timeout: 30_000 });

    // Pick the rectangle, then Comment on the selection bar.
    await page.keyboard.press('v');
    await page.waitForTimeout(400);
    const box = await mark.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const commentButton = page.locator('[data-selection-quick-bar][data-visible="true"] [data-selection-quick-comment]');
    await expect(commentButton).toBeVisible({ timeout: 10_000 });
    await commentButton.click();

    const panel = page.getByTestId('comments-panel');
    await expect(panel).toBeVisible();
    const draft = panel.locator(`[data-comment-draft="${markId}"]`);
    await expect(draft).toContainText('Rectangle · page 1');
    const input = draft.locator('[data-comment-input]');
    await input.fill('Please check this @Edd');
    await expect(panel.locator(`[data-mention-option="${ids.editor}"]`)).toBeVisible();
    await page.keyboard.press('Enter'); // picks the person
    await expect(input).toHaveValue('Please check this @Eddie Editor ');
    await page.keyboard.press('Enter'); // posts
    await expect(draft).toHaveCount(0);

    let thread = panel.locator('[data-comment-thread]').filter({ hasText: 'Please check this' });
    await expect(thread).toHaveCount(1);
    await expect(thread.locator('.comments-mention')).toHaveText('@Eddie Editor');
    const root = await must('root', admin.from('mark_comments').select('*').eq('document_id', docId).eq('mark_id', markId).single());
    expect(root.mentions).toEqual([ids.editor]);
    expect(root.author_id).toBe(ids.owner);
    thread = panel.locator(`[data-comment-thread="${root.id}"]`);
    await expect(panel.locator('[data-comment-thread]')).toHaveCount(2); // with the page note

    // Someone else's reply arrives live.
    const reply = await must('reply', editor.rpc('add_mark_comment', {
      p_document_id: docId, p_page_number: 9, p_body: 'Checked, all good', p_thread_id: root.id,
    }));
    expect(reply.page_number).toBe(1); // a reply sits where its thread is
    await expect(thread).toContainText('Checked, all good', { timeout: 20_000 });

    // The label zooms to the mark.
    await thread.locator('.comments-thread__target--link').click();

    // Edit my comment, then delete it: a stub stays above the reply.
    const rootItem = thread.locator(`[data-comment-id="${root.id}"]`);
    await rootItem.getByRole('button', { name: 'Edit comment' }).click();
    await rootItem.locator('[data-comment-input]').fill('Please check this again');
    await rootItem.locator('[data-comment-submit]').click();
    await expect(rootItem).toContainText('Please check this again');
    await expect(rootItem).toContainText('edited');
    await rootItem.getByRole('button', { name: 'Delete comment' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(thread.locator(`[data-comment-id="${root.id}"]`)).toHaveText('Comment deleted');
    await expect(thread).toContainText('Checked, all good');

    // A link to the reply opens the document with that comment in view.
    await page.goto(`/?docId=${docId}&comment=${reply.id}`);
    const linked = page.getByTestId('comments-panel').locator(`[data-comment-thread="${root.id}"]`);
    await expect(linked).toBeVisible({ timeout: 60_000 });
    await expect(linked).toHaveClass(/is-highlighted/);
    await page.screenshot({ path: test.info().outputPath('comments-panel.png') });
  } finally {
    await admin.from('documents').delete().eq('id', docId);
  }
});
