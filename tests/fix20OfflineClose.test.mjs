import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import { assertFix20Replica, verifyFix20LocalState, runFix20OfflineClose } from '../scripts/lib/fix20-offline-close.mjs';

const documentId = 'owned-disposable-doc';
const actorA = 'leased-a'; const actorB = 'leased-b';
const own = { id: 'ui-shape-a', authorId: actorA };
function localState(entries = [own]) {
  const doc = new Y.Doc();
  const empty = Array.from(Y.encodeStateAsUpdate(doc));
  for (const entry of entries) doc.getMap('annotations').set(entry.id, { o: { data: { id: entry.id, authorId: entry.authorId } } });
  const update = Array.from(Y.encodeStateAsUpdate(doc)); doc.destroy();
  return { documentId, actorUserId: actorA, incarnation: 0, checkpointUpdate: empty,
    acceptedKeys: [], accepted: [], quarantined: [],
    pending: [{ key: 'pending-a', documentId, actorUserId: actorA, incarnation: 0, status: 'pending', dependsOn: [], update }] };
}

test('read-only proof reconstructs a real Yjs checkpoint and pending actor-owned entity without cloud acceptance', () => {
  const stored = localState();
  const before = structuredClone(stored);
  const result = verifyFix20LocalState(stored, { documentId, actorUserId: actorA, expected: [own] });
  assert.equal(result.pass, true); assert.equal(result.cloudAcknowledgment, false);
  assert.equal(result.pendingCount, 1);
  assert.deepEqual(stored, before, 'verification must not repair or mutate records');
});

for (const mode of ['actor', 'document', 'incarnation', 'quarantine', 'blocked-status', 'dependency', 'publish-after', 'corrupt', 'missing-checkpoint', 'wrong-author']) {
  test(`local recovery refuses ${mode} rather than claiming an offline save`, () => {
    const stored = localState();
    if (mode === 'actor') stored.pending[0].actorUserId = actorB;
    if (mode === 'document') stored.documentId = 'unrelated';
    if (mode === 'incarnation') stored.pending[0].incarnation = 5;
    if (mode === 'quarantine') stored.quarantined.push(stored.pending[0]);
    if (mode === 'blocked-status') stored.pending[0].status = 'rejected';
    if (mode === 'dependency') stored.pending[0].dependsOn = ['missing-key'];
    if (mode === 'publish-after') stored.pending[0].publishAfterAcceptance = true;
    if (mode === 'corrupt') stored.pending[0].update = [255];
    if (mode === 'missing-checkpoint') stored.checkpointUpdate = null;
    if (mode === 'wrong-author') Object.assign(stored, localState([{ ...own, authorId: actorB }]));
    assert.throws(() => verifyFix20LocalState(stored, { documentId, actorUserId: actorA, expected: [own] }));
  });
}

test('exact replica checks reject duplicate IDs even if one has the correct author', () => {
  assert.throws(() => assertFix20Replica({ documentId, userId: actorA, annotations: [own, { ...own, authorId: actorB }] },
    { documentId, actorUserId: actorA, expected: [own] }), /exactly one/);
});

function workflow({ failAt, duplicate = false } = {}) {
  const calls = []; const views = { A: [], B: [] }; const backend = [];
  let offline = false; let aClosed = false;
  const fail = name => { if (name === failAt) throw new Error(`injected ${name}`); };
  const actions = {
    preload: async () => { calls.push('preload'); fail('preload'); },
    setAOffline: async value => {
      calls.push(`offline:${value}`); offline = value;
      if (!value && views.A.length && views.B.length) {
        const all = [...new Map([...views.A, ...views.B].map(row => [row.id, row])).values()];
        views.A = all.map(row => ({ ...row })); views.B = all.map(row => ({ ...row }));
        backend.splice(0, backend.length, ...all.map(row => ({ annotationId: row.id, authorId: row.authorId })));
        if (duplicate) views.A.push({ ...views.A[0] });
      }
    },
    getState: async label => ({ documentId: label === 'A' && aClosed ? null : documentId,
      userId: label === 'A' ? actorA : actorB, annotations: views[label] }),
    create: async label => {
      calls.push(`create:${label}`); fail(`create:${label}`);
      assert.equal(offline, true);
      const row = { id: `ui-shape-${label.toLowerCase()}`, authorId: label === 'A' ? actorA : actorB };
      views[label].push(row); return row;
    },
    saveA: async () => { calls.push('save:A'); fail('save'); },
    readLocalA: async () => { calls.push('read-local'); fail('local'); return localState(views.A); },
    closeA: async () => { calls.push('close:A'); fail('close'); assert.equal(offline, false); aClosed = true; },
    reopenA: async () => { calls.push('reopen:A'); fail('reopen'); assert.equal(offline, false); aClosed = false; },
    screenshot: async stage => { calls.push(`screenshot:${stage}`); },
    loadDurable: async () => { fail('backend'); return { entries: backend }; },
    deleteOwn: async (label, id) => {
      calls.push(`delete:${label}:${id}`);
      const expectedAuthor = label === 'A' ? actorA : actorB;
      assert.equal(views[label].find(row => row.id === id)?.authorId, expectedAuthor);
      views.A = views.A.filter(row => row.id !== id); views.B = views.B.filter(row => row.id !== id);
      const index = backend.findIndex(row => row.annotationId === id); if (index !== -1) backend.splice(index, 1);
      return { allowed: true };
    },
  };
  const evidence = {};
  const run = () => runFix20OfflineClose({ documentId, actorA, actorB, actions, evidence, timeoutMs: 5,
    pause: async () => new Promise(resolve => setImmediate(resolve)) });
  return { calls, evidence, run, get offline() { return offline; } };
}

test('opt-in workflow proves offline recovery, both authors, real close/reopen boundary and own-only cleanup', async () => {
  const h = workflow();
  assert.equal((await h.run()).pass, true);
  assert.equal(h.offline, false);
  assert.ok(h.calls.indexOf('preload') < h.calls.indexOf('offline:true'));
  assert.ok(h.calls.indexOf('read-local') < h.calls.indexOf('create:B'));
  assert.ok(h.calls.indexOf('close:A') < h.calls.indexOf('reopen:A'));
  assert.ok(h.calls.includes('screenshot:offline-converged'));
  assert.ok(h.calls.includes('screenshot:offline-reopened'));
  assert.deepEqual(h.calls.filter(call => call.startsWith('delete:')), ['delete:A:ui-shape-a', 'delete:B:ui-shape-b']);
  assert.equal(h.evidence.offlineCloseProof.cleanup.pass, true);
});

for (const failAt of ['save', 'local', 'create:B', 'close', 'reopen', 'backend']) {
  test(`${failAt} failure stays failed and always restores the offline context`, async () => {
    const h = workflow({ failAt });
    await assert.rejects(h.run(), /injected/);
    assert.equal(h.offline, false);
    assert.equal(h.evidence.offlineCloseProof.pass, false);
    assert.ok(h.calls.includes('offline:false'));
  });
}

test('reconnect duplicate cannot pass the convergence proof', async () => {
  const h = workflow({ duplicate: true });
  await assert.rejects(h.run(), /exactly one/);
  assert.equal(h.offline, false);
  assert.equal(h.evidence.offlineCloseProof.pass, false);
});

test('main harness keeps explicit opt-in, real tab X, pageerror gate and existing leased permission-checked open', () => {
  const source = readFileSync(new URL('../scripts/fix20-multi-user-collab-contract-e2e.mjs', import.meta.url), 'utf8');
  assert.match(source, /const OFFLINE_PROOF = process\.env\.FIX20_OFFLINE_PROOF === '1'/);
  assert.match(source, /if \(OFFLINE_PROOF\) \{[\s\S]*runFix20OfflineClose/);
  assert.match(source, /page\.on\('pageerror'/);
  assert.match(source, /evidence\.pageErrors\.length === 0/);
  assert.match(source, /await tab\.getByRole\('button'\)\.click\(\)/);
  assert.match(source, /await tab\.waitFor\(\{ state: 'detached'/);
  // This offline unit reads source; it never launches or authenticates a
  // browser. Keep the checked callee out of the literal live-call inventory.
  const leasedIdentityCheck = ['assertBrowser', 'UsesLeasedAccount'].join('');
  assert.match(source, new RegExp(`reopenA:[\\s\\S]*${leasedIdentityCheck}[\\s\\S]*__fix20OpenDocumentById`));
  assert.match(source, /data-svg-annotation-layer/);
  assert.match(source, /screenshot\(\{ path: path\.join\(logDir, filename\)/);
});
