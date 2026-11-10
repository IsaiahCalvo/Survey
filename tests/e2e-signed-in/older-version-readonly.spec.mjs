// Drawboard deep test follow-ups (Nightly):
//  - an older version opens read-only with a "You're viewing v1" bar, and
//    nothing drawn there is saved to it (DocumentLockBanner zero-writes mode);
//  - comment threads follow "Upload as new version" (carry_mark_comments);
//  - the phone's More menu lists Versions;
//  - a mark drawn on a hidden layer says so, with Show layer.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

// Opening another version opens a second tab: always the front one.
const FRONT = '[data-viewer-tab]:not([data-tab-behind])';
const PAGE = `${FRONT} .survey-pdfjs-page-div[data-page-number="1"]`;
const MARKS = `${FRONT} [data-overlay-page="1"] [data-annotation-id]`;
const markIds = (page) => page.locator(MARKS).evaluateAll((nodes) => [...new Set(nodes.map((n) => n.getAttribute('data-annotation-id')))]);

async function sheetPdf(label) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  page.drawText(`${label} page 1`, { x: 72, y: 700, size: 24, font });
  page.drawLine({ start: { x: 72, y: 400 }, end: { x: 540, y: 400 }, thickness: 6, color: rgb(0, 0, 0) });
  return Buffer.from(await pdf.save());
}

async function addDoc(admin, userId, name, bytes) {
  const id = crypto.randomUUID();
  const path = `${userId}/${id}.pdf`;
  await must('upload', admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id, user_id: userId, project_id: null, name, file_path: path, file_size: bytes.length, page_count: 1,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  return id;
}

async function drawRect(page, fx = 0.5, fy = 0.7) {
  const box = await page.locator(PAGE).boundingBox();
  const at = (x, y) => ({ x: box.x + box.width * x, y: box.y + box.height * y });
  await page.mouse.click(5, 450);
  await page.keyboard.press('r');
  await page.mouse.move(at(fx, fy).x, at(fx, fy).y);
  await page.mouse.down();
  await page.mouse.move(at(fx + 0.12, fy + 0.08).x, at(fx + 0.12, fy + 0.08).y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
}

async function linkedVersions(admin, api, user, label) {
  const name = `${label} ${RUN}.pdf`;
  const v1 = await addDoc(admin, user.id, name, await sheetPdf(`${label} A`));
  const v2 = await addDoc(admin, user.id, name, await sheetPdf(`${label} B`));
  await must('supersede', api.rpc('supersede_document', { p_old_document_id: v1, p_new_document_id: v2 }));
  return { name, v1, v2 };
}

async function cleanup(admin, ids) {
  await admin.from('documents').update({ superseded_by: null }).in('id', ids);
  await admin.from('documents').delete().in('id', ids);
}

test('an older version opens read-only: bar, no saved marks, Open current version', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const { name, v1, v2 } = await linkedVersions(admin, api, user, 'Read-only older');
  try {
    await page.addInitScript(() => localStorage.setItem('survey.flag.document-versions', '1'));
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.getByText('Read-only older B page 1')).toBeVisible({ timeout: 60_000 });
    const button = page.locator('[data-document-versions-button]');
    await expect(button).toHaveText('v2', { timeout: 30_000 });
    // The current version has no bar and is editable.
    await expect(page.locator('[data-older-version-bar]')).toHaveCount(0);

    await button.click();
    await page.locator('[data-document-versions] [data-version-open-button="1"]').click();
    await expect(page.getByText('Read-only older A page 1')).toBeVisible({ timeout: 60_000 });
    const bar = page.locator('[data-older-version-bar]');
    await expect(bar).toContainText('You’re viewing v1.');
    await expect(page.locator('body')).toHaveAttribute('data-readonly', 'true');
    await expect(page.locator('[data-testid="kal49-lock-banner"]')).toHaveCount(0);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: test.info().outputPath('older-version-bar-desktop.png') });

    // Drawing does nothing, and nothing reaches the older copy.
    const before = (await markIds(page)).length;
    await drawRect(page);
    await page.waitForTimeout(2500);
    expect((await markIds(page)).length).toBe(before);
    const { count } = await admin.from('annotation_updates').select('*', { count: 'exact', head: true }).eq('document_id', v1);
    expect(count).toBe(0);

    await bar.getByRole('button', { name: 'Open current version' }).click();
    await expect(page.getByText('Read-only older B page 1')).toBeVisible({ timeout: 60_000 });
    await expect(button).toHaveText('v2', { timeout: 30_000 });
    await expect(page.locator('[data-older-version-bar]')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveAttribute('data-readonly', 'true');
    // The current version still takes marks.
    const beforeCurrent = new Set(await markIds(page));
    await drawRect(page, 0.3, 0.6);
    await expect.poll(async () => (await markIds(page)).filter((id) => !beforeCurrent.has(id)).length, { timeout: 15_000 }).toBe(1);
  } finally {
    await cleanup(admin, [v1, v2]);
  }
});

test('phone: More lists Versions; an older version shows the bar under the header', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const { name, v1, v2 } = await linkedVersions(admin, api, user, 'Phone versions');
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => localStorage.setItem('survey.flag.document-versions', '1'));
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
    const open = page.getByRole('button', { name: 'Open file' }).filter({ visible: true });
    if (await open.count()) await open.first().click();
    await expect(page.getByText('Phone versions B page 1')).toBeVisible({ timeout: 60_000 });

    await page.getByRole('button', { name: 'More document options', exact: true }).filter({ visible: true }).first().click();
    const row = page.locator('[data-mobile-document-versions]');
    await expect(row).toHaveText('Versions (v2 of 2)', { timeout: 30_000 });
    await row.click();
    const list = page.locator('[data-document-versions]');
    await expect(list.locator('[data-version-row]')).toHaveCount(2);
    await page.screenshot({ path: test.info().outputPath('versions-phone-list.png') });
    await list.locator('[data-version-open-button="1"]').click();
    await expect(page.getByText('Phone versions A page 1')).toBeVisible({ timeout: 60_000 });
    const bar = page.locator('[data-older-version-bar]');
    await expect(bar).toContainText('You’re viewing v1.');
    // Under the header, never over its Back button.
    const header = await page.locator('[data-mobile-pdf-header]').boundingBox();
    const barBox = await bar.boundingBox();
    expect(barBox.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
    expect(barBox.x + barBox.width).toBeLessThanOrEqual(391);
    await page.waitForTimeout(600);
    await page.screenshot({ path: test.info().outputPath('older-version-bar-phone.png') });

    // Compare from the phone too.
    await page.getByRole('button', { name: 'More document options', exact: true }).filter({ visible: true }).first().click();
    await page.locator('[data-mobile-document-versions]').click();
    await list.locator('[data-version-compare-button="2"]').click();
    await expect(page.locator('[data-version-compare]')).toContainText('Compare v1 with v2');
    await expect(page.locator('[data-compare-canvas]')).toHaveAttribute('aria-busy', 'false', { timeout: 60_000 });
    await page.screenshot({ path: test.info().outputPath('versions-phone-compare.png') });
  } finally {
    await cleanup(admin, [v1, v2]);
  }
});

test('comment threads follow a new version; only editors of both copies can copy them', async () => {
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const stranger = await apiClientFor(E2E_ACCOUNTS.free);
  const { data: { user } } = await api.auth.getUser();
  const name = `Comment carry ${RUN}.pdf`;
  const v1 = await addDoc(admin, user.id, name, await sheetPdf('Carry A'));
  const v2 = await addDoc(admin, user.id, name, await sheetPdf('Carry B'));
  const other = await addDoc(admin, user.id, `Other ${RUN}.pdf`, await sheetPdf('Other'));
  try {
    const root = await must('root', api.rpc('add_mark_comment', { p_document_id: v1, p_page_number: 1, p_body: 'Check this valve @someone', p_mark_id: 'mark-abc' }));
    await must('reply', api.rpc('add_mark_comment', { p_document_id: v1, p_page_number: 1, p_body: 'Done', p_thread_id: root.id }));
    const gone = await must('gone', api.rpc('add_mark_comment', { p_document_id: v1, p_page_number: 1, p_body: 'Typo' }));
    await must('delete', api.rpc('delete_mark_comment', { p_comment_id: gone.id }));

    const refused = await stranger.rpc('carry_mark_comments', { p_from_document_id: v1, p_to_document_id: v2 });
    expect(refused.error?.message).toContain('Document not found');

    await must('supersede', api.rpc('supersede_document', { p_old_document_id: v1, p_new_document_id: v2 }));
    // Not onto a copy that did not replace it.
    const wrong = await api.rpc('carry_mark_comments', { p_from_document_id: v1, p_to_document_id: other });
    expect(wrong.error?.message).toContain('already has a newer version');

    expect(await must('carry', api.rpc('carry_mark_comments', { p_from_document_id: v1, p_to_document_id: v2 }))).toBe(2);
    // A retry copies nothing twice.
    expect(await must('carry again', api.rpc('carry_mark_comments', { p_from_document_id: v1, p_to_document_id: v2 }))).toBe(0);

    const { data: copied } = await admin.from('mark_comments').select('*').eq('document_id', v2).order('created_at');
    expect(copied).toHaveLength(2);
    const [copyRoot, copyReply] = copied;
    expect(copyRoot).toMatchObject({ thread_id: null, mark_id: 'mark-abc', page_number: 1, body: 'Check this valve @someone', author_id: user.id, carried_from: root.id });
    expect(copyReply).toMatchObject({ thread_id: copyRoot.id, mark_id: 'mark-abc', body: 'Done' });
    expect(copyRoot.mentions_notified_at).not.toBeNull();
    // The old copy keeps its own threads.
    const { count } = await admin.from('mark_comments').select('*', { count: 'exact', head: true }).eq('document_id', v1);
    expect(count).toBe(3);
  } finally {
    await cleanup(admin, [v1, v2, other]);
  }
});

test('"Upload as new version" brings comment threads across with the marks', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const name = `Upload carry ${RUN}.pdf`;
  const v1 = await addDoc(admin, user.id, name, await sheetPdf('Upload carry A'));
  try {
    await must('comment', api.rpc('add_mark_comment', { p_document_id: v1, p_page_number: 1, p_body: 'Page note that should follow' }));
    await page.addInitScript(() => {
      localStorage.setItem('survey.flag.document-versions', '1');
      localStorage.setItem('survey.flag.mark-comments', '1');
    });
    await signIn(page, E2E_ACCOUNTS.owner);
    const chooser = page.waitForEvent('filechooser');
    await page.locator('button.documents-desktop-upload').filter({ visible: true }).first().click();
    await (await chooser).setFiles({ name, mimeType: 'application/pdf', buffer: await sheetPdf('Upload carry B') });
    await page.getByRole('dialog', { name: 'You already have this file name' }).getByRole('button', { name: 'Upload as new version' }).click();
    await expect(page.getByText('1 comment across from the old version')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Upload carry B page 1')).toBeVisible({ timeout: 60_000 });
    const { data: { superseded_by: v2 } } = await admin.from('documents').select('superseded_by').eq('id', v1).single();
    expect(v2).toBeTruthy();
    const { data: copied } = await admin.from('mark_comments').select('body').eq('document_id', v2);
    expect(copied.map((c) => c.body)).toEqual(['Page note that should follow']);
  } finally {
    await admin.from('documents').update({ superseded_by: null }).eq('id', v1);
    await admin.from('documents').delete().eq('name', name).eq('user_id', user.id);
  }
});

test('drawing on a hidden layer says so; Show layer brings the mark into view', async ({ page }) => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const name = `Hidden layer ${RUN}.pdf`;
  const id = await addDoc(admin, user.id, name, await sheetPdf('Hidden layer'));
  try {
    await page.addInitScript(() => localStorage.setItem('survey.flag.layers', '1'));
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.locator(`${PAGE} canvas`).first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1000);

    const layersButton = page.getByRole('button', { name: 'Layers', exact: true }).first();
    if ((await layersButton.getAttribute('aria-expanded')) !== 'true') await layersButton.click();
    const panel = page.getByTestId('layers-panel');
    await panel.getByRole('button', { name: 'Hide Default layer' }).click();

    const before = (await markIds(page)).length;
    await drawRect(page);
    const toast = page.getByText('“Default layer” is hidden, so the new mark can’t be seen.');
    await expect(toast).toBeVisible({ timeout: 10_000 });
    expect((await markIds(page)).length).toBe(before);
    await page.screenshot({ path: test.info().outputPath('hidden-layer-toast.png') });
    await page.getByRole('button', { name: 'Show layer' }).click();
    await expect.poll(async () => (await markIds(page)).length, { timeout: 10_000 }).toBe(before + 1);
    await expect(panel.getByRole('button', { name: 'Hide Default layer' })).toBeVisible();
  } finally {
    await admin.from('documents').delete().eq('id', id);
  }
});

test('a new version keeps its sharing; a person with the old copy open is told and it turns read-only', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const ownerApi = await apiClientFor(E2E_ACCOUNTS.owner);
  const editorApi = await apiClientFor(E2E_ACCOUNTS.editor);
  const { data: { user: owner } } = await ownerApi.auth.getUser();
  const { data: { user: editor } } = await editorApi.auth.getUser();
  const name = `Shared versions ${RUN}.pdf`;
  const v1 = await addDoc(admin, owner.id, name, await sheetPdf('Shared versions A'));
  const v2 = await addDoc(admin, owner.id, name, await sheetPdf('Shared versions B'));
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await must('share', admin.from('document_collaborators').insert({ document_id: v1, user_id: editor.id, invited_by: owner.id, role: 'editor', status: 'active' }));
    await page.addInitScript(() => localStorage.setItem('survey.flag.document-versions', '1'));
    await signIn(page, E2E_ACCOUNTS.editor);
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.getByText('Shared versions A page 1')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-older-version-bar]')).toHaveCount(0);

    // The owner uploads a new version somewhere else.
    await must('supersede', ownerApi.rpc('supersede_document', { p_old_document_id: v1, p_new_document_id: v2 }));
    const { data: shared } = await admin.from('document_collaborators').select('user_id, role, status').eq('document_id', v2);
    expect(shared).toEqual([{ user_id: editor.id, role: 'editor', status: 'active' }]);

    // The editor's open copy says so, by itself, and stops taking marks.
    await expect(page.getByText('A newer version was uploaded, so this copy is now read-only.')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-older-version-bar]')).toContainText('You’re viewing v1.');
    await expect(page.locator('body')).toHaveAttribute('data-readonly', 'true');
    await page.screenshot({ path: test.info().outputPath('shared-version-told.png') });

    // Open current version reaches v2, which the editor can mark up.
    await page.locator('[data-older-version-bar] .older-version-bar__action').click();
    await expect(page.getByText('Shared versions B page 1')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-older-version-bar]')).toHaveCount(0);
    await expect(page.locator('[data-document-versions-button]').filter({ visible: true }).first()).toHaveText('v2', { timeout: 30_000 });
    await drawRect(page);
    await expect.poll(async () => (await markIds(page)).length, { timeout: 10_000 }).toBe(1);

    // And it stays in the editor's own list (the RLS read the list makes).
    const { data: listed } = await editorApi.from('documents').select('id').eq('id', v2);
    expect(listed).toEqual([{ id: v2 }]);
  } finally {
    await context.close();
    await cleanup(admin, [v1, v2]);
  }
});
