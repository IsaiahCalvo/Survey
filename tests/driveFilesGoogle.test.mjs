// Google Drive files that save back (Nightly 'drive-sync-back';
// supabase/functions/_shared/driveFiles/service.js): the Picker's token,
// open, link, push through a resumable upload with the app's Origin, a change
// made in Google Drive (conflict), a file in the bin (gone), a read-only file
// and Google's "slow down", against a fake Drive v3 and an in-memory database.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGoogleDriveClient, driveAction, DriveError, GOOGLE_DRIVE_ID, googleProjectNumber,
} from '../supabase/functions/_shared/driveFiles/service.js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The app's upload helper, without the modules that need a browser.
async function loadUploadToDrive() {
  const source = await readFile(new URL('../src/services/driveFilesClient.js', import.meta.url), 'utf8');
  const dir = await mkdtemp(path.join(tmpdir(), 'drive-client-'));
  const file = path.join(dir, 'driveFilesClient.mjs');
  await writeFile(file, source.replace(/^import .*$/gm, '').replace(/sheetSyncCall/g, '(async () => null)').replace(/readClaim|forgetClaim|isNativeApp|isElectronApp/g, '(() => null)'));
  try { return (await import(pathToFileURL(file).href)).uploadToDrive; } finally { await rm(dir, { recursive: true, force: true }); }
}

const BASE = 'https://google.test';

function fakeDrive() {
  const g = { files: new Map(), sessions: new Map(), calls: [], next: 1, rateLimited: false };
  g.add = (id, { name, mimeType = 'application/pdf', canEdit = true } = {}) => {
    g.files.set(id, { name, mimeType, canEdit, rev: 1, trashed: false, bytes: 'pdf-1' });
  };
  g.editAtSource = (id) => { g.files.get(id).rev += 1; };
  const json = (status, body, headers = {}) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const meta = (id, f) => ({
    id, name: f.name, mimeType: f.mimeType, size: String(f.bytes.length), headRevisionId: `rev-${f.rev}`,
    modifiedTime: '2026-11-12T12:00:00Z', webViewLink: `https://drive.test/file/${id}/view`, trashed: f.trashed,
    capabilities: { canEdit: f.canEdit }, lastModifyingUser: { displayName: 'Pat Manager' },
  });
  g.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    g.calls.push({ method, url, headers: init.headers || {} });
    if (url.startsWith('https://upload.session/')) {
      const id = g.sessions.get(url);
      const f = g.files.get(id);
      f.bytes = String(init.body);
      f.rev += 1;
      g.sessions.delete(url);
      return json(200, { id, name: f.name });
    }
    if (!/^Bearer gtok-/.test(init.headers?.Authorization || '')) return json(401, { error: { code: 401, status: 'UNAUTHENTICATED' } });
    if (g.rateLimited) return json(403, { error: { code: 403, errors: [{ reason: 'userRateLimitExceeded' }], message: 'slow down' } });
    const up = /^https:\/\/google\.test\/upload\/drive\/v3\/files\/([^?]+)\?uploadType=resumable/.exec(url);
    if (up && method === 'PATCH') {
      const uploadUrl = `https://upload.session/${up[1]}/${g.next++}`;
      g.sessions.set(uploadUrl, up[1]);
      return new Response('', { status: 200, headers: { Location: uploadUrl } });
    }
    const m = /^https:\/\/google\.test\/drive\/v3\/files\/([^?]+)\?/.exec(url);
    if (!m || !g.files.has(m[1])) return json(404, { error: { code: 404, errors: [{ reason: 'notFound' }] } });
    return json(200, meta(m[1], g.files.get(m[1])));
  };
  return g;
}

function fakeDb({ roles = {}, flags = {} }) {
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
        if (fn === 'can_use_nightly') return { data: false };
        if (fn === 'get_my_document_role') return { data: roles[uid]?.[args.doc_id] || null, error: null };
        return { data: null, error: { message: 'no rpc' } };
      },
    }),
  };
}

const DOC = '22222222-2222-4222-8222-222222222222';
const BETA = { 'owner-1': { 'drive-sync-back': true }, 'editor-1': { 'drive-sync-back': true } };
const ROLES = { 'owner-1': { [DOC]: 'owner' }, 'editor-1': { [DOC]: 'editor' } };
const ENV = { GOOGLE_SHEETS_CLIENT_ID: '123456789012-abc.apps.googleusercontent.com' };

function setup({ connected = ['owner-1'] } = {}) {
  const drive = fakeDrive();
  const db = fakeDb({ roles: ROLES, flags: BETA });
  const asked = [];
  const call = async (userId, body) => driveAction({
    user: { id: userId },
    body,
    service: db.service,
    userDb: db.userDbFor(userId),
    env: ENV,
    driveClientFor: async (uid, provider) => {
      asked.push(provider);
      if (!connected.includes(uid)) throw new DriveError('Connect Google first.', 409, 'not_connected');
      return createGoogleDriveClient({ getAccessToken: async () => `gtok-${uid}`, fetch: drive.fetch, baseUrl: BASE });
    },
  });
  return { drive, db, call, asked };
}

async function rejects(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code, err.message);
    return true;
  });
}

test('the Picker gets a token of the Google sign-in and the project number as app id', async () => {
  const { call, asked } = setup();
  const out = await call('owner-1', { action: 'drivePickerToken', provider: 'google' });
  assert.equal(out.accessToken, 'gtok-owner-1');
  assert.equal(out.appId, '123456789012');
  assert.deepEqual(asked, ['google']);
  await rejects(call('editor-1', { action: 'drivePickerToken', provider: 'google' }), 'not_connected');
  await rejects(call('owner-1', { action: 'driveBrowse', provider: 'google' }), 'use_picker');
});

test('googleProjectNumber reads the client id, or an explicit number', () => {
  assert.equal(googleProjectNumber(ENV), '123456789012');
  assert.equal(googleProjectNumber({ GOOGLE_CLOUD_PROJECT_NUMBER: '555555555' }), '555555555');
  assert.equal(googleProjectNumber({ GOOGLE_SHEETS_CLIENT_ID: 'not-a-number.apps.googleusercontent.com' }), null);
});

test('open gives the file address and a token; link keeps the head revision; push opens an upload with the app origin', async () => {
  const { drive, db, call } = setup();
  drive.add('FILE1', { name: 'A-201 Plan.pdf' });
  const opened = await call('owner-1', { action: 'driveOpen', provider: 'google', itemId: 'FILE1' });
  assert.equal(opened.provider, 'google');
  assert.equal(opened.driveId, GOOGLE_DRIVE_ID);
  assert.equal(opened.eTag, 'rev-1');
  assert.match(opened.downloadUrl, /^https:\/\/google\.test\/drive\/v3\/files\/FILE1\?alt=media/);
  assert.equal(opened.accessToken, 'gtok-owner-1');

  const { link } = await call('owner-1', { action: 'driveLink', provider: 'google', documentId: DOC, itemId: 'FILE1', eTag: opened.eTag });
  assert.equal(link.provider, 'google');
  assert.equal(link.webUrl, 'https://drive.test/file/FILE1/view');
  const row = db.tables.document_drive_links.get(DOC);
  assert.equal(row.provider, 'google');
  assert.equal(row.drive_id, GOOGLE_DRIVE_ID);
  assert.equal(row.etag, 'rev-1');

  // An editor with no Google account of their own saves back with the linker's.
  const session = await call('editor-1', { action: 'drivePush', documentId: DOC, appOrigin: 'https://surveytool-nightly.vercel.app' });
  assert.equal(session.provider, 'google');
  assert.match(session.uploadUrl, /^https:\/\/upload\.session\/FILE1\//);
  const init = drive.calls.find((c) => c.method === 'PATCH');
  assert.equal(init.headers.Origin, 'https://surveytool-nightly.vercel.app');
  assert.equal(init.headers['X-Upload-Content-Type'], 'application/pdf');
  await drive.fetch(session.uploadUrl, { method: 'PUT', body: 'pdf-with-marks' });
  const done = await call('editor-1', { action: 'drivePushed', documentId: DOC, sha: 'abc' });
  assert.equal(done.link.lastPushedSha, 'abc');
  assert.equal(db.tables.document_drive_links.get(DOC).etag, 'rev-2');
  assert.equal(drive.files.get('FILE1').bytes, 'pdf-with-marks');

  // A made-up origin is never sent to Google.
  await call('editor-1', { action: 'drivePush', documentId: DOC, appOrigin: 'javascript:alert(1)' });
  assert.equal(drive.calls.filter((c) => c.method === 'PATCH').at(-1).headers.Origin, undefined);
});

test('a change made in Google Drive is a conflict until Keep Survey’s version; the bin is gone; read-only and slow-down say so', async () => {
  const { drive, call } = setup();
  drive.add('FILE1', { name: 'A.pdf' });
  await call('owner-1', { action: 'driveLink', provider: 'google', documentId: DOC, itemId: 'FILE1', eTag: 'rev-1' });

  drive.editAtSource('FILE1');
  await rejects(call('owner-1', { action: 'drivePush', documentId: DOC }), 'conflict');
  const status = await call('owner-1', { action: 'driveStatus', documentId: DOC, check: true });
  assert.equal(status.changedAtSource, true);
  assert.equal(status.source.modifiedBy, 'Pat Manager');
  const forced = await call('owner-1', { action: 'drivePush', documentId: DOC, force: true });
  assert.ok(forced.uploadUrl);

  drive.rateLimited = true;
  await rejects(call('owner-1', { action: 'drivePush', documentId: DOC, force: true }), 'busy');
  drive.rateLimited = false;

  drive.files.get('FILE1').canEdit = false;
  await rejects(call('owner-1', { action: 'drivePush', documentId: DOC, force: true }), 'read_only');

  drive.files.get('FILE1').trashed = true;
  await rejects(call('owner-1', { action: 'drivePush', documentId: DOC, force: true }), 'gone');
  drive.files.delete('FILE1');
  await rejects(call('owner-1', { action: 'drivePush', documentId: DOC, force: true }), 'gone');
});

test('open refuses a file that is not a PDF, and the messages name Google Drive', async () => {
  const { drive, call } = setup();
  drive.add('DOC1', { name: 'notes', mimeType: 'application/vnd.google-apps.document' });
  await assert.rejects(call('owner-1', { action: 'driveOpen', provider: 'google', itemId: 'DOC1' }), (err) => {
    assert.equal(err.code, 'not_pdf');
    assert.match(err.message, /Google Drive/);
    return true;
  });
});

test('uploadToDrive sends Google the whole file in one request, and Graph pieces past 60 MiB', async () => {
  const uploadToDrive = await loadUploadToDrive();
  const big = new Uint8Array(61 * 1024 * 1024);
  const recorder = (pieceStatus) => {
    const sizes = [];
    const fetchImpl = async (_url, init) => {
      sizes.push(init.body.byteLength);
      const range = /bytes (\d+)-(\d+)\/(\d+)/.exec(init.headers['Content-Range']);
      const last = Number(range[2]) + 1 === Number(range[3]);
      return last ? new Response(JSON.stringify({ id: 'X' }), { status: 200 }) : new Response(null, { status: pieceStatus });
    };
    return { sizes, fetchImpl };
  };
  // Google: one request, never a 308 round (a browser's fetch treats 308 as a redirect).
  const google = recorder(308);
  const out = await uploadToDrive('https://upload.session/g', big, google.fetchImpl, { wholeFile: true });
  assert.equal(out.id, 'X');
  assert.deepEqual(google.sizes, [big.byteLength]);
  // Graph: pieces of a multiple of 320 KiB, each answered 202.
  const graph = recorder(202);
  const outGraph = await uploadToDrive('https://upload.session/m', big, graph.fetchImpl);
  assert.equal(outGraph.id, 'X');
  assert.ok(graph.sizes.length > 1);
  assert.equal(graph.sizes[0] % (320 * 1024), 0);
  assert.equal(graph.sizes.reduce((a, b) => a + b, 0), big.byteLength);
  // A 308 mid-upload is not taken as "send more".
  const stray = recorder(308);
  await assert.rejects(uploadToDrive('https://upload.session/m', big, stray.fetchImpl), /did not take the file \(308\)/);
});
