import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { createProjectUploadJournal } from '../src/services/projectUploadJournal.js';
import { preparePdfUpload } from '../src/home/pdfUploadWork.js';
import { stageProjectUpload, resumeStaging, runProjectUpload, withProjectUploadLock } from '../src/home/projectUploadRecovery.js';

const actorId = '11111111-1111-4111-8111-111111111111';
const otherActor = '22222222-2222-4222-8222-222222222222';
const uuid = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const pdf = (name = 'plan.pdf', bytes = '%PDF-1.7\nplan') => new File([bytes], name, { type: 'application/pdf', lastModified: 1234 });
const prepareFile = file => preparePdfUpload(file, { readBlobAsArrayBuffer: blob => blob.arrayBuffer(),
  computeContentSha256: async bytes => createHash('sha256').update(bytes).digest('hex') });
function locks() {
  const queue = new Map(); const calls = [];
  return { calls, request(name, options, run) {
    assert.deepEqual(options, { mode: 'exclusive' }); calls.push(name);
    const previous = queue.get(name) || Promise.resolve();
    const result = previous.catch(() => {}).then(run); queue.set(name, result); return result;
  } };
}
function fixture(t) {
  const indexedDB = new IDBFactory(); let journal = createProjectUploadJournal({ indexedDB });
  t.after(() => journal.close());
  let next = 0; let valid = true;
  const projects = new Map(), documents = new Map(), uploads = new Map(), events = [];
  const cloud = {
    async readProject(id) { events.push(['readProject', id]); return structuredClone(projects.get(id) || null); },
    async createProject(row) { events.push(['createProject', row.id]); projects.set(row.id, { ...row }); return { ...row }; },
    async readDocument(id) { events.push(['readDocument', id]); return structuredClone(documents.get(id) || null); },
    async findDocumentByHash(projectId, hash) { events.push(['findDocumentByHash', projectId]); return structuredClone([...documents.values()].find(row => row.project_id === projectId && row.content_sha256 === hash) || null); },
    async uploadFile(path, blob) { events.push(['uploadFile', path]); uploads.set(path, await blob.text()); return path; },
    async createDocument(row) { events.push(['createDocument', row.id]); documents.set(row.id, { ...row }); return { ...row }; },
    async updateDocument(id, patch) { events.push(['updateDocument', id]); Object.assign(documents.get(id), patch); return structuredClone(documents.get(id)); },
    async readPageCount() { events.push(['readPageCount']); return 2; },
  };
  const context = { actorId, name: 'Plans', journal, prepareFile, makeId: () => uuid(++next), isCurrent: () => valid,
    locks: locks(), cloud };
  return { context, events, projects, documents, uploads, retire: () => { valid = false; },
    async stage(files = [pdf()]) { return stageProjectUpload({ ...context, files }); },
    restart() { journal.close(); journal = createProjectUploadJournal({ indexedDB }); context.journal = journal; },
  };
}

test('all bytes stage before network; success finishes the exact attempt and keeps cloud rows', async t => {
  const f = fixture(t); const attemptId = await f.stage();
  assert.deepEqual(f.events, []);
  const attempt = await f.context.journal.get(actorId, attemptId);
  assert.equal(attempt.phase, 'ready'); assert.equal(attempt.files[0].state, 'staged');
  const result = await runProjectUpload({ ...f.context, attemptId });
  assert.deepEqual(result, { attemptId, projectId: attempt.projectId, complete: true });
  assert.equal(await f.context.journal.get(actorId, attemptId), null);
  assert.equal(f.projects.size, 1); assert.equal(f.documents.size, 1); assert.equal(f.uploads.size, 1);
  assert.equal([...f.documents.keys()][0], attempt.files[0].documentId);
});

for (const operation of ['createProject', 'createDocument']) {
  test(`${operation} committed with lost response is reconciled without deletion or new IDs`, async t => {
    const f = fixture(t); const attemptId = await f.stage();
    const create = f.context.cloud[operation];
    f.context.cloud[operation] = async row => { await create(row); throw new Error('reply lost'); };
    await runProjectUpload({ ...f.context, attemptId });
    assert.equal(f.projects.size, 1); assert.equal(f.documents.size, 1);
    assert.equal(f.events.filter(([kind]) => kind === operation).length, 1);
  });
}

for (const failure of ['upload-reply-lost', 'document-rejected', 'document-reconcile-failed', 'project-reconcile-failed']) {
  test(`${failure} retains journal and bytes; restart retries the same project/document IDs`, async t => {
    const f = fixture(t); const attemptId = await f.stage();
    const original = { ...f.context.cloud }; const first = await f.context.journal.get(actorId, attemptId);
    if (failure === 'upload-reply-lost') f.context.cloud.uploadFile = async (...args) => { await original.uploadFile(...args); throw new Error('reply lost'); };
    if (failure === 'document-rejected') f.context.cloud.createDocument = async () => { throw new Error('row rejected'); };
    if (failure === 'document-reconcile-failed') f.context.cloud.createDocument = async row => {
      await original.createDocument(row); f.context.cloud.readDocument = async () => { throw new Error('cannot reconcile'); }; throw new Error('reply lost');
    };
    if (failure === 'project-reconcile-failed') f.context.cloud.createProject = async row => {
      await original.createProject(row); f.context.cloud.readProject = async () => { throw new Error('cannot reconcile'); }; throw new Error('reply lost');
    };
    await assert.rejects(runProjectUpload({ ...f.context, attemptId }), error => error.attemptId === attemptId && error.projectId === first.projectId);
    assert.ok(await f.context.journal.readFile(actorId, attemptId, first.files[0].id));
    assert.ok(await f.context.journal.get(actorId, attemptId));
    f.restart(); f.context.cloud = original;
    await runProjectUpload({ ...f.context, attemptId });
    assert.deepEqual([...f.projects.keys()], [first.projectId]);
    assert.deepEqual([...f.documents.keys()], [first.files[0].documentId]);
  });
}

test('staging quota, preparing state and missing staged payload never start cloud calls', async t => {
  const f = fixture(t); const stage = f.context.journal.stageFile;
  f.context.journal.stageFile = async () => { throw new DOMException('full', 'QuotaExceededError'); };
  let attemptId;
  await assert.rejects(f.stage(), error => { attemptId = error.attemptId; return !!attemptId; });
  assert.deepEqual(f.events, []);
  await assert.rejects(runProjectUpload({ ...f.context, attemptId }), { code: 'staging-required' });
  f.context.journal.stageFile = stage;
  await resumeStaging({ ...f.context, attemptId, files: [pdf()] });
  f.context.journal.readFile = async () => null;
  await assert.rejects(runProjectUpload({ ...f.context, attemptId }), { code: 'staging-required' });
  assert.deepEqual(f.events, []);
});

test('actor change during a cloud read stops all subsequent writes', async t => {
  const f = fixture(t); const attemptId = await f.stage();
  f.context.cloud.readProject = async () => { f.retire(); return null; };
  await assert.rejects(runProjectUpload({ ...f.context, attemptId }), { code: 'scope-changed' });
  assert.equal(f.projects.size, 0); assert.equal(f.documents.size, 0); assert.equal(f.uploads.size, 0);
  assert.ok(await f.context.journal.get(actorId, attemptId));
});

test('two same-attempt retries serialize; a completed cleanup retry performs no cloud calls', async t => {
  const f = fixture(t); const attemptId = await f.stage(); const finish = f.context.journal.finish;
  f.context.journal.finish = async () => { throw new Error('local cleanup failed'); };
  await assert.rejects(runProjectUpload({ ...f.context, attemptId }));
  assert.equal((await f.context.journal.get(actorId, attemptId)).phase, 'complete');
  f.context.journal.finish = finish; const before = f.events.length;
  const results = await Promise.allSettled([runProjectUpload({ ...f.context, attemptId }), runProjectUpload({ ...f.context, attemptId })]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  assert.equal(f.events.length, before);
  assert.ok(f.context.locks.calls.every(name => name === `survey:project-upload:${actorId}:${attemptId}`));
});

test('same SHA files share one upload/document and keep numbered names as aliases', async t => {
  const f = fixture(t); const attemptId = await f.stage([pdf(), pdf()]);
  await runProjectUpload({ ...f.context, attemptId });
  assert.equal(f.events.filter(([kind]) => kind === 'uploadFile').length, 1);
  assert.equal(f.documents.size, 1);
  assert.deepEqual([...f.documents.values()][0].name_aliases, ['plan (1).pdf']);
});

test('identical bytes in separate projects use independent paths and documents', async t => {
  const f = fixture(t);
  const firstId = await f.stage([pdf('first.pdf')]);
  const secondId = await f.stage([pdf('second.pdf')]);
  const first = await f.context.journal.get(actorId, firstId);
  const second = await f.context.journal.get(actorId, secondId);
  assert.notEqual(first.projectId, second.projectId);
  assert.equal(first.files[0].contentSha, second.files[0].contentSha);
  assert.equal(first.files[0].filePath, `${actorId}/${first.projectId}/${first.files[0].contentSha}.pdf`);
  assert.equal(second.files[0].filePath, `${actorId}/${second.projectId}/${second.files[0].contentSha}.pdf`);
  assert.notEqual(first.files[0].filePath, second.files[0].filePath);
  await runProjectUpload({ ...f.context, attemptId: firstId });
  f.uploads.set(first.files[0].filePath, 'later edit in first project');
  await runProjectUpload({ ...f.context, attemptId: secondId });
  assert.equal(f.uploads.get(first.files[0].filePath), 'later edit in first project');
  assert.equal(f.uploads.get(second.files[0].filePath), '%PDF-1.7\nplan');
  assert.equal(f.documents.size, 2);
  assert.ok([...f.documents.values()].every(row => row.name_aliases === undefined), 'different projects cannot become aliases of one workspace');
});

for (const malformed of [undefined, { id: uuid(99), user_id: otherActor, name: 'Plans' }, { id: uuid(2), user_id: actorId, name: 'Plans', archived: true }]) {
  test(`malformed/foreign/archived project proof rejects (${JSON.stringify(malformed)})`, async t => {
    const f = fixture(t); const attemptId = await f.stage();
    f.context.cloud.readProject = async () => malformed;
    await assert.rejects(runProjectUpload({ ...f.context, attemptId }), { code: 'cloud-conflict' });
    assert.equal(f.uploads.size, 0); assert.equal(f.documents.size, 0);
  });
}

test('empty projects use the same durable flow and no file calls', async t => {
  const f = fixture(t); const attemptId = await f.stage([]);
  await runProjectUpload({ ...f.context, attemptId });
  assert.equal(f.projects.size, 1); assert.equal(f.documents.size, 0); assert.equal(f.uploads.size, 0);
});

test('locks unavailable fails before journal/network, and common lock also protects discard', async t => {
  const f = fixture(t); const attemptId = await f.stage();
  await assert.rejects(runProjectUpload({ ...f.context, attemptId, locks: null }), { code: 'locks-unavailable' });
  assert.deepEqual(f.events, []);
  await withProjectUploadLock({ ...f.context, attemptId }, () => f.context.journal.discard(actorId, attemptId));
  assert.equal(await f.context.journal.get(actorId, attemptId), null);
});

test('reselecting files in a different order preserves stable IDs and already staged hashes', async t => {
  const f = fixture(t); const files = [pdf('a.pdf', '%PDF-a'), pdf('b.pdf', '%PDF-b')];
  let attemptId;
  f.context.prepareFile = async file => { if (file.name === 'b.pdf') throw new Error('interrupted'); return prepareFile(file); };
  await assert.rejects(f.stage(files), error => { attemptId = error.attemptId; return true; });
  const before = await f.context.journal.get(actorId, attemptId);
  assert.equal(before.files[0].state, 'staged'); assert.equal(before.files[1].state, 'pending');
  f.context.prepareFile = prepareFile;
  await resumeStaging({ ...f.context, attemptId, files: [...files].reverse() });
  const after = await f.context.journal.get(actorId, attemptId);
  assert.deepEqual(after.files.map(file => [file.id, file.documentId]), before.files.map(file => [file.id, file.documentId]));
  assert.equal(after.files[0].contentSha, before.files[0].contentSha);
  assert.equal(await (await f.context.journal.readFile(actorId, attemptId, after.files[1].id)).text(), '%PDF-b');
  assert.deepEqual(f.events, []);
});

test('reselect refuses changed staged bytes and ambiguous same-name/size unstaged sources', async t => {
  const f = fixture(t); let attemptId;
  f.context.prepareFile = async () => { throw new Error('interrupted'); };
  await assert.rejects(f.stage([pdf('same.pdf', '%PDF-a'), pdf('same.pdf', '%PDF-b')]), error => { attemptId = error.attemptId; return true; });
  f.context.prepareFile = prepareFile;
  await assert.rejects(resumeStaging({ ...f.context, attemptId, files: [pdf('same.pdf', '%PDF-b'), pdf('same.pdf', '%PDF-a')] }), { code: 'source-mismatch' });
  const before = await f.context.journal.get(actorId, attemptId);
  assert.equal(before.phase, 'preparing'); assert.ok(before.files.every(file => file.state === 'pending'));
  await resumeStaging({ ...f.context, attemptId, files: [pdf('same.pdf', '%PDF-a'), pdf('same.pdf', '%PDF-a')] });
  const ready = await f.context.journal.get(actorId, attemptId);
  assert.deepEqual(ready.files.map(file => file.name), ['same.pdf', 'same (1).pdf']);
  assert.deepEqual(f.events, []);
});

test('a staged hash cannot be changed while resuming the remaining file', async t => {
  const f = fixture(t); let attemptId;
  f.context.prepareFile = async file => { if (file.name === 'b.pdf') throw new Error('interrupted'); return prepareFile(file); };
  await assert.rejects(f.stage([pdf('a.pdf', '%PDF-a'), pdf('b.pdf', '%PDF-b')]), error => { attemptId = error.attemptId; return true; });
  f.context.prepareFile = prepareFile;
  await assert.rejects(resumeStaging({ ...f.context, attemptId, files: [pdf('a.pdf', '%PDF-x'), pdf('b.pdf', '%PDF-b')] }), { code: 'source-mismatch' });
  const attempt = await f.context.journal.get(actorId, attemptId);
  assert.equal(attempt.files[1].state, 'pending'); assert.deepEqual(f.events, []);
});

for (const mutation of [row => ({ ...row, id: uuid(99) }), row => ({ ...row, user_id: otherActor }),
  row => ({ ...row, file_path: `${actorId}/other.pdf` }), row => ({ ...row, archived: true }), row => undefined]) {
  test(`wrong document proof is rejected before storage write (${mutation.toString()})`, async t => {
    const f = fixture(t); const attemptId = await f.stage(); const attempt = await f.context.journal.get(actorId, attemptId);
    const file = attempt.files[0];
    const row = { id: file.documentId, user_id: actorId, project_id: attempt.projectId, content_sha256: file.contentSha,
      file_path: file.filePath, file_size: file.size, name: file.name, archived: false };
    f.context.cloud.readDocument = async () => mutation(row);
    await assert.rejects(runProjectUpload({ ...f.context, attemptId }), { code: 'cloud-conflict' });
    assert.equal(f.uploads.size, 0); assert.equal(f.documents.size, 0);
  });
}

test('confirmed deleted document is not recreated during a retry', async t => {
  const f = fixture(t); const attemptId = await f.stage();
  const patch = f.context.journal.patchAttempt;
  f.context.journal.patchAttempt = async (actor, id, value) => {
    if (value.phase === 'complete') throw new Error('local quota'); return patch(actor, id, value);
  };
  await assert.rejects(runProjectUpload({ ...f.context, attemptId }));
  assert.equal((await f.context.journal.get(actorId, attemptId)).files[0].state, 'confirmed');
  f.documents.clear(); f.context.journal.patchAttempt = patch;
  const writes = f.events.filter(([kind]) => ['uploadFile', 'createDocument'].includes(kind)).length;
  await assert.rejects(runProjectUpload({ ...f.context, attemptId }), { code: 'cloud-conflict' });
  assert.equal(f.events.filter(([kind]) => ['uploadFile', 'createDocument'].includes(kind)).length, writes);
});

test('pending phase journal failure prevents the corresponding cloud write', async t => {
  const f = fixture(t); const attemptId = await f.stage(); const patch = f.context.journal.patchAttempt;
  f.context.journal.patchAttempt = async (actor, id, value) => {
    if (value.projectState === 'unknown') throw new Error('quota'); return patch(actor, id, value);
  };
  await assert.rejects(runProjectUpload({ ...f.context, attemptId }));
  assert.equal(f.projects.size, 0); assert.equal(f.uploads.size, 0);
});

test('initial staging holds the same lock against concurrent discard', async t => {
  const f = fixture(t); let release; let started;
  const preparing = new Promise(resolve => { started = resolve; });
  f.context.prepareFile = async file => { started(); await new Promise(resolve => { release = resolve; }); return prepareFile(file); };
  const pending = f.stage(); await preparing;
  const [attempt] = await f.context.journal.list(actorId); let discarded = false;
  const discard = withProjectUploadLock({ ...f.context, attemptId: attempt.id }, async () => {
    discarded = true; return f.context.journal.discard(actorId, attempt.id);
  });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(discarded, false);
  release(); assert.equal(await pending, attempt.id); await discard;
  assert.equal(await f.context.journal.get(actorId, attempt.id), null); assert.deepEqual(f.events, []);
});

test('two file slots include parser lifetime, and parser errors do not undo confirmed uploads', async t => {
  const f = fixture(t); const attemptId = await f.stage(Array.from({ length: 5 }, (_, index) => pdf(`${index}.pdf`, `%PDF-${index}`)));
  let active = 0; let peak = 0; let completed = 0;
  f.context.cloud.readPageCount = async () => {
    active++; peak = Math.max(peak, active);
    try { await new Promise(resolve => setTimeout(resolve, 5)); completed++; throw new Error('parser failed'); }
    finally { active--; }
  };
  await runProjectUpload({ ...f.context, attemptId });
  assert.equal(peak, 2); assert.equal(active, 0); assert.equal(completed, 5); assert.equal(f.documents.size, 5);
});

test('empty preparing project can retry directly without reselecting files', async t => {
  const f = fixture(t); const attemptId = uuid(100);
  await f.context.journal.create(actorId, { id: attemptId, projectId: uuid(101), name: 'Empty', files: [] });
  await runProjectUpload({ ...f.context, attemptId }); assert.equal(f.projects.size, 1);
});

test('retry after a published PDF changed never restores staged bytes or page count', async t => {
  const f = fixture(t); const attemptId = await f.stage(); const patch = f.context.journal.patchAttempt;
  f.context.journal.patchAttempt = async (actor, id, value) => {
    if (value.phase === 'complete') throw new Error('local quota'); return patch(actor, id, value);
  };
  await assert.rejects(runProjectUpload({ ...f.context, attemptId }));
  const row = [...f.documents.values()][0]; row.page_count = 99;
  f.uploads.set(row.file_path, 'newer published PDF');
  const uploadCount = f.events.filter(([kind]) => kind === 'uploadFile').length;
  const parseCount = f.events.filter(([kind]) => kind === 'readPageCount').length;
  f.context.journal.patchAttempt = patch;
  await runProjectUpload({ ...f.context, attemptId });
  assert.equal(f.uploads.get(row.file_path), 'newer published PDF'); assert.equal(row.page_count, 99);
  assert.equal(f.events.filter(([kind]) => kind === 'uploadFile').length, uploadCount);
  assert.equal(f.events.filter(([kind]) => kind === 'readPageCount').length, parseCount);
});

test('page count is part of first insert, never a later original-byte metadata update', async t => {
  const f = fixture(t); const attemptId = await f.stage();
  f.context.cloud.updateDocument = async () => assert.fail('no page count updates');
  await runProjectUpload({ ...f.context, attemptId });
  assert.equal([...f.documents.values()][0].page_count, 2);
  assert.ok(f.events.findIndex(([kind]) => kind === 'readPageCount') < f.events.findIndex(([kind]) => kind === 'createDocument'));
});

test('alias CAS failure retains the attempt; retry preserves concurrent names without another upload', async t => {
  const f = fixture(t); const attemptId = await f.stage([pdf(), pdf()]);
  const update = f.context.cloud.updateDocument; let expected;
  f.context.cloud.updateDocument = async (id, patch, proof) => {
    expected = proof;
    assert.equal(proof.id, id); assert.deepEqual(patch, { name_aliases: ['plan (1).pdf'] });
    f.documents.get(id).name_aliases = ['concurrent.pdf']; throw new Error('CAS conflict');
  };
  await assert.rejects(runProjectUpload({ ...f.context, attemptId }));
  assert.ok(expected); const uploads = f.events.filter(([kind]) => kind === 'uploadFile').length;
  f.context.cloud.updateDocument = async (id, patch, proof) => {
    assert.deepEqual(proof.name_aliases, ['concurrent.pdf']); return update(id, patch);
  };
  await runProjectUpload({ ...f.context, attemptId });
  assert.deepEqual([...f.documents.values()][0].name_aliases, ['concurrent.pdf', 'plan (1).pdf']);
  assert.equal(f.events.filter(([kind]) => kind === 'uploadFile').length, uploads);
});

test('staging failures distinguish an absent journal from a durable pending attempt', async t => {
  const f = fixture(t);
  await assert.rejects(stageProjectUpload({ ...f.context, files: [pdf()], locks: null }), error => {
    assert.equal(error.recoveryCreated, false); assert.doesNotMatch(error.message, /saved files were kept/); return true;
  });
  const create = f.context.journal.create;
  f.context.journal.create = async () => { throw new DOMException('full', 'QuotaExceededError'); };
  await assert.rejects(f.stage(), error => error.recoveryCreated === false);
  f.context.journal.create = create;
  f.context.prepareFile = async () => { throw new Error('source read failed'); };
  await assert.rejects(f.stage(), error => error.recoveryCreated === true);
  assert.deepEqual(f.events, []);
});
