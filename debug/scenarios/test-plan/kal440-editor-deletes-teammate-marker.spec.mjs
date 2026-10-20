// KAL-440 end to end with TWO ACCOUNTS on the in-memory backend: owner A
// places a Survey Marker; editor B deletes it. The live document drops it for
// both (that store lets any editor delete), but the saved-mark table
// document_annotations still only lets the mark's author or the document
// owner delete the row. Before the fix B's app logged that refused delete as a
// success; now B is told once, and the row is visibly kept. With the proposed
// database rule (annotationWritePolicy 'role') the row really goes and B sees
// no message. No network, no database.
// 2026-10-13: production already runs the open-editing rule ('role', w54 on
// 2026-09-28), so only that case is run. The 'author' case relied on the
// held-back "save only your own markers" change (0f1cc79d); under the old
// rule B's marker sync is refused first and the delete never reaches it.
// Run (.env needs VITE_SUPABASE_URL/KEY so the client exists):
//   PW_CHROMIUM_PATH=/opt/pw-browsers/chromium PLAYWRIGHT_BASE_URL=http://127.0.0.1:5491 \
//     npx playwright test --config debug/playwright.config.mjs debug/scenarios/test-plan/kal440-editor-deletes-teammate-marker.spec.mjs
import { test, expect } from '@playwright/test';
import { OUT_DIR } from './tp-local-doc.mjs';
import { FakeBackend } from './tp-fake-backend.mjs';
import { openWindow, waitFor } from './tp-actions.mjs';
import { TEMPLATES, enterSurvey, firstVisible, placeMarker, surveyMarkers, tool as pressTool } from './lib.mjs';

test.use({
  video: 'off',
  ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
});
test.describe.configure({ timeout: 400_000 });

const PDF = 'Package 2 - Rev 4 -- IC.pdf';
const WIN = { device: { viewport: { width: 1440, height: 900 } }, cloudLibrary: true };
const B_USER = {
  id: 'dev-test-user-b',
  email: 'bo.reed@example.invalid',
  user_metadata: { first_name: 'Bo', last_name: 'Reed', full_name: 'Bo Reed' },
};
const REFUSED_NOTE = /server kept a saved copy/;

for (const policy of ['role']) {
  test(`KAL-440 editor deletes the owner's Survey Marker (database rule: ${policy === 'author' ? 'current' : 'proposed'})`, async ({ browser }) => {
    const docId = policy === 'author' ? '7e57d0c0-0000-4000-8000-000000000440' : '7e57d0c0-0000-4000-8000-000000000441';
    const backend = new FakeBackend({ documentId: docId, annotationWritePolicy: policy });
    backend.seedTemplate({ config: TEMPLATES[0] });
    backend.seedDocumentCollaborator({ userId: B_USER.id, role: 'editor', email: B_USER.email });

    const A = await openWindow(browser, backend, docId, PDF, WIN);
    await enterSurvey(A.page);
    await placeMarker(A.page, 200, 640, 240, 680);
    const marker = await waitFor(async () => (await surveyMarkers(A.page))[0] || null, { timeout: 15_000 });
    // The saved-mark row A's app keeps for the marker (its Survey Marker
    // sync); seeded here if that background sync has not run yet.
    let legacyRow = await waitFor(() => backend.table('document_annotations').find((r) => r.annotation_id === marker?.id) || null, { timeout: 8_000 });
    const syncedByApp = Boolean(legacyRow);
    if (!legacyRow) {
      legacyRow = { id: `${marker.id}-row`, document_id: docId, annotation_id: marker.id, user_id: 'dev-test-user', annotation_type: 'survey-marker' };
      backend.table('document_annotations').push(legacyRow);
    }

    const B = await openWindow(browser, backend, docId, PDF, { ...WIN, user: B_USER });
    await B.page.evaluate(() => {
      window.__kalToasts = [];
      window.addEventListener('app-toast', (e) => window.__kalToasts.push(e.detail?.message || ''));
    });
    const open = (await firstVisible(B.page.getByRole('button', { name: 'Open survey' })))
      || (await firstVisible(B.page.locator('button[aria-label*="urvey" i]')));
    await open.click();
    await B.page.waitForTimeout(1000);
    const tplButton = await firstVisible(B.page.getByRole('button', { name: /Test Plan Template/ }));
    if (tplButton) { await tplButton.click(); await B.page.waitForTimeout(1200); }
    const bMarker = await waitFor(async () => (await surveyMarkers(B.page)).find((m) => m.id === marker.id) || null, { timeout: 15_000 });

    // B selects A's marker and deletes it.
    await pressTool(B.page, 'select');
    await B.page.mouse.click(bMarker.x, bMarker.y);
    await B.page.waitForTimeout(600);
    await B.page.keyboard.press('Delete');
    const goneInB = await waitFor(async () => ((await surveyMarkers(B.page)).some((m) => m.id === marker.id) ? null : true), { timeout: 10_000 });
    const goneInA = await waitFor(async () => ((await surveyMarkers(A.page)).some((m) => m.id === marker.id) ? null : true), { timeout: 15_000 });
    // Give the saved-mark delete time to run, then read what happened.
    await B.page.waitForTimeout(4000);
    const rowKept = backend.table('document_annotations').some((r) => r.annotation_id === marker.id);
    const notes = await B.page.evaluate(() => window.__kalToasts || []);
    const refusedNote = notes.find((m) => REFUSED_NOTE.test(m)) ?? null;
    await B.page.screenshot({ path: `${OUT_DIR}/kal440-${policy}-B-after-delete.png` });

    console.log(`[KAL-440 ${policy}]`, JSON.stringify({
      markerId: marker.id, syncedByApp, goneInB: Boolean(goneInB), goneInA: Boolean(goneInA), rowKept, notes,
      deleteCalls: backend.counts.get('DELETE document_annotations') || 0,
      errors: [...A.errors, ...B.errors].slice(0, 5),
    }, null, 1));
    await A.context.close();
    await B.context.close();

    expect(goneInB).toBeTruthy();
    expect(goneInA).toBeTruthy();
    if (policy === 'author') {
      expect(rowKept).toBe(true);          // the database refused...
      expect(refusedNote).toBeTruthy();    // ...and B is told, not "success"
    } else {
      expect(rowKept).toBe(false);         // the proposed rule lets the row go
      expect(refusedNote).toBeNull();
    }
  });
}
