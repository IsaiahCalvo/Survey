// Slice 3 of the blank-Row-ID matching plan (.planning/blank-rowid-matching-verdict.md,
// AMENDMENTS section — GOVERNING): group-aware exact matching + the positional tier.
// Isaiah's five verbatim examples are EX1-EX5 below; the rest are the locked hardening
// scenarios (insert-shift, scramble, total rewrite, content swap, conservation,
// cross-scope reconciliation, degrade-to-slice-1). All tests drive the REAL matcher +
// fingerprint + token modules.
//
// Positional inputs: rows carry sheetRowNumber (TRUE 1-based sheet row); stored markers
// carry lastSeenRowNumber + lastIngestSeq (device-local stamps from the last ingested
// save). Trust requires every leftover stamped from ONE snapshot with order-consistent
// anchors; otherwise results are byte-identical to the content-only matcher.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildImportPlan, IMPORT_ACTIONS } from '../rowImportMatcher.js';
import { generateRowIdToken } from '../rowIdToken.js';
import { computeRowFingerprints } from '../rowFingerprint.js';

const KEY_ID = 'k1';
const SECRET = 'dGVzdC1zZWNyZXQtZm9yLXBvc2l0aW9uYWwtdGllcg==';
const DOC = 'doc-positional';
const SCOPE = 'mod-1:cat-1';
const SEQ = 100; // one snapshot for every stamped marker unless a test says otherwise
const resolveSecret = (keyId) => (keyId === KEY_ID ? SECRET : null);

const v = (item, notes = '', answers = {}) =>
  ({ changedBy: 'IC', changedDate: '6/8/2026', item, entity: '', notes, answers });

const storedFor = async (markerId, values, lastSeenRowNumber = null, lastIngestSeq = null) => {
  const fp = await computeRowFingerprints(values);
  return {
    markerId,
    identityVectorFingerprint: fp.identityVectorFingerprint,
    fullRowFingerprint: fp.fullRowFingerprint,
    fieldFingerprints: fp.fieldFingerprints,
    lastSeenRowNumber,
    lastIngestSeq
  };
};

const blankRow = (values, sheetRowNumber = null) => ({ rowIdCell: '', values, sheetRowNumber });
const tokenFor = (markerId) =>
  generateRowIdToken({ keyId: KEY_ID, secret: SECRET, documentId: DOC, scopeId: SCOPE, markerId });

const plan = (rows, stored, extra = {}) =>
  buildImportPlan({ rows, stored, documentId: DOC, scopeId: SCOPE, resolveSecret, ...extra });

// decision for the row at array index i
const dAt = (decisions, i) => decisions.find((d) => d.rowIndex === i);

// ---------------------------------------------------------------------------
// Isaiah's five verbatim examples
// ---------------------------------------------------------------------------

test('EX1: row7 test/blank edited to test/"not car" in Excel → ONE pairing (conflict handled downstream), no duplicate', async () => {
  const stored = [await storedFor('m1', v('test', ''), 7, SEQ)];
  const rows = [blankRow(v('test', 'not car'), 7)];
  const { decisions, candidateDeletes } = await plan(rows, stored);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].decision, 'missing-rowid');
  assert.equal(decisions[0].action, IMPORT_ACTIONS.APPLY, 'apply keeps the both-sides conflict guard reachable');
  assert.equal(decisions[0].markerId, 'm1');
  assert.deepEqual(candidateDeletes, []);
});

test('EX2: row7 "test" moved to row2 → matched by the EXACT tier (position is irrelevant to an exact match)', async () => {
  const stored = [await storedFor('m1', v('test'), 7, SEQ)];
  const rows = [blankRow(v('test'), 2)];
  const { decisions, candidateDeletes } = await plan(rows, stored);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].decision, 'missing-rowid');
  assert.equal(decisions[0].markerId, 'm1');
  assert.equal(decisions[0].recoveredBy, undefined, 'exact-tier recovery, not positional');
  assert.deepEqual(candidateDeletes, []);
});

test('EX3: identical rows 5,7 now at 5,2 → same-slot 5→5 first, elimination 7→2; zero creates, zero reviews', async () => {
  const twin = v('test');
  const stored = [await storedFor('m5', twin, 5, SEQ), await storedFor('m7', twin, 7, SEQ)];
  const rows = [blankRow(twin, 2), blankRow(twin, 5)]; // sheet order
  const { decisions, candidateDeletes } = await plan(rows, stored);
  assert.equal(decisions.length, 2);
  assert.ok(decisions.every((d) => d.decision === 'missing-rowid' && d.action === IMPORT_ACTIONS.APPLY));
  assert.equal(dAt(decisions, 1).markerId, 'm5', 'row at sheet 5 keeps the slot-5 marker');
  assert.equal(dAt(decisions, 0).markerId, 'm7', 'row at sheet 2 takes the remaining twin');
  assert.deepEqual(candidateDeletes, []);
});

test('EX4: rows 5,7 test/blank → row5 test/"abc" + row2 test/blank → 5→5 (field overlap + slot), 7→2 (exact residue)', async () => {
  const base = v('test', '');
  const stored = [await storedFor('m5', base, 5, SEQ), await storedFor('m7', base, 7, SEQ)];
  const rows = [blankRow(v('test', ''), 2), blankRow(v('test', 'abc'), 5)];
  const { decisions, candidateDeletes } = await plan(rows, stored);
  assert.equal(decisions.length, 2);
  assert.ok(decisions.every((d) => d.decision === 'missing-rowid' && d.action === IMPORT_ACTIONS.APPLY));
  assert.equal(dAt(decisions, 1).markerId, 'm5', 'edited row at slot 5 takes the slot-5 marker');
  assert.equal(dAt(decisions, 1).recoveredBy, 'positional', 'paired by the positional tier (unchanged item corroborates)');
  assert.equal(dAt(decisions, 0).markerId, 'm7', 'unchanged row takes the remaining exact twin');
  assert.equal(dAt(decisions, 0).recoveredBy, undefined, 'exact residue, not positional');
  assert.deepEqual(candidateDeletes, []);
});

test('EX5: identical rows 5,7 now at 1,2 → order-preserving pairing, zero creates, zero reviews', async () => {
  const twin = v('Twin', 'same');
  const stored = [await storedFor('mA', twin, 5, SEQ), await storedFor('mB', twin, 7, SEQ)];
  const rows = [blankRow(twin, 1), blankRow(twin, 2)];
  const { decisions, candidateDeletes } = await plan(rows, stored);
  assert.equal(decisions.length, 2);
  assert.ok(decisions.every((d) => d.decision === 'missing-rowid' && d.action === IMPORT_ACTIONS.APPLY));
  assert.equal(dAt(decisions, 0).markerId, 'mA', 'relative sheet order preserved');
  assert.equal(dAt(decisions, 1).markerId, 'mB');
  assert.deepEqual(candidateDeletes, []);
});

// ---------------------------------------------------------------------------
// Positional-tier hardening scenarios
// ---------------------------------------------------------------------------

test('insert-row-above: flanking-anchor offsets keep the corroborated match; the inserted row still creates', async () => {
  // Anchor: token-matched marker whose row shifted 2→3 (one row inserted at the top).
  // The leftover at stored slot 5 shifted the same way → its edited row sits at 6.
  const token = await tokenFor('mAnchor');
  const stored = [
    await storedFor('mAnchor', v('Anchor Row', 'a'), 2, SEQ),
    await storedFor('mX', v('Door', 'x'), 5, SEQ)
  ];
  const rows = [
    blankRow(v('Brand New', ''), 2), // the inserted row
    { rowIdCell: token, values: v('Anchor Row', 'a'), sheetRowNumber: 3 },
    blankRow(v('Door', 'y'), 6) // edited (notes) + shifted with the layout
  ];
  const { decisions, candidateDeletes } = await plan(rows, stored);
  assert.equal(dAt(decisions, 1).decision, 'match');
  assert.equal(dAt(decisions, 2).decision, 'missing-rowid');
  assert.equal(dAt(decisions, 2).markerId, 'mX');
  assert.equal(dAt(decisions, 2).recoveredBy, 'positional',
    'flank offset (3 + (5-2) = 6) agrees even though the ABSOLUTE slot moved 5→6');
  assert.equal(dAt(decisions, 0).decision, 'new-row');
  assert.deepEqual(candidateDeletes, []);
});

test('insert-row-above + TOTAL REWRITE at the (shifted) stable slot → still a silent pairing via flank offsets', async () => {
  const token = await tokenFor('mAnchor');
  const stored = [
    await storedFor('mAnchor', v('Anchor Row', 'a'), 2, SEQ),
    await storedFor('mX', v('Door'), 5, SEQ)
  ];
  const rows = [
    { rowIdCell: token, values: v('Anchor Row', 'a'), sheetRowNumber: 3 },
    blankRow(v('Window'), 6) // every identity field changed; slot stable RELATIVE to the anchor
  ];
  const { decisions, candidateDeletes } = await plan(rows, stored);
  assert.equal(dAt(decisions, 1).decision, 'missing-rowid', 'Amendment #2: total rewrite at a stable slot = silent match');
  assert.equal(dAt(decisions, 1).action, IMPORT_ACTIONS.APPLY);
  assert.equal(dAt(decisions, 1).markerId, 'mX');
  assert.equal(dAt(decisions, 1).recoveredBy, 'positional');
  assert.ok(decisions.every((d) => d.action !== IMPORT_ACTIONS.REVIEW), 'no moved-or-replaced review exists');
  assert.deepEqual(candidateDeletes, []);
});

test('sort scramble: anchors out of order → positional tier disabled; exact matches still fine; rewrite row creates', async () => {
  const tokA = await tokenFor('mA');
  const tokB = await tokenFor('mB');
  const stored = [
    await storedFor('mA', v('A', 'a'), 2, SEQ),
    await storedFor('mB', v('B', 'b'), 3, SEQ),
    await storedFor('mE', v('Exact', 'e'), 4, SEQ),
    await storedFor('mX', v('test'), 7, SEQ)
  ];
  // The sheet was sorted: mB's row now sits ABOVE mA's → anchor order is inconsistent.
  const rows = [
    { rowIdCell: tokB, values: v('B', 'b'), sheetRowNumber: 2 },
    { rowIdCell: tokA, values: v('A', 'a'), sheetRowNumber: 5 },
    blankRow(v('Exact', 'e'), 4), // exact fingerprint → pairs regardless
    blankRow(v('car'), 7) // total rewrite "at slot 7" — but order is untrusted
  ];
  const { decisions, candidateDeletes } = await plan(rows, stored);
  assert.equal(dAt(decisions, 0).markerId, 'mB');
  assert.equal(dAt(decisions, 1).markerId, 'mA');
  assert.equal(dAt(decisions, 2).decision, 'missing-rowid', 'exact recovery survives the scramble');
  assert.equal(dAt(decisions, 2).markerId, 'mE');
  assert.equal(dAt(decisions, 3).decision, 'new-row', 'no positional guess under a sort/scramble');
  assert.deepEqual(candidateDeletes, ['mX'], 'the orphan follows normal delete semantics — never a prompt');
});

test("total rewrite at a stable slot (Isaiah's rename: row7 test→car) → SILENT same-row match", async () => {
  const stored = [await storedFor('m1', v('test'), 7, SEQ)];
  const rows = [blankRow(v('car'), 7)];
  const { decisions, candidateDeletes } = await plan(rows, stored);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].decision, 'missing-rowid');
  assert.equal(decisions[0].action, IMPORT_ACTIONS.APPLY);
  assert.equal(decisions[0].markerId, 'm1');
  assert.equal(decisions[0].recoveredBy, 'positional');
  assert.deepEqual(candidateDeletes, []);
});

test('TWO simultaneous total rewrites in a conserved scope → BOTH silently pair (conservation is loop-invariant)', async () => {
  // Pins the accepted Amendment-#2 window: each pairing consumes one row AND one
  // leftover, so N conserved rewrites stay conserved at N-1 — the once-computed
  // `conserved` gate is exact, not an approximation.
  const stored = [await storedFor('m5', v('test'), 5, SEQ), await storedFor('m9', v('door'), 9, SEQ)];
  const rows = [blankRow(v('car'), 5), blankRow(v('window'), 9)]; // zero shared fields anywhere
  const { decisions, candidateDeletes } = await plan(rows, stored);
  assert.equal(decisions.length, 2);
  assert.ok(decisions.every((d) => d.decision === 'missing-rowid' && d.action === IMPORT_ACTIONS.APPLY));
  assert.equal(dAt(decisions, 0).markerId, 'm5');
  assert.equal(dAt(decisions, 0).recoveredBy, 'positional');
  assert.equal(dAt(decisions, 1).markerId, 'm9');
  assert.equal(dAt(decisions, 1).recoveredBy, 'positional');
  assert.deepEqual(candidateDeletes, []);
});

test('stamped position with NULL lastIngestSeq → positional tier disabled (no snapshot, no graft)', async () => {
  // buildMarkerIdentityRecord always writes both fields together, but a position-without-
  // seq record must never be treated as a coherent snapshot (explicit trust-gate guard).
  const stored = [await storedFor('mX', v('test'), 7, null)];
  const rows = [blankRow(v('car'), 7)];
  const { decisions, candidateDeletes } = await plan(rows, stored);
  assert.equal(decisions[0].decision, 'new-row', 'slice-1 behavior: total rewrite creates');
  assert.deepEqual(candidateDeletes, ['mX']);
});

test('total rewrite while the layout is NOT explained → no pairing: create + normal delete path (Amendment #3)', async () => {
  // Variant A: slot agrees but the population is not conserved (an extra row appeared).
  const storedA = [await storedFor('mX', v('test'), 7, SEQ)];
  const rowsA = [blankRow(v('car'), 7), blankRow(v('new thing', 'z'), 12)];
  const a = await plan(rowsA, storedA);
  assert.equal(dAt(a.decisions, 0).decision, 'new-row', 'unexplained row-count delta blocks the slot graft');
  assert.equal(dAt(a.decisions, 1).decision, 'new-row');
  assert.deepEqual(a.candidateDeletes, ['mX']);
  assert.ok(a.decisions.every((d) => d.action !== IMPORT_ACTIONS.REVIEW), 'delete-and-replace NEVER prompts');

  // Variant B: population conserved but the slot moved (7 → 9) with no anchor explaining it.
  const storedB = [await storedFor('mX', v('test'), 7, SEQ)];
  const rowsB = [blankRow(v('car'), 9)];
  const b = await plan(rowsB, storedB);
  assert.equal(b.decisions[0].decision, 'new-row', 'an unstable slot never grafts');
  assert.deepEqual(b.candidateDeletes, ['mX']);
});

test('content swap between two rows: pairings follow CONTENT, not slots (exact tier outranks position)', async () => {
  const stored = [
    await storedFor('m5', v('A', 'noteA'), 5, SEQ),
    await storedFor('m7', v('B', 'noteB'), 7, SEQ)
  ];
  const rows = [
    blankRow(v('B', 'noteB'), 5), // m7's content sitting in m5's slot
    blankRow(v('A', 'noteA'), 7) // m5's content sitting in m7's slot
  ];
  const { decisions, candidateDeletes } = await plan(rows, stored);
  assert.equal(dAt(decisions, 0).markerId, 'm7', 'exact content wins over the slot');
  assert.equal(dAt(decisions, 1).markerId, 'm5');
  assert.deepEqual(candidateDeletes, []);
});

test('content swap WITH one-field edits: reviews instead of grafting a rewrite by slot', async () => {
  const stored = [
    await storedFor('mA', v('A', 'noteA'), 5, SEQ),
    await storedFor('mB', v('B', 'noteB'), 7, SEQ)
  ];
  const rows = [
    blankRow(v('B', 'noteB-edited'), 5), // mB's row, edited AND moved into mA's slot
    blankRow(v('A', 'noteA-edited'), 7)
  ];
  const { decisions, candidateDeletes } = await plan(rows, stored);
  assert.equal(dAt(decisions, 0).decision, 'ambiguous-identity');
  assert.deepEqual(dAt(decisions, 0).candidateMarkerIds, ['mB'], 'shared item "B" is review evidence, not a slot graft');
  assert.equal(dAt(decisions, 1).decision, 'ambiguous-identity');
  assert.deepEqual(dAt(decisions, 1).candidateMarkerIds, ['mA']);
  assert.deepEqual(candidateDeletes, []);
});

test('missing stamps → byte-identical to content-only tiers; one-field residue reviews', async () => {
  const base = v('test', '');
  // No positions anywhere → slice-1: exact group pairs in row order × stored order,
  // then field overlap takes the remaining twin.
  const storedBare = [await storedFor('m5', base), await storedFor('m7', base)];
  const rowsBare = [blankRow(v('test', '')), blankRow(v('test', 'abc'))];
  const bare = await plan(rowsBare, storedBare);
  assert.equal(dAt(bare.decisions, 0).markerId, 'm5', 'slice-1 stable order: first row × first stored');
  assert.equal(dAt(bare.decisions, 1).decision, 'ambiguous-identity');
  assert.deepEqual(dAt(bare.decisions, 1).candidateMarkerIds, ['m7']);
  assert.deepEqual(bare.candidateDeletes, []);

  // Stale mix (two different ingest snapshots) → trust fails → same slice-1 results.
  const storedStale = [await storedFor('m5', base, 5, SEQ), await storedFor('m7', base, 7, SEQ + 1)];
  const rowsPos = [blankRow(v('test', ''), 2), blankRow(v('test', 'abc'), 5)];
  const stale = await plan(rowsPos, storedStale);
  assert.equal(dAt(stale.decisions, 0).markerId, 'm5', 'mixed lastIngestSeq disables the positional tier');
  assert.equal(dAt(stale.decisions, 1).decision, 'ambiguous-identity');
  assert.deepEqual(dAt(stale.decisions, 1).candidateMarkerIds, ['m7']);
});

test('cross-scope reconciliation: a marker whose baseline reappeared in ANOTHER scope is never eliminated-against locally', async () => {
  const cutValues = v('Cut Row', 'payload');
  const stored = [await storedFor('mCut', cutValues)];
  // A DIFFERENT local blank row shares the Item — without the shield it would pair.
  const rows = [blankRow(v('Cut Row', 'something else'))];

  const unshielded = await plan(rows, stored);
  assert.equal(unshielded.decisions[0].decision, 'ambiguous-identity', 'sanity: one-field overlap reviews without the shield');
  assert.deepEqual(unshielded.decisions[0].candidateMarkerIds, ['mCut']);

  const cutFp = (await computeRowFingerprints(cutValues)).identityVectorFingerprint;
  const shielded = await plan(rows, stored, { crossScopeBlankFingerprints: new Set([cutFp]) });
  assert.equal(shielded.decisions[0].decision, 'new-row', 'the cut row lives in another scope — no local graft');
  assert.deepEqual(shielded.candidateDeletes, ['mCut'], 'the move degrades to silent delete+create (restorable)');
  assert.ok(shielded.decisions.every((d) => d.action !== IMPORT_ACTIONS.REVIEW));
});

test('precedence: Row-ID token > exact fingerprint > position — a token row is never re-routed by slot or twin content', async () => {
  const token = await tokenFor('mTok');
  const twin = v('Twin', 'same');
  const stored = [
    await storedFor('mTok', twin, 2, SEQ),
    await storedFor('mTwin', twin, 5, SEQ)
  ];
  // The token row sits in mTwin's old slot with mTwin-identical content; the blank twin
  // sits elsewhere. Token must bind first; the blank twin takes the remaining marker.
  const rows = [
    { rowIdCell: token, values: twin, sheetRowNumber: 5 },
    blankRow(twin, 9)
  ];
  const { decisions, candidateDeletes } = await plan(rows, stored);
  assert.equal(dAt(decisions, 0).decision, 'match');
  assert.equal(dAt(decisions, 0).markerId, 'mTok');
  assert.equal(dAt(decisions, 1).decision, 'missing-rowid');
  assert.equal(dAt(decisions, 1).markerId, 'mTwin');
  assert.deepEqual(candidateDeletes, []);
});

test('genuine ambiguity is untouched: multiple NON-identical candidates either direction still review', async () => {
  // Two non-identical leftovers both share the item with one edited row, positions
  // missing → exactly the slice-1 review (the positional tier must not change this).
  const stored = [
    await storedFor('m1', v('Door 12', 'baseline-1')),
    await storedFor('m2', v('Door 12', 'baseline-2'))
  ];
  const rows = [blankRow(v('Door 12', 'edited'))];
  const { decisions, candidateDeletes } = await plan(rows, stored);
  assert.equal(decisions[0].decision, 'ambiguous-identity');
  assert.equal(decisions[0].action, IMPORT_ACTIONS.REVIEW);
  assert.deepEqual([...decisions[0].candidateMarkerIds].sort(), ['m1', 'm2']);
  assert.deepEqual(candidateDeletes, [], 'review-listed candidates stay shielded from deletes');
});
