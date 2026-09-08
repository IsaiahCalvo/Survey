import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createDocumentUploadCloud } from '../src/services/documentUploadCloud.js';
import { computeContentSha256 } from '../src/services/contentHash.js';

const actorId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const projectId = '33333333-3333-4333-8333-333333333333';
const documentId = '44444444-4444-4444-8444-444444444444';
const pdf = new Blob(['%PDF-1.7\noriginal upload'], { type: 'application/pdf' });
const newerPdf = new Blob(['%PDF-1.7\nnewer published edits, not the import'], { type: 'application/pdf' });
const sha = await computeContentSha256(await pdf.arrayBuffer());
const path = `${actorId}/${documentId}/${sha}.pdf`;
const legacyPath = `${actorId}/old name.pdf`;
const initial = { id: documentId, user_id: actorId, project_id: null, name: 'Drawing.pdf',
  file_path: path, file_size: pdf.size, content_sha256: sha, page_count: 1, name_aliases: [], archived: false,
  user_archived_at: null, created_at: '2026-09-08T12:00:00.000Z', updated_at: '2026-09-08T12:00:00.000Z' };
const { user_archived_at: _userArchive, created_at: _created, updated_at: _updated, ...input } = initial;
const tick = () => new Promise(setImmediate);
const copy = value => JSON.parse(JSON.stringify(value));
function deferred() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function storageError(code) { return Response.json({ statusCode: String(code), error: code === 409 ? 'ResourceAlreadyExists' : 'StorageError', message: `storage ${code}` }, { status: code }); }
function matches(row, request) {
  if (!row) return false;
  for (const [key, value] of request.url.searchParams) {
    if (['select', 'limit'].includes(key)) continue;
    if (value === 'is.null') { if (row[key] !== null) return false; continue; }
    if (!value.startsWith('eq.')) throw new Error(`Unexpected filter ${key}=${value}`);
    const expected = value.slice(3);
    if (Array.isArray(row[key])) {
      const actual = `{${row[key].map(name => `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
      if (actual !== expected) return false;
    } else if (String(row[key]) !== expected) return false;
  }
  return true;
}
function fixture() {
  const state = { row: copy(initial), current: true, session: { user: { id: actorId }, access_token: 'fixture-token-a' },
    requests: [], listeners: new Set(), files: new Map(), responder: null, sessionReader: null,
    project: { id: projectId, user_id: actorId, name: 'Project', archived: false, user_archived_at: null }, projectEditable: false };
  const respond = async request => {
    if (request.url.pathname.includes('/storage/v1/object/')) {
      const filePath = decodeURIComponent(request.url.pathname.split('/storage/v1/object/documents/')[1]);
      if (request.method === 'GET') return state.files.has(filePath) ? new Response(state.files.get(filePath)) : storageError(404);
      if (state.files.has(filePath)) return storageError(409);
      state.files.set(filePath, request.body.get(''));
      return Response.json({ Id: 'object-id', Key: `documents/${filePath}` });
    }
    if (request.url.pathname.endsWith('/projects')) return Response.json([state.project]);
    if (request.url.pathname.endsWith('/rpc/user_can_access_project')) return Response.json(state.projectEditable);
    if (request.method === 'GET') return Response.json(matches(state.row, request) ? [state.row] : []);
    if (request.method === 'POST') {
      state.row = { ...initial, ...JSON.parse(request.body) };
      return Response.json(state.row);
    }
    if (request.method === 'PATCH') {
      if (!matches(state.row, request)) return Response.json(null);
      state.row = { ...state.row, ...JSON.parse(request.body), updated_at: '2026-09-08T12:01:00.000Z' };
      return Response.json(state.row);
    }
    throw new Error(`Unexpected ${request.method} ${request.url}`);
  };
  const client = createClient('https://offline-fixture.invalid', 'fixture-publishable-not-a-secret', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url, init = {}) => {
      const request = { ...init, method: init.method || 'GET', url: new URL(String(url)), headers: new Headers(init.headers) };
      state.requests.push(request);
      return state.responder ? state.responder(request, () => respond(request)) : respond(request);
    } },
  });
  client.auth.getSession = () => state.sessionReader?.() ?? Promise.resolve({ data: { session: state.session }, error: null });
  client.auth.onAuthStateChange = callback => { state.listeners.add(callback); return { data: { subscription: { unsubscribe: () => state.listeners.delete(callback) } } }; };
  return { client, state, create: options => createDocumentUploadCloud({ client, actorId, tier: 'pro', isCurrent: () => state.current, ...options }),
    emit(event, session) { state.session = session; for (const callback of state.listeners) callback(event, session); } };
}

test('real SDK reads use exact owner, nullable project and complete document columns', async () => {
  const f = fixture(); const cloud = await f.create();
  assert.equal((await cloud.readProject(projectId)).id, projectId);
  assert.deepEqual(await cloud.readDocument(documentId), initial);
  assert.deepEqual(await cloud.findDocumentByHash(null, sha), initial);
  assert.equal(f.state.requests.at(-1).url.searchParams.get('project_id'), 'is.null');
  f.state.row.project_id = projectId;
  assert.equal((await cloud.findDocumentByHash(projectId, sha)).project_id, projectId);
  for (const request of f.state.requests) {
    assert.equal(request.headers.get('authorization'), 'Bearer fixture-token-a');
    assert.equal(request.url.searchParams.get('user_id'), request.url.pathname.endsWith('/projects') ? null : `eq.${actorId}`);
    assert.ok(request.signal instanceof AbortSignal);
  }
  assert.match(f.state.requests[1].url.searchParams.get('select'), /created_at,updated_at/);
});

test('owned project returns upload permission without a collaborator RPC', async () => {
  const f = fixture(); const cloud = await f.create();
  assert.equal((await cloud.readProject(projectId)).uploadWritable, true);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.requests[0].url.searchParams.get('id'), `eq.${projectId}`);
  assert.equal(f.state.requests[0].url.searchParams.has('user_id'), false);
});

test('shared editor/coowner permission allows actor-owned uploads without changing host documents or project', async () => {
  const f = fixture(); const cloud = await f.create();
  f.state.project.user_id = otherId; f.state.projectEditable = true;
  const project = await cloud.readProject(projectId);
  assert.equal(project.user_id, otherId); assert.equal(project.uploadWritable, true);
  const permission = f.state.requests[1];
  assert.equal(permission.url.pathname, '/rest/v1/rpc/user_can_access_project');
  assert.deepEqual(JSON.parse(permission.body), { proj_id: projectId, required_role: 'editor' });
  assert.equal(permission.headers.get('authorization'), 'Bearer fixture-token-a');
  assert.ok(permission.signal instanceof AbortSignal);
  await cloud.uploadFile(path, pdf);
  const created = await cloud.createDocument({ ...input, project_id: projectId });
  assert.equal(created.user_id, actorId); assert.equal(created.project_id, projectId);
  await cloud.findDocumentsByName(projectId, initial.name);
  assert.equal(f.state.requests.at(-1).url.searchParams.get('user_id'), `eq.${actorId}`);
  assert.equal(f.state.requests.some(request => request.url.pathname.endsWith('/projects') && request.method !== 'GET'), false);
});

test('shared viewer, missing helper and non-boolean permission cannot authorize an upload', async () => {
  for (const permission of [false, null, 'true', { allowed: true }]) {
    const f = fixture(); const cloud = await f.create();
    f.state.project.user_id = otherId; f.state.projectEditable = permission;
    await assert.rejects(cloud.readProject(projectId));
    assert.equal(f.state.requests.some(request => request.url.pathname.includes('/storage/')), false);
  }
  const f = fixture(); const cloud = await f.create(); f.state.project.user_id = otherId;
  f.state.responder = (request, normal) => request.url.pathname.includes('/rpc/')
    ? Response.json({ code: 'PGRST202', message: 'helper absent' }, { status: 404 }) : normal();
  await assert.rejects(cloud.readProject(projectId), error => error.code === 'PGRST202');
});

test('shared project permission check rejects stale account and aborts its scoped request', async () => {
  const f = fixture(); const cloud = await f.create(); f.state.project.user_id = otherId;
  const gate = deferred();
  f.state.responder = (request, normal) => request.url.pathname.includes('/rpc/') ? gate.promise : normal();
  const pending = cloud.readProject(projectId); await tick();
  const permission = f.state.requests.at(-1);
  f.emit('SIGNED_IN', { user: { id: otherId }, access_token: 'fixture-b' });
  await assert.rejects(pending, error => error.code === 'DOCUMENT_UPLOAD_RETIRED');
  assert.equal(permission.signal.aborted, true);
  gate.resolve(Response.json(true)); await tick();
  assert.equal(f.state.requests.length, 2);
});

test('duplicate name lookup returns scoped active read-proven rows and excludes user archives', async () => {
  const f = fixture(); const cloud = await f.create();
  const rows = await cloud.findDocumentsByName(null, initial.name);
  assert.deepEqual(rows, [initial]);
  const request = f.state.requests.at(-1);
  assert.equal(request.url.searchParams.get('project_id'), 'is.null');
  assert.equal(request.url.searchParams.get('name'), `eq.${initial.name}`);
  assert.equal(request.url.searchParams.get('user_id'), `eq.${actorId}`);
  assert.equal(request.url.searchParams.get('archived'), 'eq.false');
  assert.equal(request.url.searchParams.get('user_archived_at'), 'is.null');
  assert.equal(request.url.searchParams.get('limit'), '50');
  assert.equal(request.headers.get('authorization'), 'Bearer fixture-token-a');
  assert.ok(request.signal instanceof AbortSignal);
  assert.match(request.url.searchParams.get('select'), /created_at,updated_at/);
  assert.equal((await cloud.archiveDocument(rows[0])).archived, true, 'lookup rows carry exact private proof');
  assert.deepEqual(await cloud.findDocumentsByName(null, initial.name), []);
  f.state.row = { ...initial, project_id: projectId };
  assert.equal((await cloud.findDocumentsByName(projectId, initial.name))[0].project_id, projectId);
  f.state.row.user_archived_at = '2026-09-08T13:00:00Z';
  assert.deepEqual(await cloud.findDocumentsByName(projectId, initial.name), []);
});

test('duplicate name lookup rejects wrong result scope and a retired account', async () => {
  const f = fixture(); const cloud = await f.create();
  for (const override of [{ project_id: projectId }, { name: 'Other.pdf' }, { user_id: otherId }, { archived: true }, { user_archived_at: '2026-09-08' }]) {
    f.state.responder = () => Response.json([{ ...initial, ...override }]);
    await assert.rejects(cloud.findDocumentsByName(null, initial.name));
  }
  f.state.responder = () => Response.json(null);
  await assert.rejects(cloud.findDocumentsByName(null, initial.name));
  const count = f.state.requests.length;
  f.state.current = false;
  await assert.rejects(cloud.findDocumentsByName(null, initial.name), error => error.code === 'DOCUMENT_UPLOAD_RETIRED');
  assert.equal(f.state.requests.length, count);
});

test('legacy unknown size and hash can be selected by name and archived with exact null guards', async () => {
  const f = fixture(); const cloud = await f.create();
  Object.assign(f.state.row, { file_size: null, content_sha256: null, file_path: legacyPath });
  const [row] = await cloud.findDocumentsByName(null, initial.name);
  assert.equal(row.file_size, null); assert.equal(row.content_sha256, null);
  assert.equal((await cloud.archiveDocument(row)).archived, true);
  const patch = f.state.requests.at(-1);
  assert.equal(patch.url.searchParams.get('file_size'), 'is.null');
  assert.equal(patch.url.searchParams.get('content_sha256'), 'is.null');
  assert.equal(patch.url.searchParams.get('file_path'), `eq.${legacyPath}`);
});

test('nullable legacy size never authorizes a new row or missing-object repair', async () => {
  const f = fixture(); const cloud = await f.create();
  await assert.rejects(cloud.createDocument({ ...input, file_size: null }), error => error.code === 'DOCUMENT_UPLOAD_INVALID');
  assert.equal(f.state.requests.length, 0, 'invalid new size fails before dispatch');
  Object.assign(f.state.row, { file_size: null, file_path: legacyPath });
  const row = await cloud.readDocument(documentId);
  await assert.rejects(cloud.ensureDocumentFile(row, pdf), error => error.code === 'DOCUMENT_UPLOAD_INVALID');
  assert.ok(f.state.requests.every(request => request.method === 'GET'));
  assert.equal(f.state.files.size, 0);
});

test('new upload is create-only in document namespace and row insert keeps stable ID/provenance', async () => {
  const f = fixture(); const cloud = await f.create();
  assert.equal(await cloud.uploadFile(path, pdf), path);
  assert.equal((await cloud.createDocument(input)).id, documentId);
  assert.equal(f.state.requests[0].headers.get('x-upsert'), 'false');
  const record = JSON.parse(f.state.requests[1].body);
  assert.equal(record.project_id, null); assert.equal(record.first_opened_user_tier, 'pro');
  assert.ok(record.first_opened_device); assert.ok(record.first_opened_app_version);
  assert.deepEqual(f.state.requests.map(request => request.method), ['POST', 'POST']);
  const created = await cloud.createDocument(input);
  assert.equal((await cloud.addAlias(created, 'Also.pdf')).name_aliases[0], 'Also.pdf', 'returned create rows retain proof');
});

test('candidate upload conflicts verify exact bytes; mismatched bytes are never replaced', async () => {
  const f = fixture(); const cloud = await f.create(); f.state.files.set(path, pdf);
  assert.equal(await cloud.uploadFile(path, pdf), path);
  assert.deepEqual(f.state.requests.map(request => request.method), ['POST', 'GET']);
  f.state.files.set(path, newerPdf);
  await assert.rejects(cloud.uploadFile(path, pdf), error => error.code === 'DOCUMENT_UPLOAD_CONFLICT');
  assert.equal(await f.state.files.get(path).text(), await newerPdf.text());
  const count = f.state.requests.length;
  await assert.rejects(cloud.uploadFile(path, newerPdf));
  assert.equal(f.state.requests.length, count, 'wrong retained hash fails before dispatch');
});

test('new row rejects legacy path, foreign owner and project namespace', async () => {
  const f = fixture(); const cloud = await f.create();
  for (const record of [{ ...input, file_path: legacyPath }, { ...input, user_id: otherId }, { ...input, file_path: `${actorId}/${projectId}/${sha}.pdf` }]) {
    await assert.rejects(cloud.createDocument(record));
  }
  assert.equal(f.state.requests.length, 0);
});

test('published PDF returns current bytes, never rewrites original bytes or page count', async () => {
  const f = fixture(); const cloud = await f.create(); f.state.files.set(path, newerPdf);
  const row = await cloud.readDocument(documentId);
  assert.equal(await (await cloud.ensureDocumentFile(row, pdf)).text(), await newerPdf.text());
  assert.ok(f.state.requests.every(request => request.method === 'GET'));
  assert.equal(f.state.row.page_count, 1);
});

test('safe legacy missing object repairs create-only and returns downloaded bytes', async () => {
  const f = fixture(); const cloud = await f.create(); f.state.row.file_path = legacyPath;
  const row = await cloud.readDocument(documentId);
  assert.equal(await (await cloud.ensureDocumentFile(row, pdf)).text(), await pdf.text());
  const uploads = f.state.requests.filter(request => request.method === 'POST');
  assert.equal(uploads.length, 1); assert.equal(uploads[0].headers.get('x-upsert'), 'false');
  assert.equal(decodeURIComponent(uploads[0].url.pathname), `/storage/v1/object/documents/${legacyPath}`);
  assert.ok(!f.state.requests.some(request => request.method === 'PATCH'));
});

test('legacy repair conflict returns competing newer PDF without requiring original hash', async () => {
  const f = fixture(); const cloud = await f.create(); f.state.row.file_path = legacyPath;
  const row = await cloud.readDocument(documentId);
  f.state.responder = (request, normal) => {
    if (request.method === 'POST') { f.state.files.set(legacyPath, newerPdf); return storageError(409); }
    return normal();
  };
  assert.equal(await (await cloud.ensureDocumentFile(row, pdf)).text(), await newerPdf.text());
  assert.equal(f.state.requests.filter(request => request.method === 'POST').length, 1);
});

for (const code of [401, 403, 500]) {
  test(`storage ${code} does not masquerade as missing object or trigger repair`, async () => {
    const f = fixture(); const cloud = await f.create(); const row = await cloud.readDocument(documentId);
    f.state.responder = () => storageError(code);
    await assert.rejects(cloud.ensureDocumentFile(row, pdf));
    assert.equal(f.state.requests.length, 2);
    assert.ok(f.state.requests.every(request => request.method === 'GET'));
  });
}

test('repair requires exact private read proof and refuses changed row or wrong original bytes', async () => {
  const f = fixture(); const cloud = await f.create(); const row = await cloud.readDocument(documentId);
  await assert.rejects(cloud.ensureDocumentFile({ ...row }, pdf));
  await assert.rejects(cloud.addAlias({ ...row }, 'No.pdf'));
  await assert.rejects(cloud.reviveDocument({ ...row }));
  await assert.rejects(cloud.archiveDocument({ ...row }));
  assert.equal(f.state.requests.length, 1);
  await assert.rejects(cloud.ensureDocumentFile(row, newerPdf));
  f.state.row.updated_at = '2026-09-08T12:02:00.000Z';
  await assert.rejects(cloud.ensureDocumentFile(row, pdf), error => error.code === 'DOCUMENT_UPLOAD_CONFLICT');
  assert.ok(!f.state.requests.some(request => request.method === 'POST'));
});

test('foreign and unsafe legacy paths never gain read proof', async () => {
  const f = fixture(); const cloud = await f.create();
  for (const file_path of [`${otherId}/x.pdf`, `${actorId}/../x.pdf`, `${actorId}/%2e%2e/x.pdf`, `${actorId}/x.pdf?q=1`, `${actorId}/x.pdf#fragment`, `${actorId}//x.pdf`, `${actorId}/a\\b.pdf`]) {
    f.state.row.file_path = file_path;
    await assert.rejects(cloud.readDocument(documentId));
  }
});

test('mutating an issued row cannot change private archive target or repair path', async () => {
  const f = fixture(); const cloud = await f.create(); const row = await cloud.readDocument(documentId);
  Object.assign(row, { file_path: `${actorId}/other.pdf`, name: 'Other.pdf', updated_at: 'changed' });
  f.state.files.set(path, newerPdf);
  assert.equal(await (await cloud.ensureDocumentFile(row, pdf)).text(), await newerPdf.text());
  assert.equal((await cloud.archiveDocument(row)).file_path, path);
  const patch = f.state.requests.at(-1);
  assert.equal(patch.url.searchParams.get('name'), `eq.${initial.name}`);
  assert.equal(patch.url.searchParams.get('updated_at'), `eq.${initial.updated_at}`);
});

test('retirement during missing-object repair prevents the later storage write', async () => {
  const f = fixture(); const cloud = await f.create(); const row = await cloud.readDocument(documentId);
  f.state.responder = (request, normal) => {
    if (request.url.pathname.endsWith('/documents')) f.emit('SIGNED_OUT', null);
    return normal();
  };
  await assert.rejects(cloud.ensureDocumentFile(row, pdf), error => error.code === 'DOCUMENT_UPLOAD_RETIRED');
  assert.ok(f.state.requests.every(request => request.method === 'GET'));
  assert.equal(f.state.files.size, 0);
});

test('alias update rereads and merges aliases with exact CAS, without page-count mutation', async () => {
  const f = fixture(); const cloud = await f.create(); const old = await cloud.readDocument(documentId);
  f.state.row.name_aliases = ['Another tab.pdf']; f.state.row.updated_at = '2026-09-08T12:00:30.000Z';
  const row = await cloud.addAlias(old, 'Quote " and \\.pdf');
  assert.deepEqual(row.name_aliases, ['Another tab.pdf', 'Quote " and \\.pdf']);
  const patch = f.state.requests.find(request => request.method === 'PATCH');
  assert.deepEqual(Object.keys(JSON.parse(patch.body)), ['name_aliases']);
  assert.equal(patch.url.searchParams.get('name_aliases'), 'eq.{"Another tab.pdf"}');
  assert.equal(patch.url.searchParams.get('updated_at'), 'eq.2026-09-08T12:00:30.000Z');
  assert.equal(patch.url.searchParams.get('project_id'), 'is.null');
  f.state.files.set(path, newerPdf);
  assert.equal(await (await cloud.ensureDocumentFile(row, pdf)).text(), await newerPdf.text(), 'alias result retains proof');
});

test('alias CAS retry merges intervening aliases and refuses persistent zero-row conflicts', async () => {
  const f = fixture(); const cloud = await f.create(); const row = await cloud.readDocument(documentId);
  let patches = 0;
  f.state.responder = (request, normal) => {
    if (request.method === 'PATCH' && ++patches === 1) { f.state.row.name_aliases = ['Raced.pdf']; return Response.json(null); }
    return normal();
  };
  assert.deepEqual((await cloud.addAlias(row, 'New.pdf')).name_aliases, ['Raced.pdf', 'New.pdf']);
  f.state.responder = (request, normal) => request.method === 'PATCH' ? Response.json(null) : normal();
  await assert.rejects(cloud.addAlias(row, 'Another.pdf'), error => error.code === 'DOCUMENT_UPLOAD_CONFLICT');
});

test('revive only quota archive through exact CAS, no explicit user archive restore', async () => {
  const f = fixture(); const cloud = await f.create(); f.state.row.archived = true;
  const row = await cloud.readDocument(documentId);
  const revived = await cloud.reviveDocument(row);
  assert.equal(revived.archived, false);
  const patch = f.state.requests.at(-1);
  assert.equal(patch.url.searchParams.get('archived'), 'eq.true');
  assert.equal(patch.url.searchParams.get('user_archived_at'), 'is.null');
  assert.deepEqual(JSON.parse(patch.body), { archived: false });
  f.state.row.archived = true; f.state.row.user_archived_at = '2026-09-08T12:03:00.000Z';
  await assert.rejects(cloud.reviveDocument(await cloud.readDocument(documentId)));
  assert.equal((await cloud.addAlias(revived, 'Fail.pdf').catch(error => error)).code, 'DOCUMENT_UPLOAD_CONFLICT');
});

test('archive binds selected identity and old timestamp; changed name or zero rows conflict', async () => {
  const f = fixture(); const cloud = await f.create(); const row = await cloud.readDocument(documentId);
  f.state.row.name = 'Changed.pdf';
  await assert.rejects(cloud.archiveDocument(row), error => error.code === 'DOCUMENT_UPLOAD_CONFLICT');
  assert.equal(f.state.row.archived, false);
  f.state.row = copy(initial);
  assert.equal((await cloud.archiveDocument(row)).archived, true);
  const patch = f.state.requests.at(-1);
  for (const key of ['id', 'user_id', 'name', 'file_path', 'file_size', 'content_sha256', 'updated_at']) assert.equal(patch.url.searchParams.get(key), `eq.${initial[key]}`);
  assert.equal(patch.url.searchParams.get('archived'), 'eq.false');
  assert.deepEqual(JSON.parse(patch.body), { archived: true });
});

test('lost archive reply reconciles only archived same identity, allowing server timestamp change', async () => {
  const f = fixture(); const cloud = await f.create(); const row = await cloud.readDocument(documentId);
  f.state.responder = (request, normal) => {
    if (request.method === 'PATCH') { f.state.row.archived = true; f.state.row.updated_at = '2026-09-08T13:00:00.000Z'; throw new TypeError('Failed to fetch'); }
    return normal();
  };
  assert.equal((await cloud.archiveDocument(row)).archived, true);
  assert.deepEqual(f.state.requests.map(request => request.method), ['GET', 'PATCH', 'GET']);
});

for (const change of [{ name: 'Different.pdf' }, { user_archived_at: '2026-09-08T14:00:00.000Z' }]) {
  test(`lost archive reply refuses changed ${Object.keys(change)[0]}`, async () => {
    const f = fixture(); const cloud = await f.create(); const row = await cloud.readDocument(documentId);
    f.state.responder = (request, normal) => {
      if (request.method === 'PATCH') { Object.assign(f.state.row, { archived: true }, change); throw new TypeError('Failed to fetch'); }
      return normal();
    };
    await assert.rejects(cloud.archiveDocument(row));
  });
}

test('definite archive permission denial does not issue reconciliation reads', async () => {
  const f = fixture(); const cloud = await f.create(); const row = await cloud.readDocument(documentId);
  f.state.responder = () => Response.json({ code: '42501', message: 'denied' }, { status: 403 });
  await assert.rejects(cloud.archiveDocument(row), error => error.code === '42501');
  assert.equal(f.state.requests.length, 2);
});

test('A -> B -> A retires the old adapter and aborts waiting rows', async () => {
  const f = fixture(); const cloud = await f.create(); const old = f.state.session; const gate = deferred();
  f.state.responder = () => gate.promise;
  const waiting = cloud.readDocument(documentId); await tick();
  f.emit('SIGNED_IN', { user: { id: otherId }, access_token: 'fixture-b' }); f.emit('SIGNED_IN', old);
  await assert.rejects(waiting, error => error.code === 'DOCUMENT_UPLOAD_RETIRED');
  assert.equal(f.state.requests[0].signal.aborted, true);
  await assert.rejects(cloud.uploadFile(path, pdf), error => error.code === 'DOCUMENT_UPLOAD_RETIRED');
  gate.resolve(Response.json([initial])); await tick();
  f.state.responder = null;
  assert.equal((await (await f.create()).readDocument(documentId)).id, documentId);
  assert.equal(f.state.listeners.size, 1);
});

test('same-session events and token refresh keep pinned Authorization', async () => {
  const f = fixture(); const cloud = await f.create();
  f.emit('INITIAL_SESSION', f.state.session); f.emit('SIGNED_IN', f.state.session);
  f.emit('TOKEN_REFRESHED', { user: { id: actorId }, access_token: 'fresh-token' });
  await cloud.uploadFile(path, pdf); await cloud.readDocument(documentId);
  assert.ok(f.state.requests.every(request => request.headers.get('authorization') === 'Bearer fixture-token-a'));
});

test('factory and each dispatch check account even without auth event', async () => {
  const f = fixture(); const cloud = await f.create();
  f.state.session = { user: { id: otherId }, access_token: 'fixture-b' };
  await assert.rejects(cloud.uploadFile(path, pdf)); await assert.rejects(cloud.readDocument(documentId));
  await assert.rejects(f.create());
  assert.equal(f.state.requests.length, 0);
});

test('auth lookup cancellation prevents a late row dispatch', async () => {
  const f = fixture(); const gate = deferred(); const controller = new AbortController();
  f.state.sessionReader = () => gate.promise;
  const pending = f.create({ signal: controller.signal }); await tick(); controller.abort();
  await assert.rejects(pending, error => error.code === 'DOCUMENT_UPLOAD_RETIRED');
  gate.resolve({ data: { session: f.state.session } }); await tick();
  assert.equal(f.state.requests.length, 0);
});

test('row timeout aborts fetch and rejects late results', async () => {
  const f = fixture(); const cloud = await f.create({ requestTimeoutMs: 15 }); const gate = deferred();
  f.state.responder = () => gate.promise;
  await assert.rejects(cloud.readDocument(documentId), error => error.code === 'DOCUMENT_UPLOAD_TIMEOUT');
  assert.equal(f.state.requests[0].signal.aborted, true);
  gate.resolve(Response.json([initial])); await tick();
});

test('logical repair timeout cannot issue late upload after held missing-object read', async () => {
  const f = fixture(); const cloud = await f.create({ uploadTimeoutMs: 15 }); const row = await cloud.readDocument(documentId); const gate = deferred();
  f.state.responder = () => gate.promise;
  await assert.rejects(cloud.ensureDocumentFile(row, pdf), error => error.code === 'DOCUMENT_UPLOAD_TIMEOUT');
  gate.resolve(storageError(404)); await tick();
  assert.ok(f.state.requests.every(request => request.method === 'GET'));
});

test('upload timeout leaves an unknown create-only result without late follow-up writes', async () => {
  const f = fixture(); const cloud = await f.create({ uploadTimeoutMs: 15 }); const gate = deferred();
  f.state.responder = () => gate.promise;
  await assert.rejects(cloud.uploadFile(path, pdf), error => error.code === 'DOCUMENT_UPLOAD_TIMEOUT');
  assert.equal(f.state.requests[0].signal, undefined, 'installed upload SDK lacks transport cancellation');
  gate.resolve(storageError(409)); await tick();
  assert.equal(f.state.requests.length, 1, 'late conflict cannot start a verification download');
});
