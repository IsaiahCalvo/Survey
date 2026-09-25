// src/services/__tests__/excelSyncClient.test.mjs
//
// KAL-309 client transport + materialize reducer (PLAN-KAL309 §D.1–D.4).
// Pure unit tests with injected mocks — no Supabase, no Y.Doc, no network.
//
// Coverage:
//   1. submitChangeSet shapes the Edge body + invokes excel-apply-changeset.
//   2. submitChangeSet surfaces a server rejection via .error.
//   3. materializeAcceptedOps does a field-level merge (only changedFieldKeys).
//   4. materializeAcceptedOps is idempotent (an already-handled op is skipped).
//   5. materializeAcceptedOps routes a genuine app-vs-Excel conflict to review.
//   6. the frontier advances ONLY over contiguous handled ops and HALTS on conflict.
//   7. ack / fetchSince / resolveMaterializationConflict / seedSyncState wrappers
//      call the right rpc with the right args and normalize the result.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  submitChangeSet,
  fetchSince,
  ackMaterialization,
  resolveMaterializationConflict,
  seedSyncState,
  setRegistrationSigningId,
  materializeAcceptedOps,
  readFrontier,
  __test,
} from '../excelSyncClient.js';
import { computeRowFingerprints } from '../rowFingerprint.js';

// --- mock helpers ----------------------------------------------------------

// A Supabase client mock that records the last functions.invoke / rpc call.
function makeSupabaseMock({ invokeResult, rpcResult } = {}) {
  const calls = { invoke: [], rpc: [] };
  return {
    calls,
    functions: {
      invoke: async (name, opts) => {
        calls.invoke.push({ name, opts });
        return invokeResult ?? { data: { excelRevision: 0, outcomes: [], writebackJobs: [], replayed: false }, error: null };
      },
    },
    rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      return rpcResult ?? { data: null, error: null };
    },
  };
}

// An in-memory marker store + meta store for the reducer.
function makeStores(initialMarkers = {}, initialMeta = {}) {
  const markers = { ...initialMarkers };
  const meta = { ...initialMeta };
  const acks = [];
  return {
    markers,
    meta,
    acks,
    getMarkers: () => markers,
    writeMarker: (id, next) => { markers[id] = next; },
    getMeta: (key) => meta[key],
    setMeta: (key, value) => { meta[key] = value; },
    ack: async ({ opUuid, status }) => { acks.push({ opUuid, status }); return { ok: true }; },
  };
}

// Build a fetch_since-style op row.
function opRow({
  opUuid, revision, markerId, opType = 'apply', opStatus = 'accepted',
  changedFieldKeys = [], fields = null, baseFingerprints = null, scopeId = 'mod:cat',
  moduleId = null, categoryId = null, identity = null,
}) {
  return {
    op_uuid: opUuid,
    op_id: `opid-${opUuid}`,
    excel_revision: revision,
    marker_annotation_id: markerId,
    op_type: opType,
    op_status: opStatus,
    patch_payload: {
      markerAnnotationId: markerId,
      scopeId,
      moduleId,
      categoryId,
      identity,
      templateId: 'tpl-1',
      opType,
      changedFieldKeys,
      fields,
      baseFingerprints,
    },
  };
}

// Compute authentic field fingerprints for a row (same fn the matcher uses), so a
// conflict test's baseFingerprints are real hashes — not raw values. Returns the
// { identityVector, fields } shape the op's baseFingerprints carries.
async function baseFingerprintsFor({ changedBy = '', changedDate = '', item = '', entity = '', notes = '', answers = {} } = {}) {
  const fp = await computeRowFingerprints({ changedBy, changedDate, item, entity, notes, answers });
  return { identityVector: fp.identityVectorFingerprint, fields: fp.fieldFingerprints };
}

// ===========================================================================
// 1–2. submitChangeSet
// ===========================================================================

test('materialization stops for review when local changes exhaust the re-read retries', async () => {
  let reads = 0;
  const store = makeStores();
  const writes = [];
  const result = await materializeAcceptedOps({
    ...store,
    templateId: 'tpl-race',
    ops: [opRow({ opUuid: 'race-op', revision: 1, markerId: 'changing', opType: 'create', changedFieldKeys: ['item'], fields: { item: 'Excel' } })],
    getMarkers: () => ({ changing: { id: 'changing', name: `local-${++reads}` } }),
    writeMarker: (...args) => writes.push(args),
  });
  assert.equal(writes.length, 0, 'never write a clone that failed the final live re-read');
  assert.equal(result.frontier, 0);
  assert.equal(result.halted, true);
  assert.deepEqual(result.conflicts, ['race-op']);
});

test('submitChangeSet shapes the Edge body and invokes excel-apply-changeset', async () => {
  const supabase = makeSupabaseMock({
    invokeResult: { data: { excelRevision: 7, outcomes: [{ opId: 'a', outcome: 'applied' }], writebackJobs: [], replayed: false }, error: null },
  });

  const res = await submitChangeSet({
    supabaseClient: supabase,
    documentId: 'doc-1',
    templateId: 'tpl-1',
    workbookId: 'wb_abc',
    syncToken: 'st_xyz',
    rows: [{ opId: 'a', opType: 'apply' }],
    worksheetDataList: [{ matchedModuleId: 'mod', matchedCategory: { id: 'cat' } }],
    surveyMarkers: { m1: { id: 'm1' } },
    appValuesByMarkerId: { m1: {} },
    templateConfig: { modules: [] },
    ingestSeq: 123,
    capabilityTier: 'business',
    deviceHint: 'dev',
    clientChangeSetId: 'ccs-1',
  });

  assert.equal(supabase.calls.invoke.length, 1);
  const { name, opts } = supabase.calls.invoke[0];
  assert.equal(name, 'excel-apply-changeset');
  const body = opts.body;
  // Top-level identity fields.
  assert.equal(body.documentId, 'doc-1');
  assert.equal(body.templateId, 'tpl-1');
  assert.equal(body.workbookId, 'wb_abc');
  assert.equal(body.syncToken, 'st_xyz');
  // change-set wrapper carries the idempotency id + the advisory rows.
  assert.equal(body.changeSet.clientChangeSetId, 'ccs-1');
  assert.deepEqual(body.changeSet.rows, [{ opId: 'a', opType: 'apply' }]);
  // Raw matcher inputs travel at the top level.
  assert.equal(body.worksheetDataList.length, 1);
  assert.deepEqual(body.surveyMarkers, { m1: { id: 'm1' } });
  assert.equal(body.ingestSeq, 123);
  assert.equal(body.capabilityTier, 'business');
  // Response normalized.
  assert.equal(res.excelRevision, 7);
  assert.equal(res.outcomes.length, 1);
  assert.equal(res.error, null);
  assert.equal(res.clientChangeSetId, 'ccs-1');
});

test('submitChangeSet generates a clientChangeSetId when omitted and reuses it on the response', async () => {
  const supabase = makeSupabaseMock();
  const res = await submitChangeSet({
    supabaseClient: supabase,
    documentId: 'doc-1', templateId: 'tpl-1', workbookId: 'wb_a', syncToken: 'st_b',
  });
  const sent = supabase.calls.invoke[0].opts.body.changeSet.clientChangeSetId;
  assert.ok(sent && typeof sent === 'string');
  assert.equal(res.clientChangeSetId, sent);
});

test('submitChangeSet surfaces a server rejection via .error', async () => {
  const supabase = makeSupabaseMock({
    invokeResult: { data: { error: 'locked', outcomes: [] }, error: { message: 'Edge returned 423' } },
  });
  const res = await submitChangeSet({
    supabaseClient: supabase,
    documentId: 'doc-1', templateId: 'tpl-1', workbookId: 'wb_a', syncToken: 'st_b',
  });
  assert.equal(res.error, 'locked');
  assert.equal(res.excelRevision, 0);
});

test('submitChangeSet reads the server reason + detail from a FunctionsHttpError body (data null, body on error.context)', async () => {
  // Real supabase-js shape on a non-2xx: data is null and the parsed body lives on
  // error.context (the fetch Response). Without reading it the user only sees the opaque
  // "Edge Function returned a non-2xx status code". This is the 2026-06-26 legacy_unsigned case.
  const supabase = makeSupabaseMock({
    invokeResult: {
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: { json: async () => ({ error: 'legacy_unsigned', detail: 're-export required' }) },
      },
    },
  });
  const res = await submitChangeSet({
    supabaseClient: supabase,
    documentId: 'doc-1', templateId: 'tpl-1', workbookId: 'wb_a', syncToken: 'st_b',
  });
  assert.equal(res.error, 'legacy_unsigned');
  assert.equal(res.detail, 're-export required');
  assert.equal(res.excelRevision, 0);
});

test('submitChangeSet throws without a functions.invoke-capable client', async () => {
  await assert.rejects(
    () => submitChangeSet({ supabaseClient: {}, documentId: 'd', templateId: 't', workbookId: 'w', syncToken: 's' }),
    /functions\.invoke/,
  );
});

// ===========================================================================
// 3. materializeAcceptedOps — field-level merge (only changedFieldKeys)
// ===========================================================================

test('materializeAcceptedOps overlays ONLY changedFieldKeys onto the live marker', async () => {
  const stores = makeStores({
    m1: {
      id: 'm1',
      name: 'Door 1',
      checklistResponses: { c1: { selection: 'OLD' }, c2: { selection: 'KEEP' } },
      entityName: 'Acme',
      note: { text: 'orig note', extra: 'preserve-me' },
    },
  });

  // Baseline = the LIVE values (c1='OLD', notes='orig note') so live==baseline →
  // Excel moved but the app did NOT → no conflict → clean apply of the changed fields.
  const base = await baseFingerprintsFor({
    item: 'Door 1', entity: 'Acme', notes: 'orig note', answers: { c1: 'OLD', c2: 'KEEP' },
  });
  const res = await materializeAcceptedOps({
    ops: [opRow({
      opUuid: 'u1', revision: 1, markerId: 'm1',
      changedFieldKeys: ['answer:c1', 'notes'],
      fields: { answers: { c1: 'NEW', c2: 'IGNORED' }, notes: 'updated note' },
      baseFingerprints: base,
    })],
    templateId: 'tpl-1',
    getMarkers: stores.getMarkers,
    writeMarker: stores.writeMarker,
    getMeta: stores.getMeta,
    setMeta: stores.setMeta,
    ack: stores.ack,
  });

  const m = stores.markers.m1;
  // Changed fields applied.
  assert.equal(m.checklistResponses.c1.selection, 'NEW');
  assert.equal(m.note.text, 'updated note');
  // Untouched fields preserved — c2 (not in changedFieldKeys), name, entity, note.extra.
  assert.equal(m.checklistResponses.c2.selection, 'KEEP');
  assert.equal(m.name, 'Door 1');
  assert.equal(m.entityName, 'Acme');
  assert.equal(m.note.extra, 'preserve-me');
  // Provenance stamped.
  assert.equal(m.excelSync.lastAppliedOpUuid, 'u1');
  assert.equal(m.excelSync.lastAppliedExcelRevision, 1);
  // Outcome + ack + frontier.
  assert.deepEqual(res.materialized, ['u1']);
  assert.equal(res.frontier, 1);
  assert.equal(res.halted, false);
  assert.deepEqual(stores.acks, [{ opUuid: 'u1', status: 'materialized' }]);
});

test('materializeAcceptedOps refreshes the stored baseline to the applied op identity (prevents the next-edit stale-baseline conflict)', async () => {
  const stores = makeStores({
    m1: {
      id: 'm1', name: 'Door 1', entityName: 'Acme', note: { text: 'n' }, checklistResponses: {},
      excelSync: { fieldFingerprints: { entity: 'v1:STALE' }, scopeId: 'mod:cat' },
    },
  });
  // base == live (entity 'Acme') so the entity change is Excel-only → clean apply (no conflict).
  const base = await baseFingerprintsFor({ item: 'Door 1', entity: 'Acme', notes: 'n', answers: {} });
  const appliedIdentity = {
    identityVectorFingerprint: 'v1:IVF-applied',
    fullRowFingerprint: 'v1:FRF-applied',
    fieldFingerprints: { item: 'v1:i', entity: 'v1:ENTITY-applied', notes: 'v1:n', answers: {} },
  };
  const res = await materializeAcceptedOps({
    ops: [opRow({
      opUuid: 'u1', revision: 1, markerId: 'm1', changedFieldKeys: ['entity'],
      fields: { entity: 'NewCo' }, baseFingerprints: base, identity: appliedIdentity,
    })],
    templateId: 'tpl-1',
    getMarkers: stores.getMarkers, writeMarker: stores.writeMarker,
    getMeta: stores.getMeta, setMeta: stores.setMeta, ack: stores.ack,
  });
  const m = stores.markers.m1;
  assert.equal(m.entityName, 'NewCo');                                      // change applied
  assert.equal(m.excelSync.fieldFingerprints.entity, 'v1:ENTITY-applied');  // baseline REFRESHED (not 'v1:STALE')
  assert.equal(m.excelSync.identityVectorFingerprint, 'v1:IVF-applied');
  assert.deepEqual(res.materialized, ['u1']);
});

test('materializeAcceptedOps creates a new marker for a create op (full row + identity stamp)', async () => {
  const stores = makeStores({});
  await materializeAcceptedOps({
    ops: [opRow({
      opUuid: 'u-new', revision: 1, markerId: 'srv-minted-uuid', opType: 'create',
      scopeId: 'modX:catY', moduleId: 'modX', categoryId: 'catY',
      // Codex finding #4: the Edge sends EVERY visible field key for a create so the
      // reducer populates the whole marker (not just changedFields, which is empty for a create).
      changedFieldKeys: ['item', 'entity', 'notes', 'answer:c9', 'answer:c10'],
      fields: { item: 'Fresh Row', entity: 'Acme', notes: 'hello', answers: { c9: 'yes', c10: 'no' } },
      // Codex finding #5: token-FREE identity block seeds excelSync (no assignedToken here).
      identity: { moduleId: 'modX', categoryId: 'catY', version: 'v1', origin: 'import', identityVectorFingerprint: 'iv-fp', fullRowFingerprint: 'full-fp' },
    })],
    templateId: 'tpl-1',
    getMarkers: stores.getMarkers,
    writeMarker: stores.writeMarker,
    getMeta: stores.getMeta,
    setMeta: stores.setMeta,
  });
  const m = stores.markers['srv-minted-uuid'];
  assert.ok(m, 'new marker created under the server-minted id');
  assert.equal(m.id, 'srv-minted-uuid');
  // Whole row populated (finding #4).
  assert.equal(m.name, 'Fresh Row');
  assert.equal(m.entityName, 'Acme');
  assert.equal(m.note.text, 'hello');
  assert.equal(m.checklistResponses.c9.selection, 'yes');
  assert.equal(m.checklistResponses.c10.selection, 'no');
  // moduleId/categoryId stamped so the Survey panel + export filters see it (finding #5).
  assert.equal(m.moduleId, 'modX');
  assert.equal(m.categoryId, 'catY');
  // excelSync seeded from the token-free identity block; NO assignedToken present.
  assert.equal(m.excelSync.identityVectorFingerprint, 'iv-fp');
  assert.equal(m.excelSync.lastAppliedOpUuid, 'u-new');
  assert.equal(m.excelSync.assignedToken, undefined);
  // Unplaced import: no geometry.
  assert.equal(m.pageNumber, null);
  assert.equal(m.bounds, null);
});

test('a create op with moduleId only in scopeId still stamps module/category (split fallback)', async () => {
  const stores = makeStores({});
  await materializeAcceptedOps({
    ops: [opRow({
      opUuid: 'u-c', revision: 1, markerId: 'mid', opType: 'create',
      scopeId: 'mZ:cZ', moduleId: null, categoryId: null,
      changedFieldKeys: ['item'], fields: { item: 'R' },
    })],
    templateId: 'tpl-1',
    getMarkers: stores.getMarkers, writeMarker: stores.writeMarker,
    getMeta: stores.getMeta, setMeta: stores.setMeta,
  });
  const m = stores.markers.mid;
  assert.equal(m.moduleId, 'mZ');
  assert.equal(m.categoryId, 'cZ');
});

// ===========================================================================
// 4. idempotent skip
// ===========================================================================

test('materializeAcceptedOps skips an op already below/at the frontier', async () => {
  const stores = makeStores(
    { m1: { id: 'm1', checklistResponses: {} } },
    { 'excelSyncFrontier:tpl-1': { revision: 5 } },
  );
  let writes = 0;
  const res = await materializeAcceptedOps({
    ops: [opRow({ opUuid: 'u-old', revision: 3, markerId: 'm1', changedFieldKeys: ['answer:c1'], fields: { answers: { c1: 'x' } } })],
    templateId: 'tpl-1',
    getMarkers: stores.getMarkers,
    writeMarker: (id, next) => { writes += 1; stores.writeMarker(id, next); },
    getMeta: stores.getMeta,
    setMeta: stores.setMeta,
    ack: stores.ack,
  });
  // Below the frontier → never even considered (filtered out), no write, no ack.
  assert.equal(writes, 0);
  assert.equal(res.materialized.length, 0);
  assert.equal(stores.acks.length, 0);
  assert.equal(res.frontier, 5);
});

test('materializeAcceptedOps is idempotent on a re-fetch overlap (already-materialized op)', async () => {
  const stores = makeStores(
    { m1: { id: 'm1', checklistResponses: {} } },
    {
      'excelSyncFrontier:tpl-1': { revision: 0 },
      'excelSyncReview:tpl-1': { u1: { revision: 1, markerAnnotationId: 'm1', status: 'materialized' } },
    },
  );
  let writes = 0;
  const res = await materializeAcceptedOps({
    ops: [opRow({ opUuid: 'u1', revision: 1, markerId: 'm1', changedFieldKeys: ['answer:c1'], fields: { answers: { c1: 'x' } } })],
    templateId: 'tpl-1',
    getMarkers: stores.getMarkers,
    writeMarker: (id, next) => { writes += 1; stores.writeMarker(id, next); },
    getMeta: stores.getMeta,
    setMeta: stores.setMeta,
    ack: stores.ack,
  });
  // The op is recorded handled-materialized → skipped (no re-write), but the
  // contiguous frontier advances over it.
  assert.equal(writes, 0);
  assert.deepEqual(res.skipped, ['u1']);
  assert.equal(res.frontier, 1);
});

// ===========================================================================
// 5–6. conflict-review + frontier halt
// ===========================================================================

test('materializeAcceptedOps routes a genuine ANSWER-field app-vs-Excel conflict to review and HALTS', async () => {
  // Live answer c1='APP-EDIT' differs from BOTH the op's baseline ('BASE', a REAL
  // nested-answers fingerprint) AND the incoming Excel value ('EXCEL-EDIT') → genuine
  // both-changed. This is the exact case Codex finding #1 said was being MISSED
  // (nested fields.answers[id] vs the old flat fields["answer:id"] read).
  const stores = makeStores({
    m1: { id: 'm1', checklistResponses: { c1: { selection: 'APP-EDIT' } } },
    m2: { id: 'm2', checklistResponses: { c2: { selection: 'old' } } },
  });
  const base = await baseFingerprintsFor({ answers: { c1: 'BASE' } });

  const res = await materializeAcceptedOps({
    ops: [
      opRow({
        opUuid: 'u1', revision: 1, markerId: 'm1',
        changedFieldKeys: ['answer:c1'],
        fields: { answers: { c1: 'EXCEL-EDIT' } },
        baseFingerprints: base,
      }),
      // A later op for a DIFFERENT marker — must NOT be applied (frontier halted at 0).
      opRow({
        opUuid: 'u2', revision: 2, markerId: 'm2',
        changedFieldKeys: ['answer:c2'],
        fields: { answers: { c2: 'new' } },
      }),
    ],
    templateId: 'tpl-1',
    getMarkers: stores.getMarkers,
    writeMarker: stores.writeMarker,
    getMeta: stores.getMeta,
    setMeta: stores.setMeta,
    ack: stores.ack,
  });

  // Conflict recorded, halted, frontier NOT advanced.
  assert.deepEqual(res.conflicts, ['u1']);
  assert.equal(res.halted, true);
  assert.equal(res.frontier, 0);
  // m1 unchanged (no clobber); m2 unchanged (later op never reached).
  assert.equal(stores.markers.m1.checklistResponses.c1.selection, 'APP-EDIT');
  assert.equal(stores.markers.m2.checklistResponses.c2.selection, 'old');
  // Durable review set records the conflict, ack fired as client_conflict_review.
  const review = stores.meta['excelSyncReview:tpl-1'];
  assert.equal(review.u1.status, 'client_conflict_review');
  assert.deepEqual(stores.acks, [{ opUuid: 'u1', status: 'client_conflict_review' }]);
});

test('materializeAcceptedOps detects an ENTITY (scalar) app-vs-Excel conflict via fingerprint', async () => {
  const stores = makeStores({
    m1: { id: 'm1', entityName: 'AppCo', checklistResponses: {} },
  });
  const base = await baseFingerprintsFor({ entity: 'BaseCo' });
  const res = await materializeAcceptedOps({
    ops: [opRow({
      opUuid: 'u1', revision: 1, markerId: 'm1',
      changedFieldKeys: ['entity'],
      fields: { entity: 'ExcelCo' },
      baseFingerprints: base,
    })],
    templateId: 'tpl-1',
    getMarkers: stores.getMarkers, writeMarker: stores.writeMarker,
    getMeta: stores.getMeta, setMeta: stores.setMeta, ack: stores.ack,
  });
  assert.deepEqual(res.conflicts, ['u1']);
  assert.equal(stores.markers.m1.entityName, 'AppCo'); // not clobbered
});

test('materializeAcceptedOps treats an app-side CLEAR vs an Excel change as a conflict (round-2 finding #1)', async () => {
  // Baseline had entity='BaseCo'; the app CLEARED it (live entityName=''); Excel changed it
  // to 'ExcelCo'. The old gate skipped on the blank live value and Excel would silently
  // overwrite the user's clear (data loss). Now the blank live fingerprint != base fingerprint
  // → conflict → route to review (never overwrite the clear).
  const stores = makeStores({
    m1: { id: 'm1', entityName: '', checklistResponses: {} },
  });
  const base = await baseFingerprintsFor({ entity: 'BaseCo' }); // field HAD a value at baseline
  const res = await materializeAcceptedOps({
    ops: [opRow({
      opUuid: 'u1', revision: 1, markerId: 'm1',
      changedFieldKeys: ['entity'],
      fields: { entity: 'ExcelCo' },
      baseFingerprints: base,
    })],
    templateId: 'tpl-1',
    getMarkers: stores.getMarkers, writeMarker: stores.writeMarker,
    getMeta: stores.getMeta, setMeta: stores.setMeta, ack: stores.ack,
  });
  assert.deepEqual(res.conflicts, ['u1']);
  assert.equal(res.halted, true);
  assert.equal(stores.markers.m1.entityName, ''); // the app-side clear is NOT overwritten
});

test('materializeAcceptedOps applies an Excel change to a field that was ALWAYS blank (blank==baseline, no conflict)', async () => {
  // Baseline blank, live blank, Excel sets a value → the field was never app-edited, so the
  // blank live fingerprint == the blank base fingerprint → safe apply (the legitimate blank case).
  const stores = makeStores({
    m1: { id: 'm1', entityName: '', checklistResponses: {} },
  });
  const base = await baseFingerprintsFor({ entity: '' }); // blank at baseline
  const res = await materializeAcceptedOps({
    ops: [opRow({
      opUuid: 'u1', revision: 1, markerId: 'm1',
      changedFieldKeys: ['entity'],
      fields: { entity: 'NowSet' },
      baseFingerprints: base,
    })],
    templateId: 'tpl-1',
    getMarkers: stores.getMarkers, writeMarker: stores.writeMarker,
    getMeta: stores.getMeta, setMeta: stores.setMeta, ack: stores.ack,
  });
  assert.deepEqual(res.materialized, ['u1']);
  assert.equal(res.halted, false);
  assert.equal(stores.markers.m1.entityName, 'NowSet'); // applied (no app edit to lose)
});

test('materializeAcceptedOps applies a row whose live value already equals the incoming Excel value (no conflict)', async () => {
  // Live c1 already equals the incoming Excel value → not contested → safe apply.
  const stores = makeStores({
    m1: { id: 'm1', checklistResponses: { c1: { selection: 'SAME' } } },
  });
  const base = await baseFingerprintsFor({ answers: { c1: 'OTHER' } });
  const res = await materializeAcceptedOps({
    ops: [opRow({
      opUuid: 'u1', revision: 1, markerId: 'm1',
      changedFieldKeys: ['answer:c1', 'notes'],
      fields: { answers: { c1: 'SAME' }, notes: 'added note' },
      baseFingerprints: base,
    })],
    templateId: 'tpl-1',
    getMarkers: stores.getMarkers,
    writeMarker: stores.writeMarker,
    getMeta: stores.getMeta,
    setMeta: stores.setMeta,
  });
  assert.deepEqual(res.materialized, ['u1']);
  assert.equal(res.halted, false);
  assert.equal(stores.markers.m1.note.text, 'added note');
});

// ===========================================================================
// op_status handling (Codex finding #2) + contiguous frontier (finding #3)
// ===========================================================================

test('materializeAcceptedOps HALTS on a server client_conflict_review op_status (never materializes)', async () => {
  const stores = makeStores({ m1: { id: 'm1', checklistResponses: { c1: { selection: 'APP' } } } });
  const res = await materializeAcceptedOps({
    ops: [opRow({
      opUuid: 'u1', revision: 1, markerId: 'm1', opStatus: 'client_conflict_review',
      changedFieldKeys: ['answer:c1'], fields: { answers: { c1: 'X' } },
    })],
    templateId: 'tpl-1',
    getMarkers: stores.getMarkers, writeMarker: stores.writeMarker,
    getMeta: stores.getMeta, setMeta: stores.setMeta, ack: stores.ack,
  });
  assert.equal(res.halted, true);
  assert.equal(res.frontier, 0);
  assert.equal(res.materialized.length, 0);
  assert.equal(stores.markers.m1.checklistResponses.c1.selection, 'APP'); // untouched
});

test('materializeAcceptedOps advances PAST a resolved op WITHOUT re-overlaying app fields', async () => {
  const stores = makeStores({ m1: { id: 'm1', checklistResponses: { c1: { selection: 'KEEP-APP' } } } });
  let writes = 0;
  const res = await materializeAcceptedOps({
    ops: [opRow({
      opUuid: 'u1', revision: 1, markerId: 'm1', opStatus: 'resolved',
      changedFieldKeys: ['answer:c1'], fields: { answers: { c1: 'EXCEL' } },
    })],
    templateId: 'tpl-1',
    getMarkers: stores.getMarkers,
    writeMarker: (id, n) => { writes += 1; stores.writeMarker(id, n); },
    getMeta: stores.getMeta, setMeta: stores.setMeta, ack: stores.ack,
  });
  // resolved (keep-app/merged) → no overlay, no ack, frontier advances.
  assert.equal(writes, 0);
  assert.equal(stores.acks.length, 0);
  assert.deepEqual(res.skipped, ['u1']);
  assert.equal(res.frontier, 1);
  assert.equal(stores.markers.m1.checklistResponses.c1.selection, 'KEEP-APP');
});

test('materializeAcceptedOps STOPS on a revision gap (never advances the frontier past a hole)', async () => {
  // frontier=0; ops jump to rev 2 and 3 — rev 1 is missing. The reducer must not
  // apply rev 2/3 nor write the frontier; it signals a gap so the caller re-fetches.
  const stores = makeStores({ m1: { id: 'm1', checklistResponses: {} }, m2: { id: 'm2', checklistResponses: {} } });
  let writes = 0;
  const res = await materializeAcceptedOps({
    ops: [
      opRow({ opUuid: 'u2', revision: 2, markerId: 'm1', changedFieldKeys: ['answer:c'], fields: { answers: { c: '2' } } }),
      opRow({ opUuid: 'u3', revision: 3, markerId: 'm2', changedFieldKeys: ['answer:c'], fields: { answers: { c: '3' } } }),
    ],
    templateId: 'tpl-1',
    getMarkers: stores.getMarkers,
    writeMarker: (id, n) => { writes += 1; stores.writeMarker(id, n); },
    getMeta: stores.getMeta, setMeta: stores.setMeta, ack: stores.ack,
  });
  assert.equal(res.gap, true);
  assert.equal(writes, 0);
  assert.equal(res.materialized.length, 0);
  assert.equal(res.frontier, 0);
});

test('materializeAcceptedOps advances the frontier contiguously across multiple clean ops', async () => {
  const stores = makeStores({
    m1: { id: 'm1', checklistResponses: {} },
    m2: { id: 'm2', checklistResponses: {} },
    m3: { id: 'm3', checklistResponses: {} },
  });
  const res = await materializeAcceptedOps({
    ops: [
      opRow({ opUuid: 'u1', revision: 1, markerId: 'm1', changedFieldKeys: ['answer:c1'], fields: { answers: { c1: 'a' } } }),
      opRow({ opUuid: 'u2', revision: 2, markerId: 'm2', changedFieldKeys: ['answer:c2'], fields: { answers: { c2: 'b' } } }),
      opRow({ opUuid: 'u3', revision: 3, markerId: 'm3', changedFieldKeys: ['answer:c3'], fields: { answers: { c3: 'c' } } }),
    ],
    templateId: 'tpl-1',
    getMarkers: stores.getMarkers,
    writeMarker: stores.writeMarker,
    getMeta: stores.getMeta,
    setMeta: stores.setMeta,
    ack: stores.ack,
  });
  assert.deepEqual(res.materialized, ['u1', 'u2', 'u3']);
  assert.equal(res.frontier, 3);
  assert.equal(readFrontier({ getMeta: stores.getMeta, templateId: 'tpl-1' }), 3);
  assert.equal(stores.acks.length, 3);
});

test('materializeAcceptedOps processes ops in ascending revision regardless of input order', async () => {
  const stores = makeStores({ m1: { id: 'm1', checklistResponses: {} } });
  const res = await materializeAcceptedOps({
    ops: [
      opRow({ opUuid: 'u3', revision: 3, markerId: 'm1', changedFieldKeys: ['answer:c'], fields: { answers: { c: '3' } } }),
      opRow({ opUuid: 'u1', revision: 1, markerId: 'm1', changedFieldKeys: ['answer:c'], fields: { answers: { c: '1' } } }),
      opRow({ opUuid: 'u2', revision: 2, markerId: 'm1', changedFieldKeys: ['answer:c'], fields: { answers: { c: '2' } } }),
    ],
    templateId: 'tpl-1',
    getMarkers: stores.getMarkers,
    writeMarker: stores.writeMarker,
    getMeta: stores.getMeta,
    setMeta: stores.setMeta,
  });
  assert.deepEqual(res.materialized, ['u1', 'u2', 'u3']);
  // Last write wins → final value is the highest-revision op.
  assert.equal(stores.markers.m1.checklistResponses.c.selection, '3');
  assert.equal(res.frontier, 3);
});

// ===========================================================================
// 7. rpc wrappers
// ===========================================================================

test('fetchSince calls kal309_fetch_since with the mirror key + since revision', async () => {
  const supabase = makeSupabaseMock({ rpcResult: { data: [opRow({ opUuid: 'x', revision: 4, markerId: 'm' })], error: null } });
  const res = await fetchSince({ supabaseClient: supabase, documentId: 'doc-1', templateId: 'tpl-1', sinceRevision: 2 });
  assert.equal(supabase.calls.rpc[0].name, 'kal309_fetch_since');
  assert.deepEqual(supabase.calls.rpc[0].args, { p_document_id: 'doc-1', p_template_id: 'tpl-1', p_since_revision: 2 });
  assert.equal(res.ops.length, 1);
  assert.equal(res.error, null);
});

test('ackMaterialization calls kal309_ack_materialization and normalizes the boolean', async () => {
  const supabase = makeSupabaseMock({ rpcResult: { data: true, error: null } });
  const res = await ackMaterialization({ supabaseClient: supabase, documentId: 'd', templateId: 't', opUuid: 'op-1', status: 'materialized' });
  assert.equal(supabase.calls.rpc[0].name, 'kal309_ack_materialization');
  assert.deepEqual(supabase.calls.rpc[0].args, { p_document_id: 'd', p_template_id: 't', p_op_uuid: 'op-1', p_status: 'materialized' });
  assert.equal(res.ok, true);
});

test('ackMaterialization returns ok:false on an rpc error', async () => {
  const supabase = makeSupabaseMock({ rpcResult: { data: null, error: { message: 'boom' } } });
  const res = await ackMaterialization({ supabaseClient: supabase, documentId: 'd', templateId: 't', opUuid: 'op-1', status: 'materialized' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'boom');
});

test('resolveMaterializationConflict calls the resolve RPC with the resolution + fingerprints', async () => {
  const supabase = makeSupabaseMock({ rpcResult: { data: true, error: null } });
  const fps = { identityVector: 'iv', fields: { entity: 'merged' } };
  const res = await resolveMaterializationConflict({
    supabaseClient: supabase, documentId: 'd', templateId: 't', opUuid: 'op-9', resolution: 'merged', resolvedFingerprints: fps,
  });
  assert.equal(supabase.calls.rpc[0].name, 'kal309_resolve_materialization_conflict');
  assert.deepEqual(supabase.calls.rpc[0].args, {
    p_document_id: 'd', p_template_id: 't', p_op_uuid: 'op-9', p_resolution: 'merged', p_resolved_fingerprints: fps,
  });
  assert.equal(res.ok, true);
});

test('seedSyncState calls kal309_seed_sync_state with the marker array', async () => {
  const supabase = makeSupabaseMock({ rpcResult: { data: 3, error: null } });
  const markers = [{ markerAnnotationId: 'm1', scopeId: 'mod:cat', identityRecord: {}, assignedToken: 'tok' }];
  const res = await seedSyncState({ supabaseClient: supabase, documentId: 'd', templateId: 't', workbookId: 'wb_1', markers });
  assert.equal(supabase.calls.rpc[0].name, 'kal309_seed_sync_state');
  assert.deepEqual(supabase.calls.rpc[0].args, { p_document_id: 'd', p_template_id: 't', p_workbook_id: 'wb_1', p_markers: markers });
  assert.equal(res.count, 3);
});

test('setRegistrationSigningId calls kal309_set_registration_signing_id with workbookId (never registration id)', async () => {
  const supabase = makeSupabaseMock({ rpcResult: { data: true, error: null } });
  const res = await setRegistrationSigningId({ supabaseClient: supabase, documentId: 'd', templateId: 't', workbookId: 'wb_1', signingDocId: 'sig-1' });
  assert.equal(supabase.calls.rpc[0].name, 'kal309_set_registration_signing_id');
  assert.deepEqual(supabase.calls.rpc[0].args, { p_document_id: 'd', p_template_id: 't', p_workbook_id: 'wb_1', p_signing_doc_id: 'sig-1' });
  assert.equal(res.ok, true);
});

// ===========================================================================
// unit-level: normalizeOp + field readers
// ===========================================================================

test('normalizeOp accepts a fetch_since row and drops non-apply/create ops', () => {
  const apply = __test.normalizeOp(opRow({ opUuid: 'u', revision: 1, markerId: 'm', opType: 'apply', changedFieldKeys: ['notes'], fields: { notes: 'n' } }));
  assert.equal(apply.opType, 'apply');
  assert.equal(apply.excelRevision, 1);
  assert.deepEqual(apply.changedFieldKeys, ['notes']);

  const review = __test.normalizeOp({ op_uuid: 'r', excel_revision: 2, marker_annotation_id: 'm', op_type: 'review', patch_payload: {} });
  assert.equal(review, null, 'review ops carry no write → dropped');

  const noMarker = __test.normalizeOp({ op_uuid: 'x', excel_revision: 3, op_type: 'apply', patch_payload: {} });
  assert.equal(noMarker, null, 'an op without a marker id is dropped');
});

test('readMarkerField + readExcelField map the changedFieldKey convention correctly', () => {
  const marker = { name: 'X', entityName: 'E', note: { text: 'NT' }, checklistResponses: { c1: { selection: 'S' } } };
  assert.equal(__test.readMarkerField(marker, 'item'), 'X');
  assert.equal(__test.readMarkerField(marker, 'entity'), 'E');
  assert.equal(__test.readMarkerField(marker, 'notes'), 'NT');
  assert.equal(__test.readMarkerField(marker, 'answer:c1'), 'S');

  const fields = { item: 'Y', entity: 'F', notes: 'NT2', answers: { c1: 'S2' } };
  assert.equal(__test.readExcelField(fields, 'item'), 'Y');
  assert.equal(__test.readExcelField(fields, 'entity'), 'F');
  assert.equal(__test.readExcelField(fields, 'notes'), 'NT2');
  assert.equal(__test.readExcelField(fields, 'answer:c1'), 'S2');
});
