// KAL-415: resolve a comment thread, as Drawboard does. A resolved thread
// leaves the Open list for Resolved, where Reopen brings it back; resolving
// acts at once with an Undo on the toast. Only editors resolve, only a whole
// thread (its first comment), through set_mark_comment_resolved.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

async function sheetPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText('Resolve sheet page 1', { x: 72, y: 700, size: 24, font });
  return Buffer.from(await pdf.save());
}

test('comments: resolve a thread, find it under Resolved, reopen it, and Undo', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const editor = await apiClientFor(E2E_ACCOUNTS.editor);
  const viewer = await apiClientFor(E2E_ACCOUNTS.viewer);
  const stranger = await apiClientFor(E2E_ACCOUNTS.free);
  const ids = {};
  for (const [key, client] of Object.entries({ owner, editor })) {
    ids[key] = (await client.auth.getUser()).data.user.id;
  }
  const name = `Resolve sheet ${RUN}.pdf`;
  const docId = crypto.randomUUID();
  const bytes = await sheetPdf();
  const path = `${ids.owner}/${docId}.pdf`;
  await must('upload', admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id: docId, user_id: ids.owner, project_id: E2E_PROJECT.id, name, file_path: path, file_size: bytes.length, page_count: 1,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));

  try {
    const first = await must('first thread', editor.rpc('add_mark_comment', { p_document_id: docId, p_page_number: 1, p_body: 'Door swing is wrong' }));
    const second = await must('second thread', editor.rpc('add_mark_comment', { p_document_id: docId, p_page_number: 1, p_body: 'Label missing here' }));
    const reply = await must('reply', owner.rpc('add_mark_comment', { p_document_id: docId, p_page_number: 1, p_body: 'Fixed it', p_thread_id: first.id }));

    // Access: no viewer or outsider resolves; a reply is not a thread;
    // nobody writes the column directly.
    expect((await stranger.rpc('set_mark_comment_resolved', { p_comment_id: first.id, p_resolved: true })).error?.message).toContain('Comment not found');
    expect((await viewer.rpc('set_mark_comment_resolved', { p_comment_id: first.id, p_resolved: true })).error?.message).toContain('Comment not found');
    expect((await owner.rpc('set_mark_comment_resolved', { p_comment_id: reply.id, p_resolved: true })).error?.message).toContain('Only a whole thread');
    await owner.from('mark_comments').update({ resolved_at: new Date().toISOString() }).eq('id', first.id);
    expect((await must('still open', admin.from('mark_comments').select('resolved_at').eq('id', first.id).single())).resolved_at).toBeNull();

    await page.addInitScript(() => localStorage.setItem('survey.flag.mark-comments', '1'));
    await signIn(page, E2E_ACCOUNTS.owner);
    // A link to a comment opens the document with the Comments panel.
    await page.goto(`/?docId=${docId}&comment=${second.id}`);
    const panel = page.getByTestId('comments-panel');
    await expect(panel.locator(`[data-comment-thread="${second.id}"]`)).toBeVisible({ timeout: 60_000 });
    await expect(panel.locator('[data-comment-filter="open"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.locator('[data-comment-filter="open"]')).toContainText('2');
    await expect(panel.locator('[data-comment-filter="resolved"]')).toContainText('0');

    // Resolve: it leaves Open at once, no confirm.
    await panel.locator(`[data-comment-resolve="${first.id}"]`).click();
    await expect(panel.locator(`[data-comment-thread="${first.id}"]`)).toHaveCount(0);
    await expect(panel.locator('[data-comment-filter="resolved"]')).toContainText('1');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    let row = await must('resolved row', admin.from('mark_comments').select('resolved_at, resolved_by').eq('id', first.id).single());
    expect(row.resolved_at).toBeTruthy();
    expect(row.resolved_by).toBe(ids.owner);

    // Undo on the toast puts it back.
    await page.locator('.app-toast__action', { hasText: 'Undo' }).click();
    await expect(panel.locator(`[data-comment-thread="${first.id}"]`)).toBeVisible();
    await expect.poll(async () => (await admin.from('mark_comments').select('resolved_at').eq('id', first.id).single()).data?.resolved_at).toBeNull();

    // Resolve again, then find it under Resolved with who did it.
    await panel.locator(`[data-comment-resolve="${first.id}"]`).click();
    await expect(panel.locator(`[data-comment-thread="${first.id}"]`)).toHaveCount(0);
    await panel.locator('[data-comment-filter="resolved"]').click();
    const resolvedThread = panel.locator(`[data-comment-thread="${first.id}"]`);
    await expect(resolvedThread).toBeVisible();
    await expect(resolvedThread.locator('[data-comment-resolved-note]')).toContainText('Resolved by you');
    await expect(resolvedThread).toContainText('Fixed it');
    await expect(resolvedThread.locator(`[data-comment-reply="${first.id}"]`)).toHaveCount(0);
    await expect(panel.locator(`[data-comment-thread="${second.id}"]`)).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('comments-resolved.png') });

    // Someone else resolves the other thread: it moves live.
    await must('editor resolves', editor.rpc('set_mark_comment_resolved', { p_comment_id: second.id, p_resolved: true }));
    const other = panel.locator(`[data-comment-thread="${second.id}"]`);
    await expect(other).toBeVisible({ timeout: 20_000 });
    await expect(other.locator('[data-comment-resolved-note]')).toContainText('Resolved by Eddie Editor');

    // Reopen brings it back to Open.
    await resolvedThread.locator(`[data-comment-reopen="${first.id}"]`).click();
    await expect(resolvedThread).toHaveCount(0);
    await panel.locator('[data-comment-filter="open"]').click();
    await expect(panel.locator(`[data-comment-thread="${first.id}"]`)).toBeVisible();
    row = await must('reopened row', admin.from('mark_comments').select('resolved_at, resolved_by').eq('id', first.id).single());
    expect(row).toEqual({ resolved_at: null, resolved_by: null });

    // A link to a comment in a resolved thread opens the Resolved list.
    await page.goto(`/?docId=${docId}&comment=${second.id}`);
    const linked = page.getByTestId('comments-panel').locator(`[data-comment-thread="${second.id}"]`);
    await expect(linked).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('comments-panel').locator('[data-comment-filter="resolved"]')).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await admin.from('documents').delete().eq('id', docId);
  }
});
