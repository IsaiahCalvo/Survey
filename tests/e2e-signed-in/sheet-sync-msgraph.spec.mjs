// Live Excel sync through a work/school Microsoft 365 (supabase/functions/
// sheet-sync with providers/msgraph.js), end to end: the real function and
// database, with the fake Microsoft (scripts/e2e-fake-msgraph.mjs) standing in
// for Microsoft. A PM edits the workbook while the team edits the survey from
// any device; both sides end up the same, and nobody on the team but the PM
// ever signs in to Microsoft.
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
// The standard export kit (src/*.js does not load under Playwright).
const defaultKit = {
  id: 'default-survey', kind: 'exportKit', version: '1.0.0', minEngine: 1, label: 'Survey (standard)', extends: null,
  columns: [
    { field: 'row_id', header: 'Row ID' }, { field: 'changed_by', header: 'Changed By' }, { field: 'changed_date', header: 'Changed Date' },
    { field: 'name', header: 'Item' }, { field: 'checklist' }, { field: 'entity_name', header: 'Entity' }, { field: 'notes', header: 'Notes' },
  ],
};
const LAYOUT = { template: TEMPLATE, kit: defaultKit, answerValues: ['Y', 'N', 'N/A'] };
const MS = { provider: 'msgraph' };

const call = async (token, action, body = {}) => {
  const res = await fetch(functionUrl('sheet-sync'), {
    method: 'POST',
    headers: { apikey: process.env.E2E_SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  });
  return { status: res.status, body: await res.json() };
};
// "Sync now": pressed right after another round, the server asks to wait a
// moment (it spaces rounds out to spare the linker's quota).
async function syncNow(token, body) {
  for (let i = 0; ; i += 1) {
    const res = await call(token, 'sync', { ...body, force: true });
    if (res.body?.round?.status !== 'recent' || i >= 5) return res;
    await new Promise((r) => setTimeout(r, (res.body.round.retryInMs || 1000) + 100));
  }
}
const fake = async (path, body) => {
  const res = await fetch(`${functionUrl('e2e-fake-msgraph')}/__fake${path}`, body
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
  return res.json();
};

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

// Microsoft's consent page says yes at once (the fake), then sends the browser
// to sheet-sync's Microsoft callback, which sends it on to the app's page.
async function connectMicrosoft(token) {
  const started = await call(token, 'connect', { appOrigin: E2E_BASE_URL, ...MS });
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  expect(new URL(started.body.url).searchParams.get('scope')).toBe('offline_access User.Read Files.ReadWrite.All');
  const consent = await fetch(started.body.url, { redirect: 'manual' });
  expect(consent.status).toBe(302);
  expect(new URL(consent.headers.get('location')).pathname).toMatch(/\/sheet-sync\/oauth\/msgraph\/callback$/);
  const callback = await fetch(consent.headers.get('location'), { redirect: 'manual' });
  expect(callback.status).toBe(302);
  expect(callback.headers.get('location')).toBe(`${E2E_BASE_URL}/google-connected.html?provider=msgraph&result=connected`);
}

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
  await fake('/reset', {});
  savedFlag = (await must('read flag', admin.from('feature_flags').select('*').eq('key', FLAG))).at(0) || null;
  await must('flag on for the owner', admin.from('feature_flags').upsert({
    key: FLAG, mode: 'testers', tester_emails: [E2E_ACCOUNTS.owner.email], description: 'sheet-sync-msgraph.spec.mjs',
  }, { onConflict: 'key' }));
});
test.afterAll(async () => {
  const admin = adminClient();
  if (savedFlag) await admin.from('feature_flags').upsert(savedFlag, { onConflict: 'key' });
  else await admin.from('feature_flags').update({ mode: 'off', tester_emails: [] }).eq('key', FLAG);
  await admin.from('sheet_sync_connections').delete().eq('user_id', await userId(E2E_ACCOUNTS.owner));
});

test('two-way live sync between a survey and an Excel workbook on Microsoft 365', async () => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const ownerId = await userId(E2E_ACCOUNTS.owner);
  const doc = await addDocument(admin, { id: ownerId }, { projectId: E2E_PROJECT.id, name: `Excel sync ${RUN}.pdf` });
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const [ownerToken, editorToken, viewerToken] = await Promise.all(
    ['owner', 'editor', 'viewer'].map((key) => signInToken(E2E_ACCOUNTS[key])),
  );
  const ids = { documentId: doc.id, templateId: `e2e-excel-${RUN}` };
  try {
    await writeMarkers(owner, doc.id, {
      d1: { id: 'd1', name: '00101', moduleId: 'm1', categoryId: 'doors', pageNumber: 1, bounds: { x: 10, y: 10, width: 20, height: 20 }, checklistResponses: {} },
    });

    const first = await call(ownerToken, 'status', ids);
    expect(first.body).toMatchObject({ providers: { msgraph: { configured: true } }, microsoft: { connected: false }, role: 'owner', link: null });
    expect((await call(editorToken, 'connect', { appOrigin: E2E_BASE_URL, ...MS })).status).toBe(403);

    await connectMicrosoft(ownerToken);
    expect((await call(ownerToken, 'status', ids)).body.microsoft).toEqual({ connected: true, email: 'pm@contoso.example' });
    const stored = await must('connection row', admin.from('sheet_sync_connections').select('refresh_token_enc, provider').eq('user_id', ownerId).eq('provider', 'msgraph').single());
    expect(stored.refresh_token_enc).toMatch(/^v1\./);
    expect(stored.refresh_token_enc).not.toContain('fake-ms-refresh');

    // A viewer cannot make the workbook; the owner can.
    expect((await call(viewerToken, 'link', { ...ids, ...LAYOUT, ...MS, title: 'Excel sync' })).status).toBe(403);
    const linked = await call(ownerToken, 'link', { ...ids, ...LAYOUT, ...MS, title: 'Excel sync' });
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    expect(linked.body.link.provider).toBe('msgraph');
    expect(linked.body.round.status).toBe('synced');
    // One sheet per survey: Google can't link a second one.
    expect((await call(ownerToken, 'link', { ...ids, ...LAYOUT, provider: 'google', title: 'Again' })).status).toBe(409);

    const { files } = await fake('/files');
    const itemId = files.at(-1);
    const sheet = async () => (await fake(`/files/${itemId}`)).sheets.find((s) => s.name === TAB);
    let grid = await sheet();
    const col = (header) => grid.rows[0].indexOf(header);
    const rowOf = (name) => grid.rows.findIndex((r, i) => i > 0 && r[col('Item')] === name);
    expect(grid.rows[0]).toEqual(['Row ID', 'Changed By', 'Changed Date', 'Item', 'Locked?', 'Entity', 'Notes']);
    expect(rowOf('00101'), 'leading zeros kept as text').toBe(1);
    expect(grid.hidden).toEqual(['A:A']);

    // The PM types in Excel: a note and a new row. An editor with no Microsoft
    // account runs the round (any open device does, phones included).
    await fake(`/files/${itemId}/edit`, { title: TAB, edits: [
      { row: 1, col: col('Notes'), value: 'Hinge loose' },
      { row: 2, col: col('Item'), value: 'D-102' },
      { row: 2, col: col('Locked?'), value: 'N' },
    ] });
    const fromSheet = await syncNow(editorToken, { ...ids, ...LAYOUT });
    expect(fromSheet.status, JSON.stringify(fromSheet.body)).toBe(200);
    expect(fromSheet.body.round.status).toBe('synced');
    let markers = await markersOf(owner, doc.id);
    expect(markers.d1.note?.text).toBe('Hinge loose');
    expect(Object.values(markers).find((m) => m.name === 'D-102')).toMatchObject({ categoryId: 'doors', checklistResponses: { c1: { selection: 'N' } } });

    // A field tech answers in the app; the workbook follows.
    await writeMarkers(owner, doc.id, { d1: { ...markers.d1, checklistResponses: { c1: { selection: 'Y' } } } });
    expect((await syncNow(ownerToken, { ...ids, ...LAYOUT })).body.round.status).toBe('synced');
    grid = await sheet();
    expect(grid.rows[rowOf('00101')][col('Locked?')]).toBe('Y');

    // Same cell changed in both places: nothing is overwritten until someone picks.
    markers = await markersOf(owner, doc.id);
    await writeMarkers(owner, doc.id, { d1: { ...markers.d1, checklistResponses: { c1: { selection: 'N' } } } });
    await fake(`/files/${itemId}/edit`, { title: TAB, edits: [{ row: rowOf('00101'), col: col('Locked?'), value: 'N/A' }] });
    const clash = await syncNow(editorToken, { ...ids, ...LAYOUT });
    expect(clash.body.link.conflicts).toEqual([expect.objectContaining({ markerId: 'd1', fields: [expect.objectContaining({ app: 'N', sheet: 'N/A' })] })]);
    const picked = await call(editorToken, 'choose', { ...ids, markerId: 'd1', choice: 'app' });
    expect(picked.body.link.conflicts).toEqual([]);
    expect((await sheet()).rows[rowOf('00101')][col('Locked?')]).toBe('N');

    // Microsoft rotated the refresh token on use; the newest one is stored.
    const after = await must('connection row', admin.from('sheet_sync_connections').select('refresh_token_enc').eq('user_id', ownerId).eq('provider', 'msgraph').single());
    expect(after.refresh_token_enc).not.toBe(stored.refresh_token_enc);

    // Disconnecting Microsoft stops the link instead of failing quietly.
    expect((await call(ownerToken, 'disconnect', MS)).body).toEqual({ ok: true });
    const stopped = await call(editorToken, 'status', ids);
    expect(stopped.body.link).toMatchObject({ provider: 'msgraph', status: 'broken' });
    expect((await call(ownerToken, 'unlink', ids)).body.link).toBeNull();
  } finally {
    await admin.from('sheet_sync_links').delete().eq('document_id', doc.id);
    await admin.from('documents').delete().eq('id', doc.id);
  }
});

test('the Survey panel makes a live Excel workbook', async ({ page }) => {
  test.setTimeout(150_000);
  if (process.env.E2E_FUNCTIONS_URL) {
    await page.route('**/functions/v1/sheet-sync', (route) => route.fallback({ url: functionUrl('sheet-sync') }));
  }
  const ownerToken = await signInToken(E2E_ACCOUNTS.owner);
  await connectMicrosoft(ownerToken);
  try {
    await page.addInitScript(() => window.localStorage.setItem('survey.flag.sheet-team-sync', '1'));
    await signIn(page, E2E_ACCOUNTS.owner);
    await openSurvey(page);

    const button = page.locator('[data-sheet-sync-state]').filter({ visible: true }).first();
    await expect(button).toBeVisible({ timeout: 60_000 });
    await expect(button).toHaveAttribute('data-sheet-sync-state', 'connected');
    await button.click();
    const panel = page.getByRole('dialog', { name: 'Live sheet sync' });
    await expect(panel.getByText('Signed in as pm@contoso.example')).toBeVisible();
    await panel.getByRole('button', { name: 'Make a live Excel workbook' }).click();
    await expect(panel.getByRole('link', { name: 'Open workbook' })).toBeVisible({ timeout: 30_000 });
    await expect(button).toHaveAttribute('data-sheet-sync-state', 'active');
    await expect(button).toContainText('Live in Excel');

    const { files } = await fake('/files');
    const file = await fake(`/files/${files.at(-1)}`);
    const tab = file.sheets.find((s) => s.name === `${E2E_SURVEY.categoryName} - ${E2E_SURVEY.moduleName}`);
    expect(tab.rows[0]).toEqual(['Row ID', 'Changed By', 'Changed Date', 'Item', ...E2E_SURVEY.checklist.map((c) => c.text), 'Entity', 'Notes']);
    expect(tab.rows.some((r) => r[3] === E2E_SURVEY.itemName)).toBe(true);
    await panel.getByRole('button', { name: 'Sync now' }).click();
    await expect(panel.getByRole('button', { name: 'Sync now' })).toBeEnabled({ timeout: 30_000 });
    await expect(panel.getByRole('alert')).toHaveCount(0);
  } finally {
    await adminClient().from('sheet_sync_links').delete().eq('document_id', E2E_SURVEY.documentId);
    await adminClient().from('sheet_sync_connections').delete().eq('user_id', await userId(E2E_ACCOUNTS.owner)).eq('provider', 'msgraph');
  }
});
