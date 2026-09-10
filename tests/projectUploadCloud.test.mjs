import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createProjectUploadCloud } from '../src/services/projectUploadCloud.js';
import { computeContentSha256 } from '../src/services/contentHash.js';
import { storageDownloads } from '../src/services/storageDownloads.js';

const actorId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const projectId = '33333333-3333-4333-8333-333333333333';
const documentId = '44444444-4444-4444-8444-444444444444';
const pdf = new Blob(['%PDF-1.7\nimmutable fixture'], { type: 'application/pdf' });
const sha = await computeContentSha256(await pdf.arrayBuffer());
const filePath = `${actorId}/${projectId}/${sha}.pdf`;
const project = { id: projectId, user_id: actorId, name: 'Fixture project' };
const document = { id: documentId, user_id: actorId, project_id: projectId, name: 'Fixture.pdf',
  file_path: filePath, file_size: pdf.size, content_sha256: sha, page_count: null, name_aliases: [], archived: false,
  user_archived_at: null, updated_at: '2026-09-08T12:00:00.000Z' };
const { user_archived_at: _archive, updated_at: _updated, ...documentInput } = document;
const tick = () => new Promise(setImmediate);
async function waitFor(check, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the fixture request boundary.');
    await tick();
  }
}
function deferred() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; }
function fixture() {
  const state = { session: { user: { id: actorId }, access_token: 'fixture-token-a' }, current: true, requests: [], listeners: new Set(), responder: null, sessionReader: null };
  const client = createClient('https://offline-fixture.invalid', 'fixture-publishable-not-a-secret', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url, init = {}) => {
      const request = { url: new URL(String(url)), ...init, headers: new Headers(init.headers) };
      state.requests.push(request);
      if (state.responder) return state.responder(request);
      if (request.url.pathname.includes('/storage/v1/')) return Response.json({ Id: 'object-id', Key: `documents/${filePath}` });
      const row = request.url.pathname.endsWith('/projects') ? project : document;
      return Response.json(request.method === 'GET' ? [row] : { ...row, ...JSON.parse(request.body) });
    } },
  });
  client.auth.getSession = () => state.sessionReader?.() ?? Promise.resolve({ data: { session: state.session }, error: null });
  client.auth.onAuthStateChange = callback => { state.listeners.add(callback); return { data: { subscription: { unsubscribe: () => state.listeners.delete(callback) } } }; };
  return { client, state, create: (options = {}) => createProjectUploadCloud({ client, actorId, tier: 'pro', isCurrent: () => state.current, ...options }),
    emit(event, session) { state.session = session; for (const callback of state.listeners) callback(event, session); } };
}

test('actual SDK project/document reads and creates are owner-scoped and token-pinned', async () => {
  const f = fixture(); const cloud = await f.create();
  assert.deepEqual(await cloud.readProject(projectId), project);
  assert.deepEqual(await cloud.createProject(project), project);
  const expected = await cloud.readDocument(documentId); assert.deepEqual(expected, document);
  assert.deepEqual(await cloud.findDocumentByHash(projectId, sha), document);
  assert.equal((await cloud.createDocument(documentInput)).id, documentId);
  assert.deepEqual(await cloud.updateDocument(documentId, { page_count: 2 }, expected), { ...document, page_count: 2 });
  assert.equal(f.state.requests.length, 6);
  for (const request of f.state.requests) {
    assert.equal(request.headers.get('authorization'), 'Bearer fixture-token-a');
    assert.ok(request.signal instanceof AbortSignal);
    if (request.method === 'GET' || request.method === 'PATCH') assert.equal(request.url.searchParams.get('user_id'), `eq.${actorId}`);
  }
  const inserted = JSON.parse(f.state.requests[4].body);
  assert.equal(inserted.first_opened_user_tier, 'pro'); assert.ok(inserted.first_opened_device); assert.ok(inserted.first_opened_app_version);
  assert.equal(f.state.requests[3].url.searchParams.get('project_id'), `eq.${projectId}`);
  assert.equal(f.state.requests[3].url.searchParams.get('content_sha256'), `eq.${sha}`);
});

test('reads preserve explicit null; mutations never turn zero rows into success', async () => {
  const f = fixture(); const cloud = await f.create(); f.state.responder = () => Response.json([]);
  assert.equal(await cloud.readProject(projectId), null); assert.equal(await cloud.readDocument(documentId), null);
  assert.equal(await cloud.findDocumentByHash(projectId, sha), null);
  await assert.rejects(cloud.createProject(project)); await assert.rejects(cloud.createDocument(documentInput));
  await assert.rejects(cloud.updateDocument(documentId, { page_count: 2 }));
});

test('HTTP/unique conflicts remain errors and never cause deletes or automatic unarchive', async () => {
  const f = fixture(); const cloud = await f.create();
  f.state.responder = () => Response.json({ message: 'duplicate key', code: '23505' }, { status: 409 });
  await assert.rejects(cloud.createDocument(documentInput), error => error.code === '23505');
  assert.equal(f.state.requests.length, 1); assert.equal(f.state.requests[0].method, 'POST');
  await assert.rejects(cloud.updateDocument(documentId, { archived: false }));
  assert.equal(f.state.requests.length, 1);
});

test('foreign owner, wrong destination, and path traversal fail closed', async () => {
  const f = fixture(); const cloud = await f.create();
  await assert.rejects(cloud.createProject({ ...project, user_id: otherId }));
  await assert.rejects(cloud.createDocument({ ...documentInput, user_id: otherId }));
  await assert.rejects(cloud.createDocument({ ...documentInput, file_path: `${otherId}/${projectId}/${sha}.pdf` }));
  await assert.rejects(cloud.uploadFile(`${actorId}/../${sha}.pdf`, pdf));
  await assert.rejects(cloud.uploadFile(`${actorId}/legacy.pdf`, pdf));
  assert.equal(f.state.requests.length, 0);
  f.state.responder = () => Response.json([{ ...project, user_id: otherId }]);
  await assert.rejects(cloud.readProject(projectId));
  f.state.responder = () => Response.json([{ ...document, project_id: otherId }]);
  await assert.rejects(cloud.findDocumentByHash(projectId, sha));
});

test('null/wrong actor session refuses factory without any HTTP request', async () => {
  const f = fixture(); f.state.session = null; await assert.rejects(f.create());
  f.state.session = { user: { id: otherId }, access_token: 'fixture-token-b' }; await assert.rejects(f.create());
  assert.equal(f.state.requests.length, 0);
});

test('account retirement during factory auth lookup rejects old same-actor result', async () => {
  const f = fixture(); const gate = deferred(); const old = f.state.session;
  f.state.sessionReader = () => gate.promise; const pending = f.create();
  f.emit('SIGNED_OUT', null); f.emit('SIGNED_IN', old);
  gate.resolve({ data: { session: old }, error: null }); await assert.rejects(pending);
  assert.equal(f.state.requests.length, 0);
});

test('current guard rejects retired methods before dispatch and late HTTP rows after dispatch', async () => {
  const f = fixture(); const cloud = await f.create(); f.state.current = false;
  await assert.rejects(cloud.readProject(projectId)); assert.equal(f.state.requests.length, 0);
  f.state.current = true; const gate = deferred(); f.state.responder = () => gate.promise;
  const pending = cloud.readDocument(documentId); await tick(); f.state.current = false;
  gate.resolve(Response.json([document])); await assert.rejects(pending);
});

test('upload verifies exact content path and uses SDK request-local header/create-only, invalidating only that path', async () => {
  const f = fixture(); const cloud = await f.create(); const gate = deferred();
  const downloads = storageDownloads(f.client);
  const old = downloads.read(actorId, filePath, () => gate.promise);
  const other = downloads.read(actorId, 'another-path', () => gate.promise);
  assert.equal(await cloud.uploadFile(filePath, pdf), filePath);
  const fresh = downloads.read(actorId, filePath, () => Promise.resolve('fresh'));
  assert.notStrictEqual(fresh, old); assert.strictEqual(downloads.read(actorId, 'another-path', () => Promise.resolve('unexpected')), other);
  assert.equal(await fresh, 'fresh'); gate.resolve('old'); await Promise.all([old, other]);
  const request = f.state.requests[0]; assert.equal(request.headers.get('authorization'), 'Bearer fixture-token-a');
  assert.equal(request.headers.get('x-upsert'), 'false'); assert.ok(request.body instanceof FormData);
  assert.equal(request.body.get('').size, pdf.size);
  await assert.rejects(cloud.uploadFile(filePath, new Blob(['wrong bytes'], { type: 'application/pdf' })));
  assert.equal(f.state.requests.length, 1);
});

test('storage HTTP errors and wrong server path never acknowledge an upload', async () => {
  const f = fixture(); const cloud = await f.create();
  f.state.responder = () => Response.json({ statusCode: '403', error: 'Forbidden', message: 'denied' }, { status: 403 });
  await assert.rejects(cloud.uploadFile(filePath, pdf));
  f.state.responder = () => Response.json({ Id: 'object-id', Key: 'documents/wrong-path' });
  await assert.rejects(cloud.uploadFile(filePath, pdf));
});

test('archived records remain visible for the engine to refuse instead of being recreated', async () => {
  const f = fixture(); const cloud = await f.create();
  f.state.responder = request => Response.json([{ ...(request.url.pathname.endsWith('/projects') ? project : document), archived: true }]);
  assert.equal((await cloud.readProject(projectId)).archived, true);
  assert.equal((await cloud.findDocumentByHash(projectId, sha)).archived, true);
  assert.match(f.state.requests[0].url.searchParams.get('select'), /archived/);
  assert.equal(f.state.requests.every(request => request.method === 'GET'), true);
});

test('factory abort settles before a held auth lookup and observes late rejection', async () => {
  const f = fixture(); const gate = deferred(); const controller = new AbortController();
  f.state.sessionReader = () => gate.promise;
  const pending = f.create({ signal: controller.signal }); await tick(); controller.abort();
  await assert.rejects(pending, error => error.code === 'PROJECT_UPLOAD_RETIRED');
  gate.reject(new Error('late auth fixture failure')); await tick(); assert.equal(f.state.requests.length, 0);
});

test('row deadline aborts fetch, rejects promptly and ignores late success', async () => {
  const f = fixture(); const cloud = await f.create({ requestTimeoutMs: 20 }); const gate = deferred();
  f.state.responder = () => gate.promise;
  await assert.rejects(cloud.readDocument(documentId), error => error.code === 'PROJECT_UPLOAD_TIMEOUT');
  assert.equal(f.state.requests.length, 1); assert.equal(f.state.requests[0].signal.aborted, true);
  gate.resolve(Response.json([document])); await tick();
  f.state.responder = null; assert.equal((await cloud.readDocument(documentId)).id, documentId);
});

test('upload deadline is logically bounded, leaves unknown remote work, and accepts exact safe retry', async () => {
  const f = fixture(); const cloud = await f.create({ uploadTimeoutMs: 20 }); const gate = deferred();
  f.state.responder = () => gate.promise;
  await assert.rejects(cloud.uploadFile(filePath, pdf), error => error.code === 'PROJECT_UPLOAD_TIMEOUT');
  assert.equal(f.state.requests.length, 1); assert.equal(f.state.requests[0].signal, undefined, 'installed upload SDK has no transport abort option');
  gate.reject(new Error('late storage fixture failure')); await tick();
  f.state.responder = null; assert.equal(await cloud.uploadFile(filePath, pdf), filePath);
  assert.equal(f.state.requests.length, 2); assert.equal(f.state.requests.every(request => request.method === 'POST'), true);
});

test('auth retirement aborts a waiting row and old factory stays retired after same actor returns', async () => {
  const f = fixture(); const oldSession = f.state.session; const cloud = await f.create(); const gate = deferred();
  f.state.responder = () => gate.promise;
  const pending = cloud.readDocument(documentId); await tick(); f.emit('SIGNED_OUT', null); f.emit('SIGNED_IN', oldSession);
  await assert.rejects(pending, error => error.code === 'PROJECT_UPLOAD_RETIRED');
  assert.equal(f.state.requests[0].signal.aborted, true);
  await assert.rejects(cloud.readDocument(documentId), error => error.code === 'PROJECT_UPLOAD_RETIRED');
  gate.resolve(Response.json([document])); await tick();
  f.state.responder = null; const fresh = await f.create(); assert.equal((await fresh.readDocument(documentId)).id, documentId);
});

test('a changed session is checked again before each operation even without an auth event', async () => {
  const f = fixture(); const cloud = await f.create();
  f.state.session = { user: { id: otherId }, access_token: 'fixture-token-b' };
  await assert.rejects(cloud.createProject(project)); await assert.rejects(cloud.uploadFile(filePath, pdf));
  assert.equal(f.state.requests.length, 0);
});

test('same-session notices and token refresh keep factory valid without changing its pinned token', async () => {
  const f = fixture(); const cloud = await f.create();
  f.emit('SIGNED_IN', f.state.session);
  f.emit('TOKEN_REFRESHED', { user: { id: actorId }, access_token: 'fixture-refreshed-token' });
  f.emit('SIGNED_IN', f.state.session);
  assert.equal((await cloud.readProject(projectId)).id, projectId);
  assert.equal(f.state.requests[0].headers.get('authorization'), 'Bearer fixture-token-a');
  await f.create(); assert.equal(f.state.listeners.size, 1, 'one auth listener per client, not per factory/file');
});

test('SDK async token lookup crossing account never replaces the captured storage JWT', async () => {
  const f = fixture(); const cloud = await f.create(); const gate = deferred(); let sessionReads = 0;
  f.state.responder = () => gate.promise;
  f.state.sessionReader = () => {
    sessionReads++;
    if (sessionReads === 2) f.emit('SIGNED_IN', { user: { id: otherId }, access_token: 'fixture-token-b' });
    return Promise.resolve({ data: { session: f.state.session }, error: null });
  };
  const pending = cloud.uploadFile(filePath, pdf);
  await assert.rejects(pending, error => error.code === 'PROJECT_UPLOAD_RETIRED'); await tick();
  assert.equal(f.state.requests.length, 1); assert.equal(f.state.requests[0].headers.get('authorization'), 'Bearer fixture-token-a');
  gate.resolve(Response.json({ Id: 'object-id', Key: `documents/${filePath}` })); await tick();
});

test('update acknowledgements must contain requested metadata and hash lookup ambiguity fails', async () => {
  const f = fixture(); const cloud = await f.create();
  const expected = await cloud.readDocument(documentId);
  f.state.responder = () => Response.json(document);
  await assert.rejects(cloud.updateDocument(documentId, { name_aliases: ['second.pdf'] }, expected));
  f.state.responder = () => Response.json([document, { ...document, id: otherId }]);
  await assert.rejects(cloud.findDocumentByHash(projectId, sha));
});

test('validated update payload cannot gain archive/path fields while auth waits', async () => {
  const f = fixture(); const cloud = await f.create(); const gate = deferred();
  const expected = await cloud.readDocument(documentId);
  f.state.sessionReader = () => gate.promise;
  const patch = { name_aliases: ['original.pdf'] }; const pending = cloud.updateDocument(documentId, patch, expected); await tick();
  patch.archived = false; patch.file_path = 'unexpected'; patch.name_aliases.push('late.pdf');
  gate.resolve({ data: { session: f.state.session }, error: null }); await pending;
  assert.deepEqual(JSON.parse(f.state.requests[1].body), { name_aliases: ['original.pdf'] });
});

const storageConflict = () => Response.json({ code: 'ResourceAlreadyExists', message: 'already exists' }, { status: 409 });
test('create-only conflict acknowledges only downloaded matching bytes with pinned JWT and real abort', async () => {
  const f = fixture(); const cloud = await f.create();
  f.state.responder = request => request.method === 'POST' ? storageConflict() : new Response(pdf);
  assert.equal(await cloud.uploadFile(filePath, pdf), filePath);
  assert.equal(f.state.requests.length, 2);
  const [upload, download] = f.state.requests;
  assert.equal(upload.headers.get('x-upsert'), 'false'); assert.equal(download.method, 'GET');
  assert.equal(download.headers.get('authorization'), 'Bearer fixture-token-a');
  assert.ok(download.signal instanceof AbortSignal); assert.equal(download.cache, 'no-store');
});

test('preexisting edited PDF is never overwritten and a different hash or size remains a conflict', async () => {
  const f = fixture(); const cloud = await f.create(); let object = new Blob(['USER EDIT']); let overwritten = false;
  f.state.responder = async request => {
    if (request.method === 'POST') {
      if (request.headers.get('x-upsert') === 'true') { overwritten = true; object = request.body.get(''); return Response.json({ Id: 'object-id', Key: `documents/${filePath}` }); }
      return storageConflict();
    }
    return new Response(object);
  };
  await assert.rejects(cloud.uploadFile(filePath, pdf), error => error.code === 'PROJECT_UPLOAD_CONFLICT');
  assert.equal(overwritten, false); assert.equal(await object.text(), 'USER EDIT');
  object = new Blob(['x'.repeat(pdf.size)]);
  await assert.rejects(cloud.uploadFile(filePath, pdf), error => error.code === 'PROJECT_UPLOAD_CONFLICT');
});

test('a late post-timeout create cannot replace an object edited before it reaches storage', async () => {
  const f = fixture(); const cloud = await f.create({ uploadTimeoutMs: 20 }); const gate = deferred(); let object = null;
  f.state.responder = async request => {
    if (request.method === 'POST') {
      await gate.promise;
      if (object && request.headers.get('x-upsert') !== 'true') return storageConflict();
      object = request.body.get(''); return Response.json({ Id: 'object-id', Key: `documents/${filePath}` });
    }
    return new Response(object);
  };
  await assert.rejects(cloud.uploadFile(filePath, pdf), error => error.code === 'PROJECT_UPLOAD_TIMEOUT');
  object = new Blob(['USER EDIT']); gate.resolve(); await tick(); await tick();
  assert.equal(await object.text(), 'USER EDIT');
  await assert.rejects(cloud.uploadFile(filePath, pdf), error => error.code === 'PROJECT_UPLOAD_CONFLICT');
  assert.equal(await object.text(), 'USER EDIT');
});

test('metadata update requires exact issued read proof and captures all row guards', async () => {
  const f = fixture(); const cloud = await f.create();
  await assert.rejects(cloud.updateDocument(documentId, { page_count: 2 })); assert.equal(f.state.requests.length, 0);
  const row = await cloud.readDocument(documentId);
  await assert.rejects(cloud.updateDocument(documentId, { page_count: 2 }, { ...row }));
  await cloud.updateDocument(documentId, { page_count: 2 }, row);
  const params = f.state.requests.at(-1).url.searchParams;
  for (const key of ['id', 'user_id', 'project_id', 'content_sha256', 'file_path', 'file_size', 'updated_at', 'archived']) assert.equal(params.get(key), `eq.${document[key]}`);
  assert.equal(params.get('page_count'), 'is.null'); assert.equal(params.get('user_archived_at'), 'is.null');
});

test('unchanged timestamp cannot let old page count overwrite a newer count', async () => {
  const f = fixture(); const cloud = await f.create(); const row = await cloud.readDocument(documentId); let count = 9;
  f.state.responder = request => {
    const matches = request.url.searchParams.get('page_count') === `eq.${count}`;
    if (!matches) return Response.json([]);
    count = JSON.parse(request.body).page_count; return Response.json({ ...document, page_count: count });
  };
  await assert.rejects(cloud.updateDocument(documentId, { page_count: 2 }, row), error => error.code === 'PROJECT_UPLOAD_CONFLICT');
  assert.equal(count, 9);
});

test('aliases use an exact escaped PostgreSQL text array and stale addition cannot erase concurrent names', async () => {
  const f = fixture(); const cloud = await f.create();
  const aliases = ['a,b.pdf', 'quote".pdf', 'slash\\.pdf'];
  f.state.responder = () => Response.json([{ ...document, name_aliases: aliases }]);
  const row = await cloud.readDocument(documentId);
  f.state.responder = request => Response.json({ ...document, ...JSON.parse(request.body) });
  await cloud.updateDocument(documentId, { name_aliases: [...aliases, 'next.pdf'] }, row);
  assert.equal(f.state.requests.at(-1).url.searchParams.get('name_aliases'), 'eq.{"a,b.pdf","quote\\".pdf","slash\\\\.pdf"}');
  f.state.responder = () => Response.json([]);
  await assert.rejects(cloud.updateDocument(documentId, { name_aliases: ['stale.pdf'] }, row), error => error.code === 'PROJECT_UPLOAD_CONFLICT');
});

test('lost upload reply retries create-only and verifies existing bytes without another write', async () => {
  const f = fixture(); const cloud = await f.create(); let object; let writes = 0;
  f.state.responder = request => {
    if (request.method === 'GET') return new Response(object);
    if (object) return storageConflict();
    object = request.body.get(''); writes++; throw new Error('lost committed upload response');
  };
  await assert.rejects(cloud.uploadFile(filePath, pdf));
  assert.equal(await cloud.uploadFile(filePath, pdf), filePath); assert.equal(writes, 1);
  assert.equal(f.state.requests.filter(request => request.method === 'POST').every(request => request.headers.get('x-upsert') === 'false'), true);
});

test('conflict verification download aborts on retirement and cannot acknowledge late bytes', async () => {
  const f = fixture(); const controller = new AbortController(); const cloud = await f.create({ signal: controller.signal }); const gate = deferred();
  f.state.responder = request => request.method === 'POST' ? storageConflict() : gate.promise;
  const pending = cloud.uploadFile(filePath, pdf);
  try {
    await waitFor(() => f.state.requests.length === 2);
    assert.equal(f.state.requests.length, 2); controller.abort();
    await assert.rejects(pending, error => error.code === 'PROJECT_UPLOAD_RETIRED');
    assert.equal(f.state.requests[1].signal.aborted, true);
  } finally {
    controller.abort();
    gate.resolve(new Response(pdf));
    await pending.catch(() => {});
    await tick();
  }
});

test('empty alias CAS refuses to erase concurrent names even without a timestamp change', async () => {
  const f = fixture(); const cloud = await f.create(); const row = await cloud.readDocument(documentId);
  let aliases = ['concurrent.pdf'];
  f.state.responder = request => {
    assert.equal(request.url.searchParams.get('name_aliases'), 'eq.{}');
    if (request.url.searchParams.get('name_aliases') !== `eq.{"${aliases.join('","')}"}`) return Response.json([]);
    aliases = JSON.parse(request.body).name_aliases; return Response.json({ ...document, name_aliases: aliases });
  };
  await assert.rejects(cloud.updateDocument(documentId, { name_aliases: ['stale.pdf'] }, row), error => error.code === 'PROJECT_UPLOAD_CONFLICT');
  assert.deepEqual(aliases, ['concurrent.pdf']);
});

test('null alias CAS uses is.null and a mutated issued row cannot change private proof', async () => {
  const f = fixture(); const cloud = await f.create();
  f.state.responder = () => Response.json([{ ...document, name_aliases: null }]); const row = await cloud.readDocument(documentId);
  row.name_aliases = ['not-the-read.pdf']; row.project_id = otherId;
  f.state.responder = request => Response.json({ ...document, ...JSON.parse(request.body) });
  await cloud.updateDocument(documentId, { name_aliases: ['new.pdf'] }, row);
  assert.equal(f.state.requests.at(-1).url.searchParams.get('name_aliases'), 'is.null');
  assert.equal(f.state.requests.at(-1).url.searchParams.get('project_id'), `eq.${projectId}`);
});

test('document path must match its exact project and old shared hash paths are forbidden', async () => {
  const f = fixture(); const cloud = await f.create();
  await assert.rejects(cloud.createDocument({ ...documentInput, file_path: `${actorId}/${otherId}/${sha}.pdf` }));
  await assert.rejects(cloud.uploadFile(`${actorId}/${sha}.pdf`, pdf));
  await assert.rejects(cloud.uploadFile(`${actorId}/not-a-project/${sha}.pdf`, pdf));
  assert.equal(f.state.requests.length, 0);
  f.state.responder = () => Response.json([{ ...document, file_path: `${actorId}/${otherId}/${sha}.pdf` }]);
  await assert.rejects(cloud.readDocument(documentId));
});

test('other-project edit between upload and row insert cannot change this new project object', async () => {
  const f = fixture(); const cloud = await f.create(); const otherPath = `${actorId}/${otherId}/${sha}.pdf`;
  const objects = new Map([[otherPath, pdf], [`${actorId}/${sha}.pdf`, pdf]]);
  f.state.responder = request => {
    if (request.url.pathname.startsWith('/storage/v1/object/documents/')) {
      const path = request.url.pathname.slice('/storage/v1/object/documents/'.length);
      assert.equal(request.method, 'POST', 'fresh project namespace must not read another project object');
      assert.equal(request.headers.get('x-upsert'), 'false');
      if (objects.has(path)) return storageConflict();
      objects.set(path, request.body.get('')); return Response.json({ Id: 'object-id', Key: `documents/${path}` });
    }
    objects.set(otherPath, new Blob(['OTHER PROJECT USER EDIT']));
    objects.set(`${actorId}/${sha}.pdf`, new Blob(['OLD SHARED PATH USER EDIT']));
    return Response.json({ ...document, ...JSON.parse(request.body) });
  };
  assert.equal(await cloud.uploadFile(filePath, pdf), filePath);
  const inserted = await cloud.createDocument(documentInput);
  assert.equal(inserted.file_path, filePath);
  assert.equal(await computeContentSha256(await objects.get(inserted.file_path).arrayBuffer()), sha);
  assert.equal(await objects.get(otherPath).text(), 'OTHER PROJECT USER EDIT');
  assert.equal(f.state.requests.length, 2);
});
