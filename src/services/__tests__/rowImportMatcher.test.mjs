import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildImportPlan, IMPORT_ACTIONS } from '../rowImportMatcher.js';
import { generateRowIdToken } from '../rowIdToken.js';
import { getOrCreateDocumentSecret, resolveDocumentSecret } from '../rowIdSecretStore.js';
import { computeRowFingerprints } from '../rowFingerprint.js';

const makeStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

const DOC = 'doc-1';
const SCOPE = 'mod-1:cat-1';
const storage = makeStorage();
const { keyId, secret } = getOrCreateDocumentSecret(DOC, storage);
const resolveSecret = (kid) => resolveDocumentSecret(DOC, kid, storage);

const tokenFor = (markerId, { documentId = DOC, scopeId = SCOPE, sec = secret } = {}) =>
  generateRowIdToken({ keyId, secret: sec, documentId, scopeId, markerId });

// A stored marker entry = the marker's exported values fingerprinted.
const storedFor = async (markerId, values) => {
  const fp = await computeRowFingerprints(values);
  return { markerId, identityVectorFingerprint: fp.identityVectorFingerprint, fullRowFingerprint: fp.fullRowFingerprint, fieldFingerprints: fp.fieldFingerprints };
};

const vals = (over = {}) => ({ changedBy: 'IC', changedDate: '6/8/2026', item: 'Door 12', entity: 'North', notes: 'note', answers: { q1: 'Y' }, ...over });

test('valid in-scope exported token → match (apply); unchanged row reports changed=false', async () => {
  const v = vals();
  const stored = [await storedFor('m1', v)];
  const rows = [{ rowIdCell: await tokenFor('m1'), values: v }];
  const { decisions, candidateDeletes } = await buildImportPlan({ rows, stored, documentId: DOC, scopeId: SCOPE, resolveSecret });
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].decision, 'match');
  assert.equal(decisions[0].action, IMPORT_ACTIONS.APPLY);
  assert.equal(decisions[0].markerId, 'm1');
  assert.equal(decisions[0].changed, false);
  assert.deepEqual(candidateDeletes, []);
});

test('rename + answer edit on the same token → still match, with changed fields reported', async () => {
  const stored = [await storedFor('m1', vals())];
  const edited = vals({ item: 'Door 13', answers: { q1: 'N' } });
  const rows = [{ rowIdCell: await tokenFor('m1'), values: edited }];
  const { decisions } = await buildImportPlan({ rows, stored, documentId: DOC, scopeId: SCOPE, resolveSecret });
  assert.equal(decisions[0].decision, 'match');
  assert.equal(decisions[0].changed, true);
  assert.deepEqual(decisions[0].changedFields, ['answer:q1', 'item']);
});

test('copied row (same token twice) → first is the original (match), second becomes a new copy', async () => {
  const stored = [await storedFor('m1', vals())];
  const tok = await tokenFor('m1');
  const rows = [
    { rowIdCell: tok, values: vals() },
    { rowIdCell: tok, values: vals() } // an exact copy/paste in Excel
  ];
  const { decisions, candidateDeletes } = await buildImportPlan({ rows, stored, documentId: DOC, scopeId: SCOPE, resolveSecret });
  assert.equal(decisions[0].decision, 'match');
  assert.equal(decisions[0].markerId, 'm1');
  assert.equal(decisions[1].decision, 'copy-new');
  assert.equal(decisions[1].action, IMPORT_ACTIONS.CREATE);
  assert.equal(decisions[1].copyOfMarkerId, 'm1');
  assert.equal(decisions[1].copyOrdinal, 1);
  assert.deepEqual(candidateDeletes, []);
});

test('re-saving the same copied rows is idempotent: the copy applies to its marker, no new twin', async () => {
  const v = vals();
  // After the first import the copy became marker m2, remembered by its lineage.
  const stored = [
    await storedFor('m1', v),
    { ...(await storedFor('m2', v)), copyOfMarkerId: 'm1', copyOrdinal: 1 }
  ];
  const tok = await tokenFor('m1');
  const rows = [
    { rowIdCell: tok, values: v },
    { rowIdCell: tok, values: v }
  ];
  const { decisions } = await buildImportPlan({ rows, stored, documentId: DOC, scopeId: SCOPE, resolveSecret });
  assert.equal(decisions[0].decision, 'match');
  assert.equal(decisions[0].markerId, 'm1');
  assert.equal(decisions[1].decision, 'copy-existing');
  assert.equal(decisions[1].action, IMPORT_ACTIONS.APPLY);
  assert.equal(decisions[1].markerId, 'm2'); // recovered, not re-created
});

test('a third copy appears → only the genuinely new one is created', async () => {
  const v = vals();
  const stored = [
    await storedFor('m1', v),
    { ...(await storedFor('m2', v)), copyOfMarkerId: 'm1', copyOrdinal: 1 }
  ];
  const tok = await tokenFor('m1');
  const rows = [
    { rowIdCell: tok, values: v },
    { rowIdCell: tok, values: v },
    { rowIdCell: tok, values: v } // a brand-new third copy
  ];
  const { decisions } = await buildImportPlan({ rows, stored, documentId: DOC, scopeId: SCOPE, resolveSecret });
  assert.deepEqual(decisions.map((d) => d.decision), ['match', 'copy-existing', 'copy-new']);
  assert.equal(decisions[2].copyOrdinal, 2);
});

test('valid token for a marker never exported here → unknown-rowid (review, no mutate)', async () => {
  const stored = [await storedFor('m1', vals())];
  const rows = [{ rowIdCell: await tokenFor('ghost'), values: vals() }];
  const { decisions } = await buildImportPlan({ rows, stored, documentId: DOC, scopeId: SCOPE, resolveSecret });
  assert.equal(decisions[0].decision, 'unknown-rowid');
  assert.equal(decisions[0].action, 'review');
});

test('foreign-document and wrong-scope tokens each surface for review', async () => {
  const stored = [await storedFor('m1', vals())];
  const foreign = await tokenFor('m1', { documentId: 'other-doc' });
  const wrongScope = await tokenFor('m1', { scopeId: 'mod-9:cat-9' });
  const { decisions } = await buildImportPlan({
    rows: [{ rowIdCell: foreign, values: vals() }, { rowIdCell: wrongScope, values: vals() }],
    stored, documentId: DOC, scopeId: SCOPE, resolveSecret
  });
  assert.equal(decisions[0].decision, 'foreign-rowid');
  assert.equal(decisions[1].decision, 'wrong-scope-rowid');
});

test('malformed token and unavailable key are distinguished, both review', async () => {
  const stored = [await storedFor('m1', vals())];
  const tamper = (await tokenFor('m1')).slice(0, -1) + (/* flip */ 'A');
  const wrongKeyResolver = () => null; // key never available
  const { decisions } = await buildImportPlan({
    rows: [{ rowIdCell: 'totally-bogus', values: vals() }, { rowIdCell: await tokenFor('m1'), values: vals() }],
    stored, documentId: DOC, scopeId: SCOPE, resolveSecret: wrongKeyResolver
  });
  assert.equal(decisions[0].decision, 'malformed-rowid');
  assert.equal(decisions[1].decision, 'rowid-key-unavailable');
});

test('blank Row ID with a unique fingerprint match to a leftover → recovered (apply, re-attach)', async () => {
  const v = vals();
  const stored = [await storedFor('m1', v)];
  const rows = [{ rowIdCell: '', values: v }]; // same content, lost token
  const { decisions, candidateDeletes } = await buildImportPlan({ rows, stored, documentId: DOC, scopeId: SCOPE, resolveSecret });
  assert.equal(decisions[0].decision, 'missing-rowid');
  assert.equal(decisions[0].action, IMPORT_ACTIONS.APPLY);
  assert.equal(decisions[0].markerId, 'm1');
  assert.equal(decisions[0].recovered, true);
  assert.deepEqual(candidateDeletes, []); // recovered, not a delete candidate
});

test('blank Row ID sharing no identity field with any leftover → genuinely new row (create)', async () => {
  // No fingerprint match AND no non-blank identity-field overlap (Tier 4) — a row that
  // merely shares some fields would now pair instead (see rowImportMatcherFieldOverlap tests).
  const stored = [await storedFor('m1', vals())];
  const rows = [{ rowIdCell: '', values: vals({ item: 'Brand New', entity: 'South', notes: 'unrelated', answers: { q1: 'N' } }) }];
  const { decisions } = await buildImportPlan({ rows, stored, documentId: DOC, scopeId: SCOPE, resolveSecret });
  assert.equal(decisions[0].decision, 'new-row');
  assert.equal(decisions[0].action, IMPORT_ACTIONS.CREATE);
});

test('blank row vs two byte-identical leftovers → pairs the first in stored order, twin becomes delete candidate (Amendment #4, never review)', async () => {
  // The two markers are byte-identical, so which one the row re-attaches to is
  // data-inconsequential — locked Amendment #4 pairs in stable order silently. The
  // unmatched twin means one of two identical rows was deleted in Excel → a delete
  // candidate for the caller's triage (Amendment #3/#7: deletes never prompt).
  const v = vals();
  const stored = [await storedFor('m1', v), await storedFor('m2', v)]; // two markers, identical content
  const rows = [{ rowIdCell: '', values: v }];
  const { decisions, candidateDeletes } = await buildImportPlan({ rows, stored, documentId: DOC, scopeId: SCOPE, resolveSecret });
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].decision, 'missing-rowid');
  assert.equal(decisions[0].action, IMPORT_ACTIONS.APPLY);
  assert.equal(decisions[0].markerId, 'm1');
  assert.deepEqual(candidateDeletes, ['m2']);
});

test('a stored marker with no row becomes a review-only delete candidate (delete stays OFF)', async () => {
  const stored = [await storedFor('m1', vals()), await storedFor('m2', vals({ item: 'Other' }))];
  const rows = [{ rowIdCell: await tokenFor('m1'), values: vals() }]; // m2 absent
  const { decisions, candidateDeletes } = await buildImportPlan({ rows, stored, documentId: DOC, scopeId: SCOPE, resolveSecret });
  assert.equal(decisions[0].decision, 'match');
  assert.deepEqual(candidateDeletes, ['m2']);
});

// ---------------------------------------------------------------------------
// Paste-above disambiguation (KAL-306) — PLAN.md Amendment 2026-06-08(b) #3:
// a copy placed BEFORE/DISPLACING the bound row goes to review, never
// auto-resolves to first-row-wins.  The bound row is identified via the stored
// marker's lastSeenRowNumber.  Without a positional stamp the order is
// untrusted and the whole group also goes to review (per the same amendment:
// "any untrusted order → review").
// ---------------------------------------------------------------------------

test('KAL-306: paste-above with positional stamp — copy is above the bound row → review, not first-row-wins', async () => {
  // m1 was last seen at sheet row 5 (original position).  The user copies the
  // row and pastes it at row 3 (above the original at row 5).  Excel now shows
  // two rows carrying m1's token: row 3 (the new copy) and row 5 (the original).
  // rowIndex 0 = copy (sheetRowNumber 3), rowIndex 1 = original (sheetRowNumber 5).
  // The matcher must detect the reversal and surface for review — NOT silently
  // match the copy to m1 and create a new item from the original.
  const v = vals();
  const s1 = await storedFor('m1', v);
  // Stamp the stored marker as last seen at sheet row 5 with ingest seq 100.
  s1.lastSeenRowNumber = 5;
  s1.lastIngestSeq = 100;
  const stored = [s1];
  const tok = await tokenFor('m1');
  const rows = [
    { rowIdCell: tok, values: v, sheetRowNumber: 3 }, // copy pasted above
    { rowIdCell: tok, values: v, sheetRowNumber: 5 }  // original at its bound slot
  ];
  const { decisions, candidateDeletes } = await buildImportPlan({ rows, stored, documentId: DOC, scopeId: SCOPE, resolveSecret });
  // Both rows must surface for review (not auto-resolved).
  assert.equal(decisions.length, 2);
  assert.ok(decisions.every((d) => d.action === IMPORT_ACTIONS.REVIEW),
    `expected all decisions to be review, got: ${JSON.stringify(decisions.map((d) => d.decision))}`);
  // m1 must NOT become a delete candidate — the rows are under review.
  assert.deepEqual(candidateDeletes, []);
});

test('KAL-306: paste-above without any positional stamp — no detection signal, first-row-wins assumed (copy-below default)', async () => {
  // No lastSeenRowNumber on the stored marker AND no sheetRowNumber on the rows.
  // Without any positional signal the matcher cannot detect paste-above — it falls
  // back to the copy-below assumption (first-row-wins) which is the correct behavior
  // for the common case.  Detecting paste-above requires positional evidence on at
  // least one side.  This matches the pre-KAL-306 behavior preserved by design.
  const v = vals();
  const stored = [await storedFor('m1', v)]; // no lastSeenRowNumber
  const tok = await tokenFor('m1');
  const rows = [
    { rowIdCell: tok, values: v }, // first row (treated as original — no position to contradict)
    { rowIdCell: tok, values: v }  // second row (treated as copy-below)
  ];
  const { decisions, candidateDeletes } = await buildImportPlan({ rows, stored, documentId: DOC, scopeId: SCOPE, resolveSecret });
  // Falls through to first-row-wins: original matches, copy creates.
  assert.equal(decisions[0].decision, 'match');
  assert.equal(decisions[0].markerId, 'm1');
  assert.equal(decisions[1].decision, 'copy-new');
  assert.equal(decisions[1].action, IMPORT_ACTIONS.CREATE);
  assert.deepEqual(candidateDeletes, []);
});

test('KAL-306: copy-below with positional stamp — copy is after the bound row → auto-resolves normally', async () => {
  // m1 last seen at sheet row 3.  User copies the row and pastes it at row 5
  // (below the original).  rowIndex 0 = original (sheetRowNumber 3),
  // rowIndex 1 = copy (sheetRowNumber 5).  Normal copy-below — auto-resolves.
  const v = vals();
  const s1 = await storedFor('m1', v);
  s1.lastSeenRowNumber = 3;
  s1.lastIngestSeq = 100;
  const stored = [s1];
  const tok = await tokenFor('m1');
  const rows = [
    { rowIdCell: tok, values: v, sheetRowNumber: 3 }, // original at its bound slot
    { rowIdCell: tok, values: v, sheetRowNumber: 5 }  // copy pasted below
  ];
  const { decisions, candidateDeletes } = await buildImportPlan({ rows, stored, documentId: DOC, scopeId: SCOPE, resolveSecret });
  // Original matches m1; copy becomes a new item.
  assert.equal(decisions[0].decision, 'match');
  assert.equal(decisions[0].markerId, 'm1');
  assert.equal(decisions[1].decision, 'copy-new');
  assert.equal(decisions[1].action, IMPORT_ACTIONS.CREATE);
  assert.deepEqual(candidateDeletes, []);
});

test('ambiguous blank-row recovery (non-identical candidates) never marks its candidate markers for deletion', async () => {
  // m1 and m2 are NOT byte-identical (different notes) but both share the row's Item —
  // multiple non-identical candidates = genuinely consequential ambiguity → review, and
  // neither may become a delete candidate: the row is plausibly one of them, just
  // unresolved (guards Excel-driven delete).
  const stored = [
    await storedFor('m1', vals({ notes: 'first twin' })),
    await storedFor('m2', vals({ notes: 'second twin' }))
  ];
  const rows = [{ rowIdCell: '', values: vals({ notes: 'edited in excel' }) }];
  const { decisions, candidateDeletes } = await buildImportPlan({ rows, stored, documentId: DOC, scopeId: SCOPE, resolveSecret });
  const review = decisions.find((d) => d.decision === 'ambiguous-identity');
  assert.ok(review, 'blank row is ambiguous between m1 and m2');
  assert.equal(review.action, 'review');
  assert.deepEqual(review.candidateMarkerIds.sort(), ['m1', 'm2']);
  assert.deepEqual(candidateDeletes, [], 'an under-review marker is never a delete candidate');
});
