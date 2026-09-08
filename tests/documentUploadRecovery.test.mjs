import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { preparePdfUpload } from '../src/home/pdfUploadWork.js';
import { IDBFactory } from 'fake-indexeddb';
import { createDocumentUploadJournal } from '../src/services/documentUploadJournal.js';
import { stageDocumentUpload, runDocumentUpload, withDocumentUploadLock } from '../src/home/documentUploadRecovery.js';

const actorId = '11111111-1111-4111-8111-111111111111';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pdf = () => new File(['%PDF original'], 'plan.pdf', { type: 'application/pdf', lastModified: 123 });
const prepareFile = file => preparePdfUpload(file, { readBlobAsArrayBuffer: blob => blob.arrayBuffer(),
  computeContentSha256: async bytes => createHash('sha256').update(bytes).digest('hex') });
const clone = value => structuredClone(value);
function locks() {
  const queue = new Map();
  return { request(name, options, work) {
    assert.match(name, /^survey:document-upload(?::|-content:)/); assert.deepEqual(options, { mode: 'exclusive' });
    const next = (queue.get(name) || Promise.resolve()).catch(() => {}).then(work); queue.set(name, next); return next;
  } };
}
function fixture() {
  let sequence = 0, valid = true;
  const records = new Map(), bytes = new Map(), documents = new Map(), uploads = new Map(), events = [];
  const makeJournal = () => ({
    async create(actor, input, blob) { records.set(input.id, { ...clone(input), actorId: actor, phase: 'ready', target: null, aliasName: null, aliasDecided: false, error: null }); bytes.set(input.id, blob); },
    async get(actor, id) { return records.get(id)?.actorId === actor ? clone(records.get(id)) : null; },
    async readFile(actor, id) { return records.get(id)?.actorId === actor ? bytes.get(id) : null; },
    async patch(actor, id, patch) { assert.equal(records.get(id).actorId, actor); Object.assign(records.get(id), clone(patch)); return clone(records.get(id)); },
    async finish(actor, id) { assert.equal(records.get(id).phase, 'complete'); records.delete(id); bytes.delete(id); },
  });
  const cloud = {
    async readProject(id) { events.push('readProject'); return { id, user_id: actorId, archived: false, user_archived_at: null }; },
    async readDocument(id) { events.push('readDocument'); return clone(documents.get(id) || null); },
    async findDocumentByHash(project, hash) { events.push('findDocumentByHash'); return clone([...documents.values()].find(row => row.project_id === project && row.content_sha256 === hash) || null); },
    async uploadFile(path, blob) { events.push('uploadFile'); if (!uploads.has(path)) uploads.set(path, blob); return path; },
    async createDocument(row) { events.push('createDocument'); const saved = { ...row, updated_at: '2026-09-08T00:00:00Z', user_archived_at: null }; documents.set(row.id, saved); return clone(saved); },
    async ensureDocumentFile(row, blob) { events.push('ensureDocumentFile'); if (!uploads.has(row.file_path)) uploads.set(row.file_path, blob); return uploads.get(row.file_path); },
    async reviveDocument(row) { events.push('reviveDocument'); documents.get(row.id).archived = false; return clone(documents.get(row.id)); },
    async addAlias(row, name) { events.push('addAlias'); documents.get(row.id).name_aliases = [...new Set([...(row.name_aliases || []), name])]; return clone(documents.get(row.id)); },
    async archiveDocument(row) { events.push('archiveDocument'); documents.get(row.id).archived = true; return clone(documents.get(row.id)); },
    async readPageCount() { events.push('readPageCount'); return 2; },
  };
  const context = { actorId, projectId: null, journal: makeJournal(), cloud, prepareFile, makeId: () => uuid(++sequence), isCurrent: () => valid, locks: locks() };
  return { context, records, bytes, documents, uploads, events, retire: () => { valid = false; },
    stage: extra => stageDocumentUpload({ ...context, file: pdf(), ...extra }),
    restart() { context.journal = makeJournal(); },
    async existing(extra = {}) { const prepared = await prepareFile(pdf()); const row = { id: uuid(99), user_id: actorId, project_id: null, name: 'plan.pdf', content_sha256: prepared.contentSha, file_path: `${actorId}/legacy.pdf`, file_size: 900, archived: false, user_archived_at: null, updated_at: '2026-09-08T00:00:00Z', ...extra }; documents.set(row.id, row); uploads.set(row.file_path, new Blob(['newer published bytes'])); return row; },
  };
}

test('stage owns bytes and stable IDs before any cloud call; restart completes a null-project upload', async () => {
  const f = fixture(); const id = await f.stage(); const staged = clone(f.records.get(id));
  assert.equal(await f.bytes.get(id).text(), '%PDF original'); assert.deepEqual(f.events, []);
  assert.equal(staged.filePath, `${actorId}/${staged.documentId}/${staged.contentSha}.pdf`);
  f.restart(); const result = await runDocumentUpload({ ...f.context, attemptId: id });
  assert.equal(result.document.id, staged.documentId); assert.equal(result.complete, true); assert.equal(result.reused, false);
  assert.equal(f.records.size, 0); assert.equal(f.bytes.size, 0); assert.equal(f.documents.size, 1);
  assert.equal(f.events.filter(event => event === 'ensureDocumentFile').length, 1, 'ordinary uploads need only one published-byte read');
});

for (const point of ['uploadFile', 'createDocument', 'archiveDocument']) test(`restart preserves identity after ${point} fails or loses its reply`, async () => {
  const f = fixture(); const old = await f.existing({ content_sha256: 'a'.repeat(64) });
  const id = await f.stage({ archiveDocument: old }); const initial = clone(f.records.get(id));
  const original = f.context.cloud[point];
  f.context.cloud[point] = async (...args) => { await original(...args); throw new Error('reply lost'); };
  // A row commit can be reconciled immediately; force that read to fail too.
  const read = f.context.cloud.readDocument;
  if (point === 'createDocument') f.context.cloud.readDocument = async target => { if (f.documents.has(initial.documentId)) throw new Error('offline'); return read(target); };
  if (point === 'archiveDocument') f.context.cloud.readDocument = async target => { if (f.documents.get(old.id)?.archived) throw new Error('offline'); return read(target); };
  await assert.rejects(runDocumentUpload({ ...f.context, attemptId: id }));
  assert.ok(f.records.has(id)); assert.ok(f.bytes.has(id));
  f.restart(); f.context.cloud[point] = original; f.context.cloud.readDocument = read;
  const result = await runDocumentUpload({ ...f.context, attemptId: id });
  assert.equal(result.document.id, initial.documentId); assert.equal(f.documents.size, 2); assert.equal(f.documents.get(old.id).archived, true);
});

test('published dedup uses current bytes without upload, parser, or page-count mutation', async () => {
  const f = fixture(); const old = await f.existing(); const id = await f.stage();
  const result = await runDocumentUpload({ ...f.context, attemptId: id });
  assert.equal(result.document.id, old.id); assert.equal(result.reused, true); assert.equal(await result.file.text(), 'newer published bytes');
  assert.equal(f.events.includes('uploadFile'), false); assert.equal(f.events.includes('readPageCount'), false);
});

test('alias choice is saved before mutation and never asked twice after restart', async () => {
  const f = fixture(); await f.existing({ name: 'other.pdf' }); const id = await f.stage(); let asks = 0;
  const add = f.context.cloud.addAlias; f.context.cloud.addAlias = async () => { throw new Error('offline'); };
  const chooseAlias = async () => { asks++; return true; };
  await assert.rejects(runDocumentUpload({ ...f.context, attemptId: id, chooseAlias }));
  assert.equal(f.records.get(id).aliasDecided, true); assert.equal(f.records.get(id).aliasName, 'plan.pdf');
  f.restart(); f.context.cloud.addAlias = add;
  await runDocumentUpload({ ...f.context, attemptId: id, chooseAlias }); assert.equal(asks, 1);
});

test('an already-known alias reuses the document without asking or rewriting aliases', async () => {
  const f = fixture();
  const existing = await f.existing({ name: 'canonical.pdf', name_aliases: ['plan.pdf', 'other.pdf'] });
  const id = await f.stage(); let asks = 0;
  const result = await runDocumentUpload({ ...f.context, attemptId: id,
    chooseAlias: async () => { asks++; return true; } });
  assert.equal(asks, 0, 'an existing alias needs no new consent');
  assert.equal(f.events.includes('addAlias'), false, 'existing aliases are not rewritten');
  assert.equal(result.document.id, existing.id);
  assert.equal(result.reused, true);
  assert.deepEqual(f.documents.get(existing.id).name_aliases, ['plan.pdf', 'other.pdf']);
  assert.equal(f.records.has(id), false);
  assert.equal(f.bytes.has(id), false);
});

test('same-size published edits during alias choice refresh preview even without a row timestamp change', async () => {
  const f = fixture(); const row = await f.existing({ name: 'canonical.pdf', name_aliases: [] });
  const id = await f.stage();
  const newer = new Blob(['fresh published bytes']);
  assert.equal(newer.size, f.uploads.get(row.file_path).size);
  const result = await runDocumentUpload({ ...f.context, attemptId: id,
    chooseAlias: async () => { f.uploads.set(row.file_path, newer); return false; } });
  assert.equal(await result.file.text(), 'fresh published bytes');
  assert.equal(f.events.filter(event => event === 'ensureDocumentFile').length, 2);
});

test('row version changed during final preview fetch retains retry bytes instead of returning mixed state', async () => {
  const f = fixture(); const row = await f.existing({ name: 'canonical.pdf', name_aliases: [] });
  const id = await f.stage(); const ensure = f.context.cloud.ensureDocumentFile; let reads = 0;
  f.context.cloud.ensureDocumentFile = async (...args) => {
    const file = await ensure(...args);
    if (++reads === 2) f.documents.get(row.id).updated_at = '2026-09-08T04:00:00Z';
    return file;
  };
  await assert.rejects(runDocumentUpload({ ...f.context, attemptId: id, chooseAlias: async () => false }), { code: 'cloud-conflict' });
  assert.equal(reads, 2); assert.ok(f.records.has(id)); assert.ok(f.bytes.has(id));
  assert.notEqual(f.records.get(id).phase, 'complete');
});

test('replacement archive is preceded by confirmed bytes and followed by a fresh preview', async () => {
  const f = fixture(); const previous = await f.existing({ content_sha256: 'a'.repeat(64) });
  const id = await f.stage({ archiveDocument: previous }); const archive = f.context.cloud.archiveDocument;
  f.context.cloud.archiveDocument = async row => {
    const result = await archive(row);
    const target = [...f.documents.values()].find(value => value.id !== previous.id);
    f.uploads.set(target.file_path, new Blob(['published edit during archive']));
    return result;
  };
  const result = await runDocumentUpload({ ...f.context, attemptId: id });
  assert.equal(await result.file.text(), 'published edit during archive');
  assert.ok(f.events.indexOf('ensureDocumentFile') < f.events.indexOf('archiveDocument'));
  assert.equal(f.events.filter(event => event === 'ensureDocumentFile').length, 2);
});

test('changed row version after the first published-byte read refreshes without any prompt', async () => {
  const f = fixture(); const row = await f.existing(); const id = await f.stage();
  const ensure = f.context.cloud.ensureDocumentFile; let reads = 0;
  f.context.cloud.ensureDocumentFile = async (...args) => {
    const result = await ensure(...args);
    if (++reads === 1) {
      f.documents.get(row.id).updated_at = '2026-09-08T05:00:00Z';
      f.uploads.set(row.file_path, new Blob(['updated published version']));
    }
    return result;
  };
  const result = await runDocumentUpload({ ...f.context, attemptId: id });
  assert.equal(await result.file.text(), 'updated published version'); assert.equal(reads, 2);
});

test('missing alias callback keeps the attempt pending instead of silently dropping choice', async () => {
  const f = fixture(); await f.existing({ name: 'other.pdf' }); const id = await f.stage();
  await assert.rejects(runDocumentUpload({ ...f.context, attemptId: id }), { code: 'alias-choice-required' }); assert.ok(f.bytes.has(id));
});

test('deleted confirmed target is not recreated or rebound to a hash winner', async () => {
  const f = fixture(); const row = await f.existing({ name: 'other.pdf' }); const id = await f.stage();
  await assert.rejects(runDocumentUpload({ ...f.context, attemptId: id }));
  f.documents.delete(row.id); f.events.length = 0;
  await assert.rejects(runDocumentUpload({ ...f.context, attemptId: id }), { code: 'cloud-conflict' });
  assert.deepEqual(f.events, ['readDocument']); assert.ok(f.bytes.has(id));
});

test('user-archived dedup refuses revive and preserves data', async () => {
  const f = fixture(); await f.existing({ archived: true, user_archived_at: '2026-09-08T01:00:00Z' }); const id = await f.stage();
  await assert.rejects(runDocumentUpload({ ...f.context, attemptId: id }), { code: 'cloud-conflict' });
  assert.equal(f.events.includes('reviveDocument'), false); assert.ok(f.bytes.has(id));
});

test('changed replacement snapshot cannot archive a newer document', async () => {
  const f = fixture(); const old = await f.existing({ content_sha256: 'a'.repeat(64) }); const id = await f.stage({ archiveDocument: old });
  f.documents.get(old.id).updated_at = '2026-09-08T02:00:00Z';
  await assert.rejects(runDocumentUpload({ ...f.context, attemptId: id }), { code: 'cloud-conflict' });
  assert.equal(f.events.includes('archiveDocument'), false); assert.ok(f.bytes.has(id));
});

test('complete retry only cleans local data without network', async () => {
  const f = fixture(); const id = await f.stage(); const finish = f.context.journal.finish;
  f.context.journal.finish = async () => { throw new Error('disk error'); };
  await assert.rejects(runDocumentUpload({ ...f.context, attemptId: id }));
  assert.equal(f.records.get(id).phase, 'complete'); f.events.length = 0; f.context.journal.finish = finish;
  const result = await runDocumentUpload({ ...f.context, attemptId: id }); assert.equal(result.file, null); assert.deepEqual(f.events, []);
});

test('unavailable locks or failed atomic staging dispatch no cloud work', async () => {
  const f = fixture(); await assert.rejects(f.stage({ locks: null }), { code: 'locks-unavailable' }); assert.equal(f.records.size, 0);
  f.context.journal.create = async () => { throw new Error('quota / no IndexedDB'); };
  await assert.rejects(f.stage()); assert.deepEqual(f.events, []); assert.equal(f.records.size, 0);
});

test('same-attempt retries serialize and do not submit twice', async () => {
  const f = fixture(); const id = await f.stage();
  const results = await Promise.allSettled([runDocumentUpload({ ...f.context, attemptId: id }), runDocumentUpload({ ...f.context, attemptId: id })]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].reason.code, 'not-found');
  assert.equal(f.events.filter(event => event === 'uploadFile').length, 1);
});

for (const point of ['readProject', 'readDocument', 'findDocumentByHash', 'uploadFile', 'readPageCount', 'createDocument', 'ensureDocumentFile']) test(`retirement after ${point} dispatch stops the next action`, async () => {
  const f = fixture(); f.context.projectId = point === 'readProject' ? uuid(20) : null;
  if (point === 'ensureDocumentFile') await f.existing();
  const id = await f.stage(); const original = f.context.cloud[point];
  f.context.cloud[point] = async (...args) => { const result = await original(...args); f.retire(); return result; };
  await assert.rejects(runDocumentUpload({ ...f.context, attemptId: id }), { code: 'scope-changed' });
  assert.equal(f.events.at(-1), point); assert.ok(f.records.has(id)); assert.ok(f.bytes.has(id));
});

test('queued lock checks scope again before any work', async () => {
  const f = fixture(); let unlock; const barrier = new Promise(resolve => { unlock = resolve; });
  const id = uuid(1); const first = withDocumentUploadLock({ ...f.context, attemptId: id }, () => barrier);
  const second = withDocumentUploadLock({ ...f.context, attemptId: id }, () => assert.fail('retired work'));
  f.retire(); unlock(); await assert.rejects(first); await assert.rejects(second, { code: 'scope-changed' });
});

test('separate same-content attempts share a cross-tab lock and publish only once', async () => {
  const f = fixture(); const one = await f.stage(); const two = await f.stage();
  const results = await Promise.all([one, two].map(attemptId => runDocumentUpload({ ...f.context, attemptId })));
  assert.equal(f.events.filter(event => event === 'uploadFile').length, 1);
  assert.equal(f.events.filter(event => event === 'createDocument').length, 1);
  assert.equal(results[0].document.id, results[1].document.id); assert.equal(results[1].reused, true);
});

test('cross-device insert winner does not retarget a candidate whose object was uploaded', async () => {
  const f = fixture(); const id = await f.stage(); const before = clone(f.records.get(id));
  f.context.cloud.createDocument = async row => { f.documents.set(uuid(200), { ...row, id: uuid(200) }); throw new Error('23505'); };
  await assert.rejects(runDocumentUpload({ ...f.context, attemptId: id }), { code: 'cloud-conflict' });
  assert.equal(f.records.get(id).target.id, before.documentId); assert.ok(f.uploads.has(before.filePath)); assert.ok(f.bytes.has(id));
});

test('quota-archived row revives only after current bytes are verified', async () => {
  const f = fixture(); await f.existing({ archived: true }); const id = await f.stage();
  const result = await runDocumentUpload({ ...f.context, attemptId: id });
  assert.equal(result.document.archived, false); assert.ok(f.events.indexOf('ensureDocumentFile') < f.events.indexOf('reviveDocument'));
  assert.equal(f.events.includes('uploadFile'), false);
});

for (const point of ['reviveDocument', 'addAlias', 'archiveDocument']) test(`retirement after ${point} preserves the receipt and prevents later work`, async () => {
  const f = fixture(); let archiveDocument = null;
  if (point === 'reviveDocument') await f.existing({ archived: true });
  if (point === 'addAlias') await f.existing({ name: 'other.pdf' });
  if (point === 'archiveDocument') archiveDocument = await f.existing({ content_sha256: 'a'.repeat(64) });
  const id = await f.stage({ archiveDocument }); const original = f.context.cloud[point];
  f.context.cloud[point] = async (...args) => { const result = await original(...args); f.retire(); return result; };
  await assert.rejects(runDocumentUpload({ ...f.context, attemptId: id, chooseAlias: async () => true }), { code: 'scope-changed' });
  assert.equal(f.events.at(-1), point); assert.ok(f.records.has(id));
});

test('retirement during alias choice does not persist the answer or add it', async () => {
  const f = fixture(); await f.existing({ name: 'other.pdf' }); const id = await f.stage();
  await assert.rejects(runDocumentUpload({ ...f.context, attemptId: id, chooseAlias: async () => { f.retire(); return true; } }), { code: 'scope-changed' });
  assert.equal(f.records.get(id).aliasDecided, false); assert.equal(f.events.includes('addAlias'), false);
});

test('target-binding commit failure starts no storage or row write', async () => {
  const f = fixture(); const id = await f.stage(); const patch = f.context.journal.patch;
  f.context.journal.patch = async (...args) => { if (args[2].target) throw new Error('disk full'); return patch(...args); };
  await assert.rejects(runDocumentUpload({ ...f.context, attemptId: id }));
  assert.equal(f.events.includes('uploadFile'), false); assert.equal(f.events.includes('createDocument'), false); assert.ok(f.bytes.has(id));
});

for (const variant of ['new', 'dedup', 'archive', 'revive']) test(`actual IndexedDB journal survives connection restart and completes ${variant} flow`, async t => {
  const f = fixture(); const indexedDB = new IDBFactory(); let journal = createDocumentUploadJournal({ indexedDB });
  t.after(() => journal.close()); f.context.journal = journal;
  let archiveDocument = null;
  if (variant === 'dedup') await f.existing({ name: 'other.pdf' });
  if (variant === 'revive') await f.existing({ archived: true });
  if (variant === 'archive') archiveDocument = await f.existing({ content_sha256: 'a'.repeat(64) });
  const id = await f.stage({ archiveDocument }); const initial = await journal.get(actorId, id);
  journal.close(); journal = createDocumentUploadJournal({ indexedDB }); f.context.journal = journal;
  assert.equal(await (await journal.readFile(actorId, id)).text(), '%PDF original');
  const result = await runDocumentUpload({ ...f.context, attemptId: id, chooseAlias: async () => true });
  assert.equal(result.complete, true); assert.equal(await journal.get(actorId, id), null);
  assert.equal(result.document.id, ['dedup', 'revive'].includes(variant) ? uuid(99) : initial.documentId);
});

for (const point of ['uploadFile', 'createDocument', 'archiveDocument']) test(`actual journal retains bytes across ${point} failure and restart`, async t => {
  const f = fixture(); const indexedDB = new IDBFactory(); let journal = createDocumentUploadJournal({ indexedDB });
  t.after(() => journal.close()); f.context.journal = journal;
  const old = await f.existing({ content_sha256: 'a'.repeat(64) });
  const id = await f.stage({ archiveDocument: old }); const initial = await journal.get(actorId, id);
  const original = f.context.cloud[point];
  f.context.cloud[point] = async () => { throw new Error('offline'); };
  await assert.rejects(runDocumentUpload({ ...f.context, attemptId: id }));
  journal.close(); journal = createDocumentUploadJournal({ indexedDB }); f.context.journal = journal;
  assert.equal(await (await journal.readFile(actorId, id)).text(), '%PDF original');
  assert.equal((await journal.get(actorId, id)).documentId, initial.documentId);
  f.context.cloud[point] = original;
  const result = await runDocumentUpload({ ...f.context, attemptId: id });
  assert.equal(result.document.id, initial.documentId); assert.equal(await journal.get(actorId, id), null);
});

test('missing or archived existing project stops before upload and never creates a project', async () => {
  for (const project of [null, { id: uuid(20), user_id: actorId, archived: true, user_archived_at: null }]) {
    const f = fixture(); const id = await f.stage({ projectId: uuid(20) }); f.context.cloud.readProject = async () => project;
    await assert.rejects(runDocumentUpload({ ...f.context, attemptId: id }), { code: 'cloud-conflict' });
    assert.deepEqual(f.events, []); assert.ok(f.bytes.has(id));
  }
});

test('explicit writable proof allows an editor-shared project but keeps document and bytes actor-owned', async () => {
  const f = fixture(); const projectId = uuid(200); const projectOwner = uuid(201);
  f.context.cloud.readProject = async id => ({ id, user_id: projectOwner, archived: false,
    user_archived_at: null, uploadWritable: true });
  const attemptId = await f.stage({ projectId });
  const result = await runDocumentUpload({ ...f.context, attemptId });
  assert.equal(result.document.project_id, projectId);
  assert.equal(result.document.user_id, actorId);
  assert.ok(result.document.file_path.startsWith(`${actorId}/`));
  assert.equal(f.documents.size, 1);
  assert.equal(f.records.has(attemptId), false);
});

for (const uploadWritable of [undefined, false, 'true']) test(`shared project without literal writable proof (${String(uploadWritable)}) retains bytes without cloud writes`, async () => {
  const f = fixture(); const projectId = uuid(202);
  f.context.cloud.readProject = async id => ({ id, user_id: uuid(203), archived: false,
    user_archived_at: null, uploadWritable });
  const attemptId = await f.stage({ projectId });
  await assert.rejects(runDocumentUpload({ ...f.context, attemptId }), { code: 'cloud-conflict' });
  assert.equal(f.documents.size, 0); assert.equal(f.uploads.size, 0);
  assert.ok(f.records.has(attemptId)); assert.ok(f.bytes.has(attemptId));
});

test('retirement after each journal boundary dispatches no later cloud work or cleanup', async () => {
  for (const point of ['get', 'readFile', 'running', 'target', 'document-confirmed', 'aliasDecided', 'archive-confirmed', 'complete']) {
    const f = fixture(); const id = await f.stage(); let snapshot;
    const method = ['get', 'readFile'].includes(point) ? point : 'patch'; const original = f.context.journal[method];
    let triggered = false;
    f.context.journal[method] = async (...args) => {
      const result = await original(...args);
      const patch = args[2] || {};
      if (!triggered && (method !== 'patch' || patch.phase === point || point in patch)) {
        triggered = true; snapshot = [...f.events]; f.retire();
      }
      return result;
    };
    await assert.rejects(runDocumentUpload({ ...f.context, attemptId: id }), { code: 'scope-changed' });
    assert.equal(triggered, true, point); assert.deepEqual(f.events, snapshot, point); assert.ok(f.bytes.has(id), point);
  }
});

test('archive intent may never archive the resolved upload target itself', async () => {
  const f = fixture(); const row = await f.existing(); const id = await f.stage({ archiveDocument: row });
  await assert.rejects(runDocumentUpload({ ...f.context, attemptId: id }), { code: 'cloud-conflict' });
  assert.equal(f.events.includes('archiveDocument'), false); assert.equal(row.archived, false); assert.ok(f.bytes.has(id));
});

test('new row receipt commits before published-byte read; later deletion cannot recreate it', async () => {
  const f = fixture(); const id = await f.stage(); const initial = clone(f.records.get(id));
  f.context.cloud.ensureDocumentFile = async () => {
    assert.equal(f.records.get(id).phase, 'document-confirmed'); throw new Error('offline');
  };
  await assert.rejects(runDocumentUpload({ ...f.context, attemptId: id }));
  f.documents.delete(initial.documentId); f.events.length = 0;
  await assert.rejects(runDocumentUpload({ ...f.context, attemptId: id }), { code: 'cloud-conflict' });
  assert.deepEqual(f.events, ['readDocument']); assert.ok(f.bytes.has(id));
});
