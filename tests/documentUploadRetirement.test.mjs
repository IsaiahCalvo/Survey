import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { createClient } from '@supabase/supabase-js';
import { createDocumentUploadJournal } from '../src/services/documentUploadJournal.js';
import { createDocumentUploadCloud } from '../src/services/documentUploadCloud.js';
import { stageDocumentUpload, runDocumentUpload } from '../src/home/documentUploadRecovery.js';

const actorId = '11111111-1111-4111-8111-111111111111';
const contents = '%PDF-1.7\nretired document fixture';
function locks() {
  const queue = new Map();
  return { request(name, _options, work) {
    const next = (queue.get(name) || Promise.resolve()).catch(() => {}).then(work);
    queue.set(name, next); return next;
  } };
}

// Real journal, runner, cloud adapter and SDK. Only the remote HTTP boundary
// is simulated. PostgreSQL tests separately prove the actual retirement fence.
async function fixture(t, retirementError = { code: '23514', message: 'DOCUMENT_ID_RETIRED' }) {
  const rows = new Map(), objects = new Map(), retiredIds = new Set(), requests = [];
  let commits = 0;
  const journal = createDocumentUploadJournal({ indexedDB: new IDBFactory(), dbName: `retired-upload-${crypto.randomUUID()}` });
  t.after(() => journal.close());
  const client = createClient('https://offline-fixture.invalid', 'fixture-publishable-not-secret', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init = {}) => {
      const url = new URL(String(input)), method = init.method || 'GET';
      requests.push({ method, path: url.pathname, query: url.search });
      if (url.pathname.includes('/storage/v1/object/')) {
        const key = decodeURIComponent(url.pathname.split('/storage/v1/object/documents/')[1]);
        if (method === 'GET') {
          assert.ok(objects.has(key)); return new Response(objects.get(key));
        }
        if (objects.has(key)) return Response.json({ statusCode: '409', error: 'ResourceAlreadyExists' }, { status: 409 });
        objects.set(key, init.body.get(''));
        return Response.json({ Id: key, Key: `documents/${key}` });
      }
      assert.equal(url.pathname, '/rest/v1/documents');
      if (method === 'GET') {
        const found = [...rows.values()].filter(row => [...url.searchParams].every(([key, value]) => ['select', 'limit'].includes(key)
          || (value === 'is.null' ? row[key] === null : value === `eq.${row[key]}`)));
        return Response.json(found.map(row => Object.fromEntries(url.searchParams.get('select').split(',').filter(key => key in row).map(key => [key, row[key]]))));
      }
      assert.equal(method, 'POST', 'retry must not use an alternate mutation');
      const row = { ...JSON.parse(init.body), user_archived_at: null, name_aliases: [], updated_at: '2026-09-08T00:00:00Z' };
      if (retiredIds.has(row.id)) return Response.json(retirementError, { status: 400 });
      rows.set(row.id, row); commits++;
      // The insert succeeded, but another device deletes before any reply or
      // follow-up read can establish the local document-confirmed receipt.
      retiredIds.add(row.id); rows.delete(row.id);
      return Response.json({ code: '08006', message: 'fixture insert reply lost' }, { status: 503 });
    } },
  });
  client.auth.getSession = async () => ({ data: { session: { user: { id: actorId }, access_token: 'fixture-token' } }, error: null });
  client.auth.onAuthStateChange = () => ({ data: { subscription: { unsubscribe() {} } } });
  const cloud = await createDocumentUploadCloud({ client, actorId, tier: 'pro', isCurrent: () => true });
  const options = { actorId, projectId: null, journal, cloud, locks: locks(), isCurrent: () => true,
    prepareFile: async file => ({ file, contentSha: createHash('sha256').update(new Uint8Array(await file.arrayBuffer())).digest('hex') }) };
  const attemptId = await stageDocumentUpload({ ...options, file: new File([contents], 'retired.pdf', { type: 'application/pdf' }) });
  const initial = await journal.get(actorId, attemptId);
  return { journal, attemptId, initial, requests, rows, objects, retiredIds, commits: () => commits,
    run: () => runDocumentUpload({ ...options, attemptId }) };
}

test('lost insert reply then independent deletion: retired server ID stops retry without fallback and keeps exact saved upload', async t => {
  const f = await fixture(t);
  await assert.rejects(f.run(), error => error.code === 'upload-pending' && error.cause?.code === '08006');
  const pending = await f.journal.get(actorId, f.attemptId);
  assert.equal(pending.phase, 'running'); assert.equal(pending.target.id, f.initial.documentId);
  assert.equal(f.rows.size, 0); assert.equal(f.commits(), 1); assert.ok(f.retiredIds.has(f.initial.documentId));
  f.requests.length = 0;
  await assert.rejects(f.run(), error => error.code === 'cloud-document-deleted'
    && /cloud document was deleted/i.test(error.message) && /saved upload.*kept/i.test(error.message)
    && error.attemptId === f.attemptId && error.cause?.code === '23514');
  assert.equal(f.requests.at(-1).method, 'POST', 'retired response is terminal: no read/hash fallback after it');
  assert.equal(f.requests.at(-1).path, '/rest/v1/documents');
  assert.equal(f.requests.filter(request => request.query.includes('content_sha256=')).length, 0, 'never adopts another hash winner');
  const retained = await f.journal.get(actorId, f.attemptId);
  assert.equal(retained.id, pending.id); assert.equal(retained.documentId, pending.documentId);
  assert.equal(retained.phase, 'running'); assert.deepEqual(retained.target, pending.target);
  assert.match(retained.error, /cloud document was deleted/i);
  assert.equal(await (await f.journal.readFile(actorId, f.attemptId)).text(), contents);
  assert.equal(f.commits(), 1); assert.equal(f.rows.size, 0); assert.equal(f.objects.size, 1);
});

for (const retirementError of [
  { code: '23514', message: 'some_other_check_constraint' },
  { code: '42501', message: 'DOCUMENT_ID_RETIRED' },
  { code: '23514', message: 'DOCUMENT_ID_RETIRED extra detail' },
]) test(`only the exact retirement pair is terminal, not ${JSON.stringify(retirementError)}`, async t => {
  const f = await fixture(t, retirementError);
  await assert.rejects(f.run(), { code: 'upload-pending' });
  f.requests.length = 0;
  await assert.rejects(f.run(), error => error.code === 'upload-pending'
    && error.cause?.code === retirementError.code && error.cause?.message === retirementError.message);
  assert.equal(f.requests.at(-1).method, 'GET', 'ordinary constraint failure retains existing uncertain-insert reconciliation');
  const pending = await f.journal.get(actorId, f.attemptId);
  assert.doesNotMatch(pending.error, /cloud document was deleted/i);
  assert.equal(pending.documentId, f.initial.documentId); assert.equal(pending.phase, 'running');
  assert.equal(await (await f.journal.readFile(actorId, f.attemptId)).text(), contents);
  assert.equal(f.commits(), 1); assert.equal(f.rows.size, 0);
});
