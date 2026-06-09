// Tier-4 field-overlap recovery for blank-Row-ID rows (locked blank-rowid amendments,
// .planning/blank-rowid-matching-verdict.md, 2026-06-09). A blank-ID row whose content
// was edited in Excel no longer fingerprint-matches its marker's baseline; before this
// tier the matcher emitted 'new-row' → a duplicate Survey Marker, and the orphaned
// original entered candidateDeletes (auto-trash after any export). These tests drive the
// REAL matcher + fingerprint modules.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildImportPlan, IMPORT_ACTIONS } from '../rowImportMatcher.js';
import { getOrCreateDocumentSecret, resolveDocumentSecret } from '../rowIdSecretStore.js';
import { computeRowFingerprints } from '../rowFingerprint.js';

const makeStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

const DOC = 'doc-overlap';
const SCOPE = 'mod-1:cat-1';
const storage = makeStorage();
getOrCreateDocumentSecret(DOC, storage);
const resolveSecret = (kid) => resolveDocumentSecret(DOC, kid, storage);

const storedFor = async (markerId, values) => {
  const fp = await computeRowFingerprints(values);
  return { markerId, identityVectorFingerprint: fp.identityVectorFingerprint, fullRowFingerprint: fp.fullRowFingerprint, fieldFingerprints: fp.fieldFingerprints };
};

const plan = (rows, stored) => buildImportPlan({ rows, stored, documentId: DOC, scopeId: SCOPE, resolveSecret });
const blankRow = (values) => ({ rowIdCell: '', values });

test('T1 verbatim bug: Excel edits notes on a blank-ID row → one apply pairing to the original marker, no duplicate, no delete candidate', async () => {
  // Baseline stamped at export: Item="test", notes blank. The app-side note ("car") is
  // irrelevant at the matcher level — it feeds the downstream conflict guard, which this
  // pairing keeps reachable by emitting action 'apply' with a markerId.
  const baseline = { changedBy: 'IC', changedDate: '6/8/2026', item: 'test', entity: '', notes: '', answers: {} };
  const stored = [await storedFor('m1', baseline)];
  const rows = [blankRow({ ...baseline, notes: 'not car' })]; // the Excel-side edit
  const { decisions, candidateDeletes } = await plan(rows, stored);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].decision, 'missing-rowid');
  assert.equal(decisions[0].action, IMPORT_ACTIONS.APPLY);
  assert.equal(decisions[0].markerId, 'm1');
  assert.equal(decisions[0].recovered, true);
  assert.deepEqual(candidateDeletes, [], 'the original is paired, never a delete candidate');
});

test('T5 Excel-only edit to a blank-ID row → same pairing, zero creates', async () => {
  const baseline = { changedBy: 'IC', changedDate: '6/8/2026', item: 'Door 12', entity: 'North', notes: 'note', answers: { q1: 'Y' } };
  const stored = [await storedFor('m1', baseline)];
  const rows = [blankRow({ ...baseline, notes: 'edited only in Excel' })];
  const { decisions, candidateDeletes } = await plan(rows, stored);
  assert.deepEqual(decisions.map((d) => d.decision), ['missing-rowid']);
  assert.equal(decisions[0].markerId, 'm1');
  assert.equal(decisions[0].action, IMPORT_ACTIONS.APPLY);
  assert.deepEqual(candidateDeletes, []);
});

test('T9 repeated save xN → one pairing each time, never a create (before AND after baseline restamp)', async () => {
  const baseline = { changedBy: 'IC', changedDate: '6/8/2026', item: 'test', entity: '', notes: '', answers: {} };
  const edited = { ...baseline, notes: 'not car' };

  // Phase 1: the import was not yet applied (baseline unchanged) — N identical saves.
  const staleStored = [await storedFor('m1', baseline)];
  for (let i = 0; i < 3; i += 1) {
    const { decisions } = await plan([blankRow(edited)], staleStored);
    assert.deepEqual(decisions.map((d) => d.decision), ['missing-rowid'], `save #${i + 1} pairs`);
    assert.equal(decisions[0].markerId, 'm1');
    assert.ok(decisions.every((d) => d.action !== IMPORT_ACTIONS.CREATE), `save #${i + 1} never creates`);
  }

  // Phase 2: the apply restamped the baseline to the edited values — the next save
  // recovers by exact fingerprint, still one marker.
  const restamped = [await storedFor('m1', edited)];
  const { decisions } = await plan([blankRow(edited)], restamped);
  assert.deepEqual(decisions.map((d) => d.decision), ['missing-rowid']);
  assert.equal(decisions[0].markerId, 'm1');
});

test('T10 genuinely new row (no shared non-blank identity field) → still new-row create', async () => {
  const baseline = { changedBy: 'IC', changedDate: '6/8/2026', item: 'Door 12', entity: 'North', notes: 'note', answers: { q1: 'Y' } };
  const stored = [await storedFor('m1', baseline)];
  // Shares ONLY the audit columns (changedBy/changedDate) — those never establish identity.
  const rows = [blankRow({ changedBy: 'IC', changedDate: '6/8/2026', item: 'Brand New', entity: 'South', notes: 'unrelated', answers: { q1: 'N' } })];
  const { decisions, candidateDeletes } = await plan(rows, stored);
  assert.equal(decisions[0].decision, 'new-row');
  assert.equal(decisions[0].action, IMPORT_ACTIONS.CREATE);
  assert.deepEqual(candidateDeletes, ['m1'], 'unreferenced leftover stays a delete candidate (existing Pass-4 semantics)');
});

test('T12 blank==blank fields never count as overlap', async () => {
  // Marker and row share blank entity, blank notes, and a blank answer — zero signal.
  const stored = [await storedFor('m1', { changedBy: 'IC', changedDate: '6/8/2026', item: 'Door 1', entity: '', notes: '', answers: { q1: '' } })];
  const rows = [blankRow({ changedBy: 'IC', changedDate: '6/8/2026', item: 'Door 2', entity: '', notes: '', answers: { q1: '' } })];
  const { decisions } = await plan(rows, stored);
  assert.equal(decisions[0].decision, 'new-row');
  assert.equal(decisions[0].action, IMPORT_ACTIONS.CREATE);
});

test('T13 result is independent of row order', async () => {
  const base = (item, notes, q1) => ({ changedBy: 'IC', changedDate: '6/8/2026', item, entity: '', notes, answers: { q1 } });
  const stored = [
    await storedFor('mA', base('alpha', 'x', 'A1')),
    await storedFor('mB', base('beta', 'y', 'B1'))
  ];
  const rA = base('alpha', 'x edited', 'A2'); // overlaps mA only (item)
  const rB = base('beta', 'y edited', 'B2'); // overlaps mB only (item)
  const rNew = base('gamma', 'zzz', 'C3'); // overlaps nothing

  const outcomes = async (rows) => {
    const { decisions } = await plan(rows.map(blankRow), stored);
    // Key each decision by the row's Item so the two orders are comparable. NB: `rows`
    // here is THIS function's parameter (the per-call ordering), not an outer fixture —
    // d.rowIndex indexes into the same array that was passed to plan().
    return new Map(decisions.map((d) => [rows[d.rowIndex].item, `${d.decision}:${d.markerId || ''}`]));
  };

  const forward = await outcomes([rA, rB, rNew]);
  const reversed = await outcomes([rNew, rB, rA]);
  assert.deepEqual(Object.fromEntries(forward), Object.fromEntries(reversed));
  assert.equal(forward.get('alpha'), 'missing-rowid:mA');
  assert.equal(forward.get('beta'), 'missing-rowid:mB');
  assert.equal(forward.get('gamma'), 'new-row:');
});

test('2x2 byte-identical group → both paired in stable order, zero creates, zero reviews (Amendment #4)', async () => {
  const v = { changedBy: 'IC', changedDate: '6/8/2026', item: 'Twin', entity: 'North', notes: 'same', answers: { q1: 'Y' } };
  const stored = [await storedFor('m1', v), await storedFor('m2', v)];
  const rows = [blankRow(v), blankRow(v)];
  const { decisions, candidateDeletes } = await plan(rows, stored);
  assert.equal(decisions.length, 2);
  assert.deepEqual(decisions.map((d) => d.decision), ['missing-rowid', 'missing-rowid']);
  assert.deepEqual(decisions.map((d) => d.action), [IMPORT_ACTIONS.APPLY, IMPORT_ACTIONS.APPLY]);
  assert.deepEqual(decisions.map((d) => d.markerId), ['m1', 'm2'], 'row order × stored order');
  assert.deepEqual(candidateDeletes, []);
});

test('cross-fingerprint 2x2 group (Pass 3b): two byte-identical EDITED rows vs two byte-identical baseline markers → group-pairs via field overlap, zero creates/reviews/deletes', async () => {
  // Unlike the exact 2x2 test above, the rows do NOT fingerprint-match the markers
  // (notes edited in Excel), so Pass 3a yields zero candidates and the pairing must come
  // from Pass 3b's identical-group rule: both rows share item 'Twin' with both markers,
  // all candidates are byte-identical to each other, and no row OUTSIDE the group
  // contends them — Amendment #4 pairs min(2,2) in row order × stored order.
  const baseline = { changedBy: 'IC', changedDate: '6/8/2026', item: 'Twin', entity: 'North', notes: 'original', answers: { q1: 'Y' } };
  const edited = { ...baseline, notes: 'edited in excel' };
  const stored = [await storedFor('m1', baseline), await storedFor('m2', baseline)];
  const rows = [blankRow(edited), blankRow(edited)];
  const { decisions, candidateDeletes } = await plan(rows, stored);
  assert.equal(decisions.length, 2);
  assert.deepEqual(decisions.map((d) => d.decision), ['missing-rowid', 'missing-rowid']);
  assert.deepEqual(decisions.map((d) => d.action), [IMPORT_ACTIONS.APPLY, IMPORT_ACTIONS.APPLY]);
  assert.deepEqual(decisions.map((d) => d.markerId), ['m1', 'm2'], 'row order × stored order');
  assert.deepEqual(decisions.map((d) => d.recoveredBy), ['field-overlap', 'field-overlap'], 'proves Pass 3b (not 3a) did the pairing');
  assert.deepEqual(candidateDeletes, []);
});

test('one marker contended by two NON-identical rows → both review, marker shielded from deletes (either-direction ambiguity)', async () => {
  const stored = [await storedFor('m1', { changedBy: 'IC', changedDate: '6/8/2026', item: 'Door 12', entity: '', notes: 'baseline', answers: {} })];
  const rows = [
    blankRow({ changedBy: 'IC', changedDate: '6/8/2026', item: 'Door 12', entity: '', notes: 'first edit', answers: {} }),
    blankRow({ changedBy: 'IC', changedDate: '6/8/2026', item: 'Door 12', entity: '', notes: 'second edit', answers: {} })
  ];
  const { decisions, candidateDeletes } = await plan(rows, stored);
  assert.deepEqual(decisions.map((d) => d.decision), ['ambiguous-identity', 'ambiguous-identity']);
  assert.ok(decisions.every((d) => d.action === 'review'));
  assert.ok(decisions.every((d) => d.candidateMarkerIds.length === 1 && d.candidateMarkerIds[0] === 'm1'));
  assert.deepEqual(candidateDeletes, [], 'a review-listed candidate is never a delete candidate');
});

test('a stored marker without fieldFingerprints degrades safely: no overlap, no crash', async () => {
  const baseline = { changedBy: 'IC', changedDate: '6/8/2026', item: 'Door 12', entity: '', notes: '', answers: {} };
  const legacy = await storedFor('m1', baseline);
  delete legacy.fieldFingerprints; // older identity record shape
  const { decisions } = await plan([blankRow({ ...baseline, notes: 'edited' })], [legacy]);
  assert.equal(decisions[0].decision, 'new-row'); // content-only tier unavailable → fail safe to create
});
