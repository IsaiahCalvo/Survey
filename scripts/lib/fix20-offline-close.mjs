import assert from 'node:assert/strict';
import * as Y from 'yjs';

export function assertFix20Replica(state, { documentId, actorUserId, expected = [], absent = [] }) {
  assert.equal(state?.documentId, documentId, 'The harness switched documents');
  assert.equal(state?.userId, actorUserId, 'The harness switched actors');
  for (const { id, authorId } of expected) {
    const entries = state.annotations.filter(entry => entry.id === id);
    assert.equal(entries.length, 1, `Expected exactly one annotation ${id}`);
    assert.equal(entries[0].authorId, authorId, `Author changed for ${id}`);
  }
  for (const id of absent) assert.ok(!state.annotations.some(entry => entry.id === id), `Unexpected annotation ${id}`);
}

/** Read proof only: reconstruct disk records, never repair, append or hydrate
 * the live editor. This proves the fixture entities, not every app data store. */
export function verifyFix20LocalState(stored, { documentId, actorUserId, expected }) {
  assert.equal(stored?.documentId, documentId);
  assert.equal(stored?.actorUserId, actorUserId);
  assert.ok(Number.isSafeInteger(stored.incarnation) && stored.incarnation >= 0);
  assert.ok(stored.checkpointUpdate?.length, 'Accepted local checkpoint is missing');
  assert.equal(stored.quarantined?.length, 0, 'Quarantined data is not a local save proof');
  const rows = [...stored.accepted, ...stored.pending];
  assert.ok(rows.length <= 4096, 'Fixture recovery exceeded the row bound');
  const available = new Set([...stored.acceptedKeys, ...rows.map(row => row.key)]);
  for (const row of rows) {
    assert.equal(row.documentId, documentId); assert.equal(row.actorUserId, actorUserId);
    assert.equal(Number(row.incarnation) || 0, stored.incarnation);
  }
  for (const row of stored.pending) {
    assert.ok(['pending', 'ambiguous'].includes(row.status), 'Pending data has an unsupported state');
    assert.ok((row.dependsOn || []).every(key => available.has(key)), 'Pending data lacks a predecessor');
  }
  const updates = [stored.checkpointUpdate, ...stored.accepted.map(row => row.update),
    ...stored.pending.filter(row => !row.publishAfterAcceptance).map(row => row.update)];
  assert.ok(updates.reduce((sum, update) => sum + (update?.length || 0), 0) <= 64 * 1024 * 1024,
    'Fixture recovery exceeded the byte bound');
  const doc = new Y.Doc();
  try {
    for (const update of updates) Y.applyUpdate(doc, new Uint8Array(update));
    assert.equal(doc.store.pendingStructs, null, 'Stored updates have unresolved Yjs predecessors');
    assert.equal(doc.store.pendingDs, null, 'Stored deletes have unresolved Yjs predecessors');
    const annotations = [...doc.getMap('annotations')].map(([key, value]) => {
      const object = value?.o || value;
      return { id: String(object?.data?.id ?? object?.id ?? object?.annotationId ?? object?.pdfAnnotationId ?? key),
        authorId: object?.meta?.authorId ?? object?.data?.authorId ?? object?.data?.userId ?? object?.authorId ?? null };
    });
    assertFix20Replica({ documentId, userId: actorUserId, annotations }, { documentId, actorUserId, expected });
    return { pass: true, documentId, actorUserId, incarnation: stored.incarnation,
      pendingCount: stored.pending.length, acceptedCount: stored.accepted.length,
      matched: expected.map(({ id, authorId }) => ({ id, authorId })),
      source: 'readonly-indexeddb-checkpoint-and-replayable-outbox', cloudAcknowledgment: false };
  } finally { doc.destroy(); }
}

export async function preloadFix20OfflineInspection(page) {
  await page.evaluate(async () => { await import('/src/services/annotationDocOutbox.js'); });
}

export async function readFix20LocalState(page, documentId, actorUserId) {
  return page.evaluate(async ({ documentId, actorUserId }) => {
    const { createAnnotationOutbox } = await import('/src/services/annotationDocOutbox.js');
    const outbox = await createAnnotationOutbox({ existingOnly: true, timeoutMs: 5000 });
    try {
      if (outbox.storageKind !== 'indexeddb') throw new Error('Memory storage cannot prove offline recovery');
      const incarnation = await outbox.getDocumentIncarnation(documentId);
      const stored = await outbox.readLocalStateFresh(documentId, actorUserId, incarnation);
      const encode = row => ({ ...row, update: row.update ? Array.from(row.update) : null });
      return { ...stored, checkpointUpdate: stored.checkpointUpdate ? Array.from(stored.checkpointUpdate) : null,
        accepted: stored.accepted.map(encode), pending: stored.pending.map(encode), quarantined: stored.quarantined.map(encode) };
    } finally { await outbox.close(); }
  }, { documentId, actorUserId });
}

/** All mutations are injected existing fixture/UI actions. No auth provisioning
 * and no permission bypass or offline document-open override is allowed here. */
export async function runFix20OfflineClose({ documentId, actorA, actorB, actions, evidence,
  timeoutMs = 30000, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  assert.ok(documentId && actorA && actorB && actorA !== actorB, 'Two distinct leased actors and one fixture are required');
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0);
  const proof = evidence.offlineCloseProof = { requested: true, pass: false, created: [], cleanup: { pass: false },
    limitations: ['Offline reopening is not tested; the existing online permission gate stays in use.'] };
  const expected = [];
  const wait = async (label, check) => {
    const end = Date.now() + timeoutMs; let last;
    do { try { return await check(); } catch (error) { last = error; } await pause(200); } while (Date.now() < end);
    throw new Error(`${label}: ${last?.message || 'timed out'}`, { cause: last });
  };
  const checkClient = async (client, entries = expected, absent = []) => {
    const state = await actions.getState(client);
    assertFix20Replica(state, { documentId, actorUserId: client === 'A' ? actorA : actorB, expected: entries, absent });
    return state;
  };
  let error;
  try {
    await checkClient('A'); await checkClient('B');
    await actions.preload();
    await actions.setAOffline(true);
    const a = await actions.create('A');
    assert.ok(a?.id); assert.equal(a.authorId, actorA);
    expected.push({ id: a.id, authorId: actorA }); proof.created.push({ client: 'A', ...expected[0] });
    await actions.saveA();
    await checkClient('A');
    proof.offlineLocal = await wait('Offline local recovery', async () => verifyFix20LocalState(
      await actions.readLocalA(), { documentId, actorUserId: actorA, expected: [expected[0]] },
    ));
    const b = await actions.create('B');
    assert.ok(b?.id); assert.notEqual(b.id, a.id); assert.equal(b.authorId, actorB);
    expected.push({ id: b.id, authorId: actorB }); proof.created.push({ client: 'B', ...expected[1] });
    await checkClient('A', [expected[0]], [b.id]);
    await checkClient('B', [expected[1]], [a.id]);
    proof.offlineIsolation = { pass: true };
    await actions.setAOffline(false);
    await wait('A convergence', () => checkClient('A'));
    await wait('B convergence', () => checkClient('B'));
    proof.converged = { pass: true, expected };
    await actions.screenshot('offline-converged');
    await actions.closeA();
    proof.realTabClose = { pass: true };
    await actions.reopenA();
    await wait('A reopened replica', () => checkClient('A'));
    await wait('B retained replica', () => checkClient('B'));
    await actions.screenshot('offline-reopened');
    proof.reopened = { pass: true };
    proof.backend = await wait('Durable backend convergence', async () => {
      const state = await actions.loadDurable();
      const rows = state.entries.filter(row => expected.some(entry => entry.id === row.annotationId));
      assertFix20Replica({ documentId, userId: actorA, annotations: rows.map(row => ({ id: row.annotationId, authorId: row.authorId })) },
        { documentId, actorUserId: actorA, expected });
      return { pass: true, rows: rows.map(({ annotationId, authorId }) => ({ annotationId, authorId })) };
    });
  } catch (failure) { error = failure; }
  finally {
    const failures = [];
    try { await actions.setAOffline(false); } catch (failure) { failures.push(`Restore online: ${failure.message}`); }
    // Own-only deletion uses the same existing per-actor harness path. The
    // outer harness still deletes the exact disposable document on any error.
    for (const created of proof.created) {
      try {
        const state = await checkClient(created.client, []);
        const own = state.annotations.filter(entry => entry.id === created.id);
        if (own.length) {
          assert.ok(own.every(entry => entry.authorId === created.authorId), 'Refusing to delete another actor annotation');
          const result = await actions.deleteOwn(created.client, created.id);
          assert.equal(result?.allowed, true, 'Own annotation deletion was rejected');
        }
      } catch (failure) { failures.push(`Own cleanup ${created.client}: ${failure.message}`); }
    }
    if (proof.created.length) {
      try {
        await wait('Fixture annotation cleanup', async () => {
          const ids = proof.created.map(entry => entry.id);
          await checkClient('A', [], ids); await checkClient('B', [], ids);
          const durable = await actions.loadDurable();
          assert.ok(!durable.entries.some(row => ids.includes(row.annotationId)), 'Fixture annotations remain in backend');
        });
      } catch (failure) { failures.push(failure.message); }
    }
    proof.cleanup = { pass: failures.length === 0, errors: failures };
    if (failures.length && !error) error = new Error(failures.join('; '));
  }
  if (error) { proof.error = error.message; throw error; }
  proof.pass = true;
  return proof;
}
