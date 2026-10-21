// Two signed-in screens (owner and editor) edit different fields of one Survey
// Marker at the same moment. With survey-marker-fields on, both edits survive;
// off, the marker is one whole value and one edit is lost (today's behaviour).
//
// Each screen drives the app's own annotation-doc module (served by Vite) with
// realtime off, so neither sees the other's edit before writing: the two
// writes are truly concurrent and meet only in the server's update log. A
// third, fresh handle then reads what was stored.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS, E2E_DOCUMENT, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

const BASE = { id: 'm1', name: 'Door', notes: '', categoryId: 'c1', bounds: { x: 10, y: 20, width: 30, height: 40 } };

async function userId(admin, email) {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) throw error;
  return data.users.find((u) => u.email === email).id;
}

async function seedSharedDoc(admin) {
  const ownerId = await userId(admin, E2E_ACCOUNTS.owner.email);
  const editorId = await userId(admin, E2E_ACCOUNTS.editor.email);
  const id = randomUUID();
  const bytes = fs.readFileSync(path.resolve(E2E_DOCUMENT.fixture));
  const filePath = `${ownerId}/${id}.pdf`;
  const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), {
    contentType: 'application/pdf', upsert: true,
  });
  if (up.error) throw up.error;
  const doc = await admin.from('documents').insert({
    id, user_id: ownerId, project_id: E2E_PROJECT.id, name: `E2E Marker Fields ${Date.now()}.pdf`,
    file_path: filePath, file_size: bytes.length, page_count: 1,
  });
  if (doc.error) throw doc.error;
  const collab = await admin.from('document_collaborators').insert({
    document_id: id, user_id: editorId, invited_by: ownerId, role: 'editor',
    email: E2E_ACCOUNTS.editor.email, status: 'active',
  });
  if (collab.error) throw collab.error;
  return { id, filePath };
}

async function screen(browser, account, flagOn) {
  const context = await browser.newContext();
  await context.route(
    (url) => !['data:', 'blob:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname),
    (route) => route.abort('blockedbyclient'),
  );
  const page = await context.newPage();
  await page.addInitScript((value) => {
    try { window.localStorage.setItem('survey.flag.survey-marker-fields', value); } catch { /* ignore */ }
  }, flagOn ? '1' : '0');
  await signIn(page, account);
  return { context, page };
}

// Open a handle in the page (realtime off) and keep it on window.
function openHandle(page, documentId) {
  return page.evaluate(async (docId) => {
    const sync = await import('/src/services/annotationDocSync.js');
    const { supabase } = await import('/src/supabaseClient.js');
    const { data } = await supabase.auth.getUser();
    window.__e2eHandle = await sync.openAnnotationDoc({
      documentId: docId, supabase, actorUserId: data.user.id,
      enableLocal: false, enableRealtime: false,
    });
    return true;
  }, documentId);
}

const apply = (page, markers) => page.evaluate(async (m) => {
  window.__e2eHandle.applySurveyMarkers(m);
  await window.__e2eHandle.drain();
}, markers);

const readFresh = (page, documentId) => page.evaluate(async (docId) => {
  const sync = await import('/src/services/annotationDocSync.js');
  const { supabase } = await import('/src/supabaseClient.js');
  const { data } = await supabase.auth.getUser();
  const handle = await sync.openAnnotationDoc({
    documentId: docId, supabase, actorUserId: data.user.id, enableLocal: false, enableRealtime: false,
  });
  const markers = handle.getSurveyMarkers();
  handle.destroy();
  return markers;
}, documentId);

for (const flagOn of [true, false]) {
  const label = flagOn ? 'flag on' : 'flag off';

  test(`two screens edit different fields of one Survey Marker at once (${label})`, async ({ browser }) => {
    const admin = adminClient();
    const seeded = await seedSharedDoc(admin);
    const a = await screen(browser, E2E_ACCOUNTS.owner, flagOn);
    const b = await screen(browser, E2E_ACCOUNTS.editor, flagOn);
    try {
      await openHandle(a.page, seeded.id);
      await apply(a.page, { m1: BASE });
      await openHandle(b.page, seeded.id);
      expect((await b.page.evaluate(() => window.__e2eHandle.getSurveyMarkers())).m1).toEqual(BASE);

      // Neither handle can see the other's edit: realtime is off.
      await Promise.all([
        apply(a.page, { m1: { ...BASE, name: 'Fire door' } }),
        apply(b.page, { m1: { ...BASE, notes: 'check the closer' } }),
      ]);

      const stored = (await readFresh(a.page, seeded.id)).m1;
      console.log(`[survey-marker-fields ${label}] stored`, JSON.stringify(stored));
      expect(stored.bounds).toEqual(BASE.bounds);
      const kept = [stored.name === 'Fire door', stored.notes === 'check the closer'];
      if (flagOn) {
        expect(kept).toEqual([true, true]);
      } else {
        // Today: the marker is one value; the later write replaces the other.
        expect(kept.filter(Boolean)).toHaveLength(1);
      }
    } finally {
      for (const s of [a, b]) {
        await s.page.evaluate(() => window.__e2eHandle?.destroy()).catch(() => {});
        await s.context.close();
      }
      await admin.from('documents').delete().eq('id', seeded.id);
      await admin.storage.from('documents').remove([seeded.filePath]);
    }
  });
}
