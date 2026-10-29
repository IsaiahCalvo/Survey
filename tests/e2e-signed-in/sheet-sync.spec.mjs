// Live Google Sheets sync (supabase/functions/sheet-sync), end to end: the real
// function and database, with the fake Google (scripts/e2e-fake-google.mjs)
// standing in for Google. A PM edits the sheet while the team edits the survey;
// both sides end up the same, and a cell changed in both places waits for a
// person to pick.
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { RUN, addDocument, must, signInToken } from './accountFixtures.mjs';
import { E2E_ACCOUNTS, E2E_BASE_URL, E2E_PROJECT, E2E_SURVEY } from './accounts.mjs';
import { adminClient, apiClientFor, expect, functionUrl, signIn, test } from './helpers.mjs';
import { docToSurveyMarkers, syncSurveyMarkersToDoc } from '../../supabase/functions/_shared/surveyMarkerDocSync.js';
import { bytesToPgHex, pgHexToBytes } from '../../supabase/functions/_shared/pgBytea.js';

const FLAG = 'sheet-team-sync';
const TAB = 'Doors - Level 1';
const TEMPLATE = {
  modules: [{ id: 'm1', name: 'Level 1', categories: [{ id: 'doors', name: 'Doors', checklist: [{ id: 'c1', text: 'Locked?' }] }] }],
  entities: [{ id: 'e1', name: 'Installed', color: '#0a0' }],
};
// The standard export kit (src/services/exportFormats/kits/defaultSurvey.js;
// src/*.js does not load under Playwright).
const defaultKit = {
  id: 'default-survey', kind: 'exportKit', version: '1.0.0', minEngine: 1, label: 'Survey (standard)', extends: null,
  columns: [
    { field: 'row_id', header: 'Row ID' }, { field: 'changed_by', header: 'Changed By' }, { field: 'changed_date', header: 'Changed Date' },
    { field: 'name', header: 'Item' }, { field: 'checklist' }, { field: 'entity_name', header: 'Entity' }, { field: 'notes', header: 'Notes' },
  ],
};
const LAYOUT = { template: TEMPLATE, kit: defaultKit, answerValues: ['Y', 'N', 'N/A'] };

const call = async (token, action, body = {}) => {
  const res = await fetch(functionUrl('sheet-sync'), {
    method: 'POST',
    headers: { apikey: process.env.E2E_SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  });
  return { status: res.status, body: await res.json() };
};
const fake = async (path, body) => {
  const res = await fetch(`${functionUrl('e2e-fake-google')}/__fake${path}`, body
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
  return res.json();
};
const fileIdOf = (url) => /\/d\/([^/]+)/.exec(url)[1];

// The survey's markers, read and written through the annotation log the way
// the app does (append_annotation_update, signed in as the person).
async function loadDoc(client, documentId) {
  const doc = new Y.Doc();
  const rows = await must('annotation log', client.from('annotation_updates')
    .select('seq, data').eq('document_id', documentId).order('seq', { ascending: true }));
  for (const row of rows) Y.applyUpdate(doc, pgHexToBytes(row.data));
  return doc;
}
const markersOf = async (client, documentId) => docToSurveyMarkers(await loadDoc(client, documentId));
async function writeMarkers(client, documentId, markers) {
  const doc = await loadDoc(client, documentId);
  const sv = Y.encodeStateVector(doc);
  syncSurveyMarkersToDoc(doc, { ...docToSurveyMarkers(doc), ...markers });
  await must('append update', client.rpc('append_annotation_update', {
    p_document_id: documentId,
    p_client_id: `e2e-${randomUUID()}`,
    p_client_seq: 1,
    p_data: bytesToPgHex(Y.encodeStateAsUpdate(doc, sv)),
  }));
}

async function userId(account) {
  const { data } = await adminClient().auth.admin.listUsers();
  return data.users.find((u) => u.email === account.email).id;
}

// Google's consent page says yes at once (the fake), then sends the browser
// to sheet-sync's callback, which sends it on to the app's "connected" page.
async function connectGoogle(token) {
  const started = await call(token, 'connect', { appOrigin: E2E_BASE_URL });
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  const consent = await fetch(started.body.url, { redirect: 'manual' });
  expect(consent.status).toBe(302);
  const callback = await fetch(consent.headers.get('location'), { redirect: 'manual' });
  expect(callback.status).toBe(302);
  expect(callback.headers.get('location')).toBe(`${E2E_BASE_URL}/google-connected.html?result=connected`);
}

// Open the seeded survey with its template in the Survey panel (as survey-report.spec.mjs).
async function openSurvey(page) {
  await page.getByText(E2E_SURVEY.documentName, { exact: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.getByRole('button', { name: `Close ${E2E_SURVEY.documentName}` })).toBeVisible({ timeout: 60_000 });
  const category = page.getByRole('button', { name: `Show Survey Markers in ${E2E_SURVEY.categoryName}` });
  const chooser = page.getByText('Choose a survey template', { exact: true });
  if (!(await category.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Survey', exact: true }).click();
    await expect(chooser.or(category).first()).toBeVisible({ timeout: 30_000 });
    if (await chooser.isVisible()) {
      await page.getByText(E2E_SURVEY.templateName, { exact: true }).last().click();
      const keep = page.getByRole('button', { name: 'Keep previous version' });
      if (await keep.waitFor({ timeout: 3_000 }).then(() => true, () => false)) await keep.click();
    }
  }
  await expect(category).toBeVisible({ timeout: 30_000 });
}

let savedFlag = null;
test.beforeAll(async () => {
  const admin = adminClient();
  savedFlag = (await must('read flag', admin.from('feature_flags').select('*').eq('key', FLAG))).at(0) || null;
  await must('flag on for the owner', admin.from('feature_flags').upsert({
    key: FLAG, mode: 'testers', tester_emails: [E2E_ACCOUNTS.owner.email], description: 'sheet-sync.spec.mjs',
  }, { onConflict: 'key' }));
});
test.afterAll(async () => {
  const admin = adminClient();
  if (savedFlag) await admin.from('feature_flags').upsert(savedFlag, { onConflict: 'key' });
  else await admin.from('feature_flags').update({ mode: 'off', tester_emails: [] }).eq('key', FLAG);
  await admin.from('sheet_sync_connections').delete().eq('user_id', await userId(E2E_ACCOUNTS.owner));
});

test('two-way live sync between a survey and a Google Sheet', async () => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const ownerId = await userId(E2E_ACCOUNTS.owner);
  const doc = await addDocument(admin, { id: ownerId }, { projectId: E2E_PROJECT.id, name: `Sheet sync ${RUN}.pdf` });
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const [ownerToken, editorToken, viewerToken] = await Promise.all(
    ['owner', 'editor', 'viewer'].map((key) => signInToken(E2E_ACCOUNTS[key])),
  );
  const ids = { documentId: doc.id, templateId: `e2e-sheet-${RUN}` };
  try {
    await writeMarkers(owner, doc.id, {
      d1: { id: 'd1', name: 'D-101', moduleId: 'm1', categoryId: 'doors', pageNumber: 1, bounds: { x: 10, y: 10, width: 20, height: 20 }, checklistResponses: {} },
    });

    // Not connected yet; only beta people may connect.
    const first = await call(ownerToken, 'status', ids);
    expect(first.body).toMatchObject({ configured: true, google: { connected: false }, role: 'owner', link: null });
    expect((await call(editorToken, 'connect', { appOrigin: E2E_BASE_URL })).status).toBe(403);
    expect((await call(editorToken, 'status', ids)).body.role).toBe('editor');

    await connectGoogle(ownerToken);
    expect((await call(ownerToken, 'status', ids)).body.google).toEqual({ connected: true, email: E2E_ACCOUNTS.owner.email });
    // The refresh token is stored encrypted and nobody can read the table.
    const stored = await must('connection row', admin.from('sheet_sync_connections').select('refresh_token_enc').eq('user_id', ownerId).single());
    expect(stored.refresh_token_enc).toMatch(/^v1\./);
    expect(stored.refresh_token_enc).not.toContain('fake-refresh');
    const peek = await owner.from('sheet_sync_connections').select('*');
    expect(peek.data ?? []).toEqual([]);

    // A viewer cannot make the sheet; the owner can.
    expect((await call(viewerToken, 'link', { ...ids, ...LAYOUT, title: 'Sheet sync' })).status).toBe(403);
    const linked = await call(ownerToken, 'link', { ...ids, ...LAYOUT, title: 'Sheet sync' });
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    expect(linked.body.round.status).toBe('synced');
    const fileId = fileIdOf(linked.body.link.fileUrl);
    const sheet = async () => (await fake(`/files/${fileId}`)).sheets.find((s) => s.title === TAB);
    let grid = await sheet();
    const col = (header) => grid.rows[0].indexOf(header);
    const rowOf = (name) => grid.rows.findIndex((r, i) => i > 0 && r[col('Item')] === name);
    expect(grid.rows[0]).toEqual(['Row ID', 'Changed By', 'Changed Date', 'Item', 'Locked?', 'Entity', 'Notes']);
    expect(rowOf('D-101')).toBe(1);
    expect(grid.rows[1][col('Row ID')]).toBeTruthy();
    // Everyone on the survey sees the link, never the tokens.
    const seen = await must('viewer reads link', (await apiClientFor(E2E_ACCOUNTS.viewer)).from('sheet_sync_links').select('file_url, status').eq('document_id', doc.id));
    expect(seen).toEqual([{ file_url: linked.body.link.fileUrl, status: 'active' }]);
    const hidden = await (await apiClientFor(E2E_ACCOUNTS.viewer)).from('sheet_sync_links').select('state').eq('document_id', doc.id);
    expect(hidden.error, 'the sync state is not readable').toBeTruthy();
    const stranger = await (await apiClientFor(E2E_ACCOUNTS.free)).from('sheet_sync_links').select('file_url').eq('document_id', doc.id);
    expect(stranger.data ?? []).toEqual([]);

    // The PM types in the sheet: a note on D-101 and a new row. An editor with
    // no Google account runs the round (any open device does).
    await fake(`/files/${fileId}/edit`, { title: TAB, edits: [
      { row: 1, col: col('Notes'), value: 'Hinge loose' },
      { row: 2, col: col('Item'), value: 'D-102' },
      { row: 2, col: col('Locked?'), value: 'N' },
    ] });
    const fromSheet = await call(editorToken, 'sync', { ...ids, ...LAYOUT, force: true });
    expect(fromSheet.status, JSON.stringify(fromSheet.body)).toBe(200);
    expect(fromSheet.body.round.status).toBe('synced');
    let markers = await markersOf(owner, doc.id);
    expect(markers.d1.note?.text).toBe('Hinge loose');
    const d102 = Object.values(markers).find((m) => m.name === 'D-102');
    expect(d102).toMatchObject({ categoryId: 'doors', moduleId: 'm1', checklistResponses: { c1: { selection: 'N' } } });
    grid = await sheet();
    expect(grid.rows[rowOf('D-102')][col('Row ID')], 'the new row got its Row ID').toBeTruthy();

    // A field tech answers in the app; the sheet follows.
    await writeMarkers(owner, doc.id, { d1: { ...markers.d1, checklistResponses: { c1: { selection: 'Y' } } } });
    expect((await call(ownerToken, 'sync', { ...ids, ...LAYOUT, force: true })).body.round.status).toBe('synced');
    grid = await sheet();
    expect(grid.rows[rowOf('D-101')][col('Locked?')]).toBe('Y');

    // Same cell changed in both places: nothing is overwritten until someone picks.
    markers = await markersOf(owner, doc.id);
    await writeMarkers(owner, doc.id, { d1: { ...markers.d1, checklistResponses: { c1: { selection: 'N' } } } });
    await fake(`/files/${fileId}/edit`, { title: TAB, edits: [{ row: rowOf('D-101'), col: col('Locked?'), value: 'N/A' }] });
    const clash = await call(editorToken, 'sync', { ...ids, ...LAYOUT, force: true });
    expect(clash.body.link.conflicts).toEqual([expect.objectContaining({
      markerId: 'd1', name: 'D-101', fields: [expect.objectContaining({ key: 'answer:c1', app: 'N', sheet: 'N/A' })],
    })]);
    expect((await markersOf(owner, doc.id)).d1.checklistResponses.c1.selection).toBe('N');
    expect((await sheet()).rows[rowOf('D-101')][col('Locked?')]).toBe('N/A');
    expect((await call(viewerToken, 'choose', { ...ids, markerId: 'd1', choice: 'sheet' })).status).toBe(403);
    const picked = await call(editorToken, 'choose', { ...ids, markerId: 'd1', choice: 'sheet' });
    expect(picked.body.link.conflicts).toEqual([]);
    expect((await markersOf(owner, doc.id)).d1.checklistResponses.c1.selection).toBe('N/A');
    expect((await sheet()).rows[rowOf('D-101')][col('Locked?')]).toBe('N/A');

    // Viewers never run rounds.
    expect((await call(viewerToken, 'sync', { ...ids, force: true })).status).toBe(403);

    // Stop syncing: only the owner or the person who linked it.
    expect((await call(editorToken, 'unlink', ids)).status).toBe(403);
    expect((await call(ownerToken, 'unlink', ids)).body.link).toBeNull();
  } finally {
    await admin.from('sheet_sync_links').delete().eq('document_id', doc.id);
    await admin.from('documents').delete().eq('id', doc.id);
  }
});

test('the Survey panel makes a live Google Sheet and keeps it in step', async ({ page }) => {
  test.setTimeout(150_000);
  if (process.env.E2E_FUNCTIONS_URL) {
    await page.route('**/functions/v1/sheet-sync', (route) => route.fallback({ url: functionUrl('sheet-sync') }));
  }
  const ownerToken = await signInToken(E2E_ACCOUNTS.owner);
  await connectGoogle(ownerToken);
  try {
    await page.addInitScript(() => window.localStorage.setItem('survey.flag.sheet-team-sync', '1'));
    await signIn(page, E2E_ACCOUNTS.owner);
    await openSurvey(page);

    const button = page.locator('[data-sheet-sync-state]').filter({ visible: true }).first();
    await expect(button).toBeVisible({ timeout: 60_000 });
    await expect(button).toHaveAttribute('data-sheet-sync-state', 'connected');
    await button.click();
    const panel = page.getByRole('dialog', { name: 'Google Sheets live sync' });
    await expect(panel.getByText(`Signed in as ${E2E_ACCOUNTS.owner.email}`)).toBeVisible();
    await panel.getByRole('button', { name: 'Make a live Google Sheet' }).click();
    await expect(panel.getByRole('link', { name: 'Open sheet' })).toBeVisible({ timeout: 30_000 });
    await expect(button).toHaveAttribute('data-sheet-sync-state', 'active');

    // The sheet has the survey's item, in its category's tab.
    const link = await must('link row', adminClient().from('sheet_sync_links').select('file_url').eq('document_id', E2E_SURVEY.documentId).single());
    const fileId = fileIdOf(link.file_url);
    const file = await fake(`/files/${fileId}`);
    const tab = file.sheets.find((s) => s.title === `${E2E_SURVEY.categoryName} - ${E2E_SURVEY.moduleName}`);
    expect(tab.rows[0]).toEqual(['Row ID', 'Changed By', 'Changed Date', 'Item', ...E2E_SURVEY.checklist.map((c) => c.text), 'Entity', 'Notes']);
    expect(tab.rows.some((r) => r[3] === E2E_SURVEY.itemName)).toBe(true);
    await expect(panel.getByRole('button', { name: 'Sync now' })).toBeEnabled();
    await panel.getByRole('button', { name: 'Sync now' }).click();
    await expect(panel.getByRole('button', { name: 'Sync now' })).toBeEnabled({ timeout: 30_000 });
    await expect(panel.getByRole('alert')).toHaveCount(0);
  } finally {
    await adminClient().from('sheet_sync_links').delete().eq('document_id', E2E_SURVEY.documentId);
  }
});
