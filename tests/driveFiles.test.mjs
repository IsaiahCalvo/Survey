// OneDrive files that save back (Nightly 'drive-sync-back';
// supabase/functions/_shared/driveFiles/service.js): browse, open, link, push
// with If-Match, conflicts, a moved or deleted file, a read-only file, and
// who may do what, against a fake Microsoft Graph and an in-memory database.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createDriveClient, driveAction, DriveError } from '../supabase/functions/_shared/driveFiles/service.js';
import { placeToken, shareIdOf } from '../supabase/functions/_shared/sheetSync/providers/msgraph.js';

const BASE = 'https://graph.test/v1.0';
const DRIVE = 'b!drive1';

function fakeGraph() {
  const g = { items: new Map(), uploads: new Map(), calls: [], next: 1 };
  g.add = (id, { name, bytes = 'pdf-1', readOnly = false, folder = '' } = {}) => {
    g.items.set(id, { name, bytes, version: 1, readOnly, folder });
    return id;
  };
  g.editAtSource = (id, bytes) => { const it = g.items.get(id); it.bytes = bytes; it.version += 1; };
  const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const itemJson = (id, it) => ({
    id, name: it.name, eTag: `"{${id}},${it.version}"`, size: it.bytes.length, webUrl: `https://contoso.example/${it.name}`,
    file: { mimeType: 'application/pdf' }, parentReference: { driveId: DRIVE }, lastModifiedDateTime: '2026-11-10T12:00:00Z',
    lastModifiedBy: { user: { displayName: 'Pat Manager' } },
    '@microsoft.graph.downloadUrl': `https://dl.test/${id}?v=${it.version}`,
  });
  g.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    g.calls.push(`${method} ${url}`);
    if (url.startsWith('https://up.test/')) {
      // The app's PUT to the upload link (no token needed).
      const up = g.uploads.get(url);
      if (!up) return json(404, { error: { code: 'itemNotFound' } });
      const it = g.items.get(up.id);
      it.bytes = String(init.body);
      it.version += 1;
      g.uploads.delete(url);
      return json(200, itemJson(up.id, it));
    }
    if (!/^Bearer tok-/.test(init.headers?.Authorization || '')) return json(401, { error: { code: 'InvalidAuthenticationToken' } });
    const path = decodeURIComponent(url.slice(BASE.length + 1)).replace(/\?.*$/, '');
    if (method === 'GET' && path === 'me/drive/root/children') {
      const value = [
        { name: 'Jobs', folder: { childCount: 1 } },
        { name: 'Library', remoteItem: { id: 'LIB', folder: {}, parentReference: { driveId: 'b!sp' } } },
        { name: 'notes.docx', id: 'DOCX', file: {}, parentReference: { driveId: DRIVE } },
        ...[...g.items].filter(([, it]) => !it.folder).map(([id, it]) => itemJson(id, it)),
      ];
      return json(200, { value });
    }
    const share = /^shares\/u!([^/]+)\/driveItem$/.exec(path);
    if (method === 'GET' && share) {
      const target = Buffer.from(share[1].replace(/_/g, '/').replace(/-/g, '+'), 'base64').toString();
      const id = /\/f\/([A-Z0-9]+)$/.exec(target)?.[1];
      return id && g.items.has(id) ? json(200, itemJson(id, g.items.get(id))) : json(404, { error: { code: 'itemNotFound' } });
    }
    const m = /^drives\/([^/]+)\/items\/([^/]+)(\/createUploadSession)?$/.exec(path);
    if (!m || m[1] !== DRIVE || !g.items.has(m[2])) return json(404, { error: { code: 'itemNotFound' } });
    const it = g.items.get(m[2]);
    if (method === 'GET' && !m[3]) return json(200, itemJson(m[2], it));
    if (method === 'POST' && m[3]) {
      if (it.readOnly) return json(403, { error: { code: 'accessDenied' } });
      const ifMatch = init.headers?.['If-Match'];
      if (ifMatch && ifMatch !== `"{${m[2]}},${it.version}"`) return json(412, { error: { code: 'resourceModified' } });
      const uploadUrl = `https://up.test/${m[2]}/${g.next++}`;
      g.uploads.set(uploadUrl, { id: m[2] });
      return json(200, { uploadUrl, expirationDateTime: '2026-11-10T13:00:00Z' });
    }
    return json(400, { error: { code: 'BadRequest' } });
  };
  return g;
}

/** Just enough of supabase-js for the service: one table and two RPCs. */
function fakeDb({ roles = {}, flags = {}, nightly = false, userId }) {
  const tables = { document_drive_links: new Map() };
  const query = (name) => {
    const table = tables[name];
    const q = { filters: [], patch: null, op: 'select' };
    const rows = () => [...table.values()].filter((row) => q.filters.every(([k, v]) => row[k] === v));
    const run = () => {
      if (q.op === 'update') for (const row of rows()) Object.assign(row, q.patch);
      if (q.op === 'delete') for (const row of rows()) table.delete(row.document_id);
      return { data: null, error: null };
    };
    const api = {
      select() { return api; },
      eq(k, v) { q.filters.push([k, v]); return api; },
      maybeSingle: async () => ({ data: rows()[0] ? { ...rows()[0] } : null, error: null }),
      upsert: async (row) => { table.set(row.document_id, { ...(table.get(row.document_id) || {}), ...row }); return { error: null }; },
      update(patch) { q.op = 'update'; q.patch = patch; return api; },
      delete() { q.op = 'delete'; return api; },
      then(resolve, reject) { try { resolve(run()); } catch (e) { reject(e); } },
    };
    return api;
  };
  return {
    tables,
    service: { from: query },
    userDbFor: (uid) => ({
      rpc: async (fn, args) => {
        if (fn === 'get_my_feature_flags') return { data: flags[uid] || {} };
        if (fn === 'can_use_nightly') return { data: nightly };
        if (fn === 'get_my_document_role') return { data: roles[uid]?.[args.doc_id] || null, error: null };
        return { data: null, error: { message: 'no rpc' } };
      },
    }),
    userId,
  };
}

function setup({ roles, flags = {}, connected = ['owner-1', 'editor-1'] } = {}) {
  const graph = fakeGraph();
  const db = fakeDb({ roles, flags });
  const call = async (userId, body) => driveAction({
    user: { id: userId },
    body,
    service: db.service,
    userDb: db.userDbFor(userId),
    env: {},
    driveClientFor: async (uid) => {
      if (!connected.includes(uid)) throw new DriveError('Connect Microsoft first.', 409, 'not_connected');
      return createDriveClient({ getAccessToken: async () => `tok-${uid}`, fetch: graph.fetch, baseUrl: BASE });
    },
  });
  return { graph, db, call };
}

const DOC = '11111111-1111-4111-8111-111111111111';
const BETA = { 'owner-1': { 'drive-sync-back': true }, 'editor-1': { 'drive-sync-back': true } };
const ROLES = { 'owner-1': { [DOC]: 'owner' }, 'editor-1': { [DOC]: 'editor' }, 'viewer-1': { [DOC]: 'viewer' } };

async function rejects(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code, err.message);
    return true;
  });
}

test('browse lists folders, SharePoint shortcuts and only the PDFs; a pasted link opens a folder or a PDF', async () => {
  const { graph, call } = setup({ roles: ROLES, flags: BETA });
  graph.add('PDF1', { name: 'A-201 Plan.pdf' });
  const top = await call('owner-1', { action: 'driveBrowse' });
  assert.deepEqual(top.folders, ['Jobs']);
  assert.deepEqual(top.places, [{ name: 'Library', folder: placeToken('b!sp', 'LIB') }]);
  assert.deepEqual(top.files.map((f) => [f.name, f.itemId, f.driveId]), [['A-201 Plan.pdf', 'PDF1', DRIVE]]);
  const pasted = await call('owner-1', { action: 'driveBrowse', folderLink: 'https://contoso.example/f/PDF1' });
  assert.equal(pasted.file.itemId, 'PDF1');
  await rejects(call('owner-1', { action: 'driveBrowse', folderLink: 'http://plain' }), 'bad_link');
  await rejects(call('owner-1', { action: 'driveBrowse', folderLink: 'https://contoso.example/f/NOPE' }), 'bad_link');
});

test('the beta and a Microsoft sign-in are needed to browse and open', async () => {
  const { graph, call } = setup({ roles: ROLES, flags: {} });
  graph.add('PDF1', { name: 'A.pdf' });
  await rejects(call('owner-1', { action: 'driveBrowse' }), 'beta');
  const withBeta = setup({ roles: ROLES, flags: { 'viewer-1': { 'drive-sync-back': true } } });
  await rejects(withBeta.call('viewer-1', { action: 'driveBrowse' }), 'not_connected');
});

test('open gives a download link; link records the version downloaded; push and pushed save back', async () => {
  const { graph, db, call } = setup({ roles: ROLES, flags: BETA });
  graph.add('PDF1', { name: 'A-201 Plan.pdf' });
  const opened = await call('owner-1', { action: 'driveOpen', driveId: DRIVE, itemId: 'PDF1' });
  assert.match(opened.downloadUrl, /^https:\/\/dl\.test\/PDF1/);
  assert.equal(opened.eTag, '"{PDF1},1"');
  const { link } = await call('owner-1', { action: 'driveLink', documentId: DOC, driveId: DRIVE, itemId: 'PDF1', eTag: opened.eTag });
  assert.equal(link.name, 'A-201 Plan.pdf');
  assert.equal(link.syncMinutes, 5);
  assert.equal(db.tables.document_drive_links.get(DOC).etag, '"{PDF1},1"');

  // An editor with no Microsoft account of their own saves back with the linker's.
  const { uploadUrl } = await call('editor-1', { action: 'drivePush', documentId: DOC });
  await graph.fetch(uploadUrl, { method: 'PUT', body: 'pdf-with-marks' });
  const after = await call('editor-1', { action: 'drivePushed', documentId: DOC, sha: 'abc' });
  assert.equal(graph.items.get('PDF1').bytes, 'pdf-with-marks');
  assert.equal(db.tables.document_drive_links.get(DOC).etag, '"{PDF1},2"');
  assert.equal(after.link.lastPushedSha, 'abc');
  assert.ok(graph.calls.some((c) => c.startsWith('POST') && c.includes('createUploadSession')));

  // A second push sends the new version as If-Match and goes through.
  const again = await call('owner-1', { action: 'drivePush', documentId: DOC });
  assert.ok(again.uploadUrl);
});

test('a change made in OneDrive since the last save is a conflict; "keep Survey\'s version" overwrites', async () => {
  const { graph, db, call } = setup({ roles: ROLES, flags: BETA });
  graph.add('PDF1', { name: 'A.pdf' });
  await call('owner-1', { action: 'driveLink', documentId: DOC, driveId: DRIVE, itemId: 'PDF1', eTag: '"{PDF1},1"' });
  graph.editAtSource('PDF1', 'someone-else');
  const status = await call('owner-1', { action: 'driveStatus', documentId: DOC, check: true });
  assert.equal(status.changedAtSource, true);
  assert.equal(status.source.modifiedBy, 'Pat Manager');
  await rejects(call('owner-1', { action: 'drivePush', documentId: DOC }), 'conflict');
  assert.equal(db.tables.document_drive_links.get(DOC).last_error, 'conflict');
  assert.equal(graph.items.get('PDF1').bytes, 'someone-else', 'nothing overwritten');
  const forced = await call('owner-1', { action: 'drivePush', documentId: DOC, force: true });
  await graph.fetch(forced.uploadUrl, { method: 'PUT', body: 'survey-version' });
  await call('owner-1', { action: 'drivePushed', documentId: DOC, force: true });
  assert.equal(graph.items.get('PDF1').bytes, 'survey-version');
  assert.equal(db.tables.document_drive_links.get(DOC).last_error, null);
});

test('a late confirm keeps the old eTag when the drive changed after Survey\'s upload, and stamps the push start time', async () => {
  const { graph, db, call } = setup({ roles: ROLES, flags: BETA });
  graph.add('PDF1', { name: 'A.pdf' });
  await call('owner-1', { action: 'driveLink', documentId: DOC, driveId: DRIVE, itemId: 'PDF1', eTag: '"{PDF1},1"' });
  const { uploadUrl } = await call('owner-1', { action: 'drivePush', documentId: DOC });
  await graph.fetch(uploadUrl, { method: 'PUT', body: 'survey-v2' });
  // Survey's write made version 2; then someone edits in OneDrive before the confirm lands.
  graph.editAtSource('PDF1', 'someone-else');
  const startedAt = new Date(Date.now() - 10 * 60_000).toISOString();
  const late = await call('owner-1', { action: 'drivePushed', documentId: DOC, sha: 'v2', late: true, eTag: '"{PDF1},2"', pushedAt: startedAt });
  assert.equal(db.tables.document_drive_links.get(DOC).etag, '"{PDF1},1"', 'not stamped with their version');
  assert.equal(late.link.lastPushedAt, startedAt, 'the time the push started, not now');
  await rejects(call('owner-1', { action: 'drivePush', documentId: DOC }), 'conflict');
  assert.equal(graph.items.get('PDF1').bytes, 'someone-else', 'their change is not overwritten');

  // "Keep Survey's version", then a late confirm with no change since: the drive's version is taken.
  const forced = await call('owner-1', { action: 'drivePush', documentId: DOC, force: true });
  await graph.fetch(forced.uploadUrl, { method: 'PUT', body: 'survey-v4' });
  await call('owner-1', { action: 'drivePushed', documentId: DOC, sha: 'v4', force: true, late: true, eTag: '"{PDF1},4"' });
  assert.equal(db.tables.document_drive_links.get(DOC).etag, '"{PDF1},4"');
});

test('a moved or deleted file, a read-only file and "syncing off" each say so', async () => {
  const { graph, call } = setup({ roles: ROLES, flags: BETA });
  graph.add('PDF1', { name: 'A.pdf' });
  graph.add('RO', { name: 'RO.pdf', readOnly: true });
  await call('owner-1', { action: 'driveLink', documentId: DOC, driveId: DRIVE, itemId: 'RO', eTag: '"{RO},1"' });
  await rejects(call('owner-1', { action: 'drivePush', documentId: DOC }), 'read_only');
  await call('owner-1', { action: 'driveLink', documentId: DOC, driveId: DRIVE, itemId: 'PDF1', eTag: '"{PDF1},1"' });
  graph.items.delete('PDF1');
  await rejects(call('owner-1', { action: 'drivePush', documentId: DOC }), 'gone');
  const status = await call('owner-1', { action: 'driveStatus', documentId: DOC, check: true });
  assert.equal(status.problem.code, 'gone');
  await call('owner-1', { action: 'driveSettings', documentId: DOC, syncOff: true, syncMinutes: 15 });
  const off = await call('owner-1', { action: 'driveStatus', documentId: DOC });
  assert.equal(off.link.syncOff, true);
  assert.equal(off.link.syncMinutes, 15);
  await rejects(call('owner-1', { action: 'drivePush', documentId: DOC }), 'sync_off');
});

test('viewers can read the link but not push, change settings or unlink; the owner can unlink', async () => {
  const { graph, call } = setup({ roles: ROLES, flags: BETA });
  graph.add('PDF1', { name: 'A.pdf' });
  await call('editor-1', { action: 'driveLink', documentId: DOC, driveId: DRIVE, itemId: 'PDF1', eTag: '"{PDF1},1"' });
  const seen = await call('viewer-1', { action: 'driveStatus', documentId: DOC });
  assert.equal(seen.link.name, 'A.pdf');
  assert.equal(seen.canPush, false);
  await rejects(call('viewer-1', { action: 'drivePush', documentId: DOC }), 'not_editor');
  await rejects(call('viewer-1', { action: 'driveSettings', documentId: DOC, syncOff: true }), 'not_editor');
  await rejects(call('viewer-1', { action: 'driveUnlink', documentId: DOC }), 'not_linker');
  await rejects(call('stranger', { action: 'driveStatus', documentId: DOC }), 'no_access');
  await rejects(call('viewer-1', { action: 'driveLink', documentId: DOC, driveId: DRIVE, itemId: 'PDF1' }), 'beta');
  assert.deepEqual(await call('owner-1', { action: 'driveUnlink', documentId: DOC }), { link: null });
  assert.equal((await call('owner-1', { action: 'driveStatus', documentId: DOC })).link, null);
});

test('the sharing-link id matches Graph\'s u! form', () => {
  assert.match(shareIdOf('https://contoso.example/f/PDF1'), /^u![A-Za-z0-9_-]+$/);
});

test('every field the app sends to the drive actions passes the sheet-sync request check', async () => {
  // handleSheetSync keeps only the keys its schema lists; a missing key is
  // silently dropped before driveAction sees it.
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../supabase/functions/_shared/sheetSync/service.js', import.meta.url), 'utf8');
  const listed = new Set([...src.matchAll(/^\s+(\w+): s\.\w+\(/gm)].map((m) => m[1]));
  const sent = ['action', 'documentId', 'driveId', 'itemId', 'eTag', 'sha', 'force', 'late', 'pushedAt', 'appOrigin', 'provider', 'check', 'syncMinutes', 'syncOff'];
  for (const key of sent) assert.ok(listed.has(key), `sheet-sync schema is missing "${key}"`);
});
