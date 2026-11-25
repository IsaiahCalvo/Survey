// Audit round 5 #15: two people answer the same Survey Marker at once. The
// note typed on one screen is never replaced while it is being typed, both
// notes are kept, and a changed answer says it changed on another screen.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

const FIXTURE = 'debug/fixtures/clickable-link-test.pdf';

async function seed(admin) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const editorId = data.users.find((u) => u.email === E2E_ACCOUNTS.editor.email).id;
  const docId = randomUUID();
  const templateId = randomUUID();
  const stamp = Date.now();
  const templateName = `E2E Two People ${stamp}`;
  const docName = `E2E Two People ${stamp}.pdf`;
  const bytes = fs.readFileSync(path.resolve(FIXTURE));
  const filePath = `${ownerId}/${docId}.pdf`;
  const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true });
  if (up.error) throw up.error;
  const template = await admin.from('templates').insert({
    id: templateId, user_id: ownerId, name: templateName, description: 'two-people-one-marker.spec',
    config: { modules: [{ id: 'm-int', name: 'Interior', categories: [{ id: 'c-cam', name: 'Camera', checklist: [{ id: 'cl-cable', text: 'Cable run' }] }] }], entities: [] },
  });
  if (template.error) throw template.error;
  const doc = await admin.from('documents').insert({
    id: docId, user_id: ownerId, project_id: E2E_PROJECT.id, name: docName, file_path: filePath, file_size: bytes.length, page_count: 1,
  });
  if (doc.error) throw doc.error;
  const share = await admin.from('document_collaborators').insert({
    document_id: docId, user_id: editorId, invited_by: ownerId, role: 'editor', email: E2E_ACCOUNTS.editor.email, status: 'active',
  });
  if (share.error) throw share.error;
  const link = await admin.from('document_templates').insert({ document_id: docId, template_id: templateId, linked_by: ownerId });
  if (link.error) throw link.error;
  return { docId, docName, filePath, templateId, templateName };
}

function addMarker(page, documentId) {
  return page.evaluate(async (docId) => {
    const sync = await import('/src/services/annotationDocSync.js');
    const { supabase } = await import('/src/supabaseClient.js');
    const { data } = await supabase.auth.getUser();
    const handle = await sync.openAnnotationDoc({ documentId: docId, supabase, actorUserId: data.user.id, enableLocal: false, enableRealtime: false });
    handle.applySurveyMarkers({
      cam1: { id: 'cam1', pageNumber: 1, name: 'Camera 1', bounds: { x: 100, y: 120, width: 40, height: 40 }, moduleId: 'm-int', regionId: null, categoryId: 'c-cam', checklistResponses: {}, color: null },
    });
    await handle.drain();
    handle.destroy();
  }, documentId);
}

function stored(page, documentId) {
  return page.evaluate(async (docId) => {
    const sync = await import('/src/services/annotationDocSync.js');
    const { supabase } = await import('/src/supabaseClient.js');
    const { data } = await supabase.auth.getUser();
    const handle = await sync.openAnnotationDoc({ documentId: docId, supabase, actorUserId: data.user.id, enableLocal: false, enableRealtime: false });
    const marker = handle.getSurveyMarkers().cam1;
    handle.destroy();
    return marker;
  }, documentId);
}

async function openMarker(page, seeded) {
  await page.getByText(seeded.docName, { exact: true }).filter({ visible: true }).first().click();
  const openFile = page.getByRole('button', { name: 'Open file' });
  if (await openFile.isVisible().catch(() => false)) await openFile.click();
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] canvas').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: /^Up to date/ }).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByText(seeded.templateName, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Show Survey Markers in Camera' }).click();
  const row = page.locator('.survey-rail__marker-line').filter({ has: page.locator('input[value="Camera 1"]') });
  await row.getByRole('button', { name: 'Expand marker details' }).click();
  await expect(page.getByLabel('Survey Marker notes')).toBeVisible({ timeout: 15_000 });
}

const answers = (page) => page.getByRole('group', { name: 'Cable run' });

test('two people answer one Survey Marker at once: both notes kept, the changed answer is named', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const seeded = await seed(admin);
  const owner = await browser.newContext();
  const guest = await browser.newContext();
  const a = await owner.newPage();
  const b = await guest.newPage();
  try {
    await signIn(a, E2E_ACCOUNTS.owner);
    await addMarker(a, seeded.docId);
    await signIn(b, E2E_ACCOUNTS.editor);
    await openMarker(a, seeded);
    await openMarker(b, seeded);

    // Owner answers N and starts typing; the guest answers Y and leaves a note.
    await answers(a).getByRole('button', { name: 'N', exact: true }).click();
    const ownerNote = a.getByLabel('Survey Marker notes');
    await ownerNote.click();
    await ownerNote.pressSequentially('Owner: lens dirty');
    await expect(answers(b).getByRole('button', { name: 'N', exact: true })).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
    await answers(b).getByRole('button', { name: 'Y', exact: true }).click();
    const guestNote = b.getByLabel('Survey Marker notes');
    await guestNote.click();
    await guestNote.fill('Guest: bracket loose');
    await guestNote.blur();

    // The guest's change reaches the owner, but never his box while he types.
    await expect(answers(a).getByRole('button', { name: 'Y', exact: true })).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
    await expect(a.getByText(/Cable run.*changed on another screen|changed Cable run/).filter({ visible: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(ownerNote).toHaveValue('Owner: lens dirty');
    await ownerNote.blur();

    // Both notes are kept, on both screens and in the store. Which comes
    // first depends on whose save the server took first.
    const both = /^(Guest: bracket loose\nOwner: lens dirty|Owner: lens dirty\nGuest: bracket loose)$/;
    await expect(ownerNote).toHaveValue(both, { timeout: 15_000 });
    await expect(guestNote).toHaveValue(both, { timeout: 15_000 });
    await expect.poll(async () => {
      const m = await stored(a, seeded.docId);
      return typeof m?.note === 'string' ? m.note : m?.note?.text;
    }, { timeout: 15_000 }).toMatch(both);
  } finally {
    await owner.close();
    await guest.close();
    await admin.from('document_templates').delete().eq('document_id', seeded.docId);
    await admin.from('document_collaborators').delete().eq('document_id', seeded.docId);
    await admin.from('documents').delete().eq('id', seeded.docId);
    await admin.from('templates').delete().eq('id', seeded.templateId);
    await admin.storage.from('documents').remove([seeded.filePath]);
  }
});

test('two people save one note at the same instant: both words kept', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const seeded = await seed(admin);
  const owner = await browser.newContext();
  const guest = await browser.newContext();
  const a = await owner.newPage();
  const b = await guest.newPage();
  try {
    await signIn(a, E2E_ACCOUNTS.owner);
    await addMarker(a, seeded.docId);
    await signIn(b, E2E_ACCOUNTS.editor);
    await openMarker(a, seeded);
    await openMarker(b, seeded);
    const ownerNote = a.getByLabel('Survey Marker notes');
    const guestNote = b.getByLabel('Survey Marker notes');
    await ownerNote.fill('Owner: lens dirty');
    await guestNote.fill('Guest: bracket loose');
    await Promise.all([ownerNote.blur(), guestNote.blur()]);
    const both = /^(Guest: bracket loose\nOwner: lens dirty|Owner: lens dirty\nGuest: bracket loose)$/;
    await expect(ownerNote).toHaveValue(both, { timeout: 15_000 });
    await expect(guestNote).toHaveValue(both, { timeout: 15_000 });
    await expect.poll(async () => {
      const m = await stored(a, seeded.docId);
      return typeof m?.note === 'string' ? m.note : m?.note?.text;
    }, { timeout: 15_000 }).toMatch(both);
  } finally {
    await owner.close();
    await guest.close();
    await admin.from('document_templates').delete().eq('document_id', seeded.docId);
    await admin.from('document_collaborators').delete().eq('document_id', seeded.docId);
    await admin.from('documents').delete().eq('id', seeded.docId);
    await admin.from('templates').delete().eq('id', seeded.templateId);
    await admin.storage.from('documents').remove([seeded.filePath]);
  }
});

// Round 5 #14: the owner's Undo then Redo of their own mark keeps what a
// teammate did to it in between.
test('Undo then Redo of my mark keeps a teammate\'s later resize', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const seeded = await seed(admin);
  const owner = await browser.newContext();
  const guest = await browser.newContext();
  const a = await owner.newPage();
  const b = await guest.newPage();
  const PAGE = '.survey-pdfjs-page-div[data-page-number="1"]';
  const MARK = '[data-overlay-page="1"] [data-annotation-id]';
  try {
    await signIn(a, E2E_ACCOUNTS.owner);
    await signIn(b, E2E_ACCOUNTS.editor);
    await a.getByText(seeded.docName, { exact: true }).filter({ visible: true }).first().click();
    const openFile = a.getByRole('button', { name: 'Open file' });
    if (await openFile.isVisible().catch(() => false)) await openFile.click();
    await expect(a.locator(`${PAGE} canvas`).first()).toBeVisible({ timeout: 60_000 });
    await expect(a.getByRole('button', { name: /^Up to date/ }).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });

    const ids = () => a.locator(MARK).evaluateAll((els) => [...new Set(els.map((el) => el.getAttribute('data-annotation-id')))]);
    await a.waitForTimeout(1500);
    const before = await ids();
    const box = await a.locator(PAGE).boundingBox();
    await a.keyboard.press('r');
    await a.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await a.mouse.down();
    await a.mouse.move(box.x + box.width * 0.3 + 60, box.y + box.height * 0.3 + 40, { steps: 6 });
    await a.mouse.up();
    await a.keyboard.press('Escape');
    await expect.poll(async () => (await ids()).length, { timeout: 10_000 }).toBe(before.length + 1);
    const newId = (await ids()).find((id) => !before.includes(id));
    const mine = a.locator(`[data-overlay-page="1"] [data-annotation-id="${newId}"]`);
    await expect(a.getByRole('button', { name: /^Up to date/ }).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    const drawnWidth = (await mine.first().boundingBox()).width;

    // The teammate makes it three times as wide.
    const guestWidth = await b.evaluate(async ({ docId, id }) => {
      const sync = await import('/src/services/annotationDocSync.js');
      const { supabase } = await import('/src/supabaseClient.js');
      const { data } = await supabase.auth.getUser();
      const handle = await sync.openAnnotationDoc({ documentId: docId, supabase, actorUserId: data.user.id, enableLocal: false, enableRealtime: false });
      const byPage = handle.getByPage();
      const isMine = (o) => (o?.data?.id || o?.id) === id;
      const objects = byPage['1'].objects.map((o) => (isMine(o) ? { ...o, width: o.width * 3 } : o));
      handle.applyByPage({ ...byPage, 1: { ...byPage['1'], objects } });
      await handle.drain();
      const w = handle.getByPage()['1'].objects.find(isMine)?.width;
      handle.destroy();
      return w;
    }, { docId: seeded.docId, id: newId });
    await expect.poll(async () => (await mine.first().boundingBox())?.width || 0, { timeout: 20_000 })
      .toBeGreaterThan(drawnWidth * 2);

    // Owner: Undo (gone), then Redo (back, as the teammate left it).
    await a.locator(PAGE).click({ position: { x: 5, y: 5 } });
    await a.keyboard.press('Control+z');
    await expect(mine).toHaveCount(0, { timeout: 10_000 });
    await a.keyboard.press('Control+Shift+z');
    await expect(mine.first()).toBeVisible({ timeout: 10_000 });
    expect((await mine.first().boundingBox()).width).toBeGreaterThan(drawnWidth * 2);
    await expect(a.getByRole('button', { name: /^Up to date/ }).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    const storedWidth = await b.evaluate(async ({ docId, id }) => {
      const sync = await import('/src/services/annotationDocSync.js');
      const { supabase } = await import('/src/supabaseClient.js');
      const { data } = await supabase.auth.getUser();
      const handle = await sync.openAnnotationDoc({ documentId: docId, supabase, actorUserId: data.user.id, enableLocal: false, enableRealtime: false });
      const w = handle.getByPage()['1']?.objects?.find((o) => (o?.data?.id || o?.id) === id)?.width;
      handle.destroy();
      return w;
    }, { docId: seeded.docId, id: newId });
    expect(guestWidth).toBeTruthy();
    expect(storedWidth).toBe(guestWidth);
  } finally {
    await owner.close();
    await guest.close();
    await admin.from('document_templates').delete().eq('document_id', seeded.docId);
    await admin.from('document_collaborators').delete().eq('document_id', seeded.docId);
    await admin.from('documents').delete().eq('id', seeded.docId);
    await admin.from('templates').delete().eq('id', seeded.templateId);
    await admin.storage.from('documents').remove([seeded.filePath]);
  }
});
