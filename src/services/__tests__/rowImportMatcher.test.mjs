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

test('duplicate token on two rows → both review as duplicate-rowid, neither binds', async () => {
  const stored = [await storedFor('m1', vals())];
  const tok = await tokenFor('m1');
  const rows = [
    { rowIdCell: tok, values: vals() },
    { rowIdCell: tok, values: vals({ item: 'Copy' }) }
  ];
  const { decisions, candidateDeletes } = await buildImportPlan({ rows, stored, documentId: DOC, scopeId: SCOPE, resolveSecret });
  assert.equal(decisions.every((d) => d.decision === 'duplicate-rowid' && d.action === 'review'), true);
  // m1 is tangled in a duplicate → excluded from delete candidates (resolve the duplicate
  // first; never propose deleting something the user still has to choose about).
  assert.deepEqual(candidateDeletes, []);
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

test('blank Row ID with no fingerprint match → genuinely new row (create)', async () => {
  const stored = [await storedFor('m1', vals())];
  const rows = [{ rowIdCell: '', values: vals({ item: 'Brand New', answers: { q1: 'N' } }) }];
  const { decisions } = await buildImportPlan({ rows, stored, documentId: DOC, scopeId: SCOPE, resolveSecret });
  assert.equal(decisions[0].decision, 'new-row');
  assert.equal(decisions[0].action, IMPORT_ACTIONS.CREATE);
});

test('blank Row ID matching two identical leftovers → ambiguous-identity (review, no guess)', async () => {
  const v = vals();
  const stored = [await storedFor('m1', v), await storedFor('m2', v)]; // two markers, identical content
  const rows = [{ rowIdCell: '', values: v }];
  const { decisions } = await buildImportPlan({ rows, stored, documentId: DOC, scopeId: SCOPE, resolveSecret });
  assert.equal(decisions[0].decision, 'ambiguous-identity');
  assert.equal(decisions[0].action, 'review');
  assert.deepEqual(decisions[0].candidateMarkerIds.sort(), ['m1', 'm2']);
});

test('a stored marker with no row becomes a review-only delete candidate (delete stays OFF)', async () => {
  const stored = [await storedFor('m1', vals()), await storedFor('m2', vals({ item: 'Other' }))];
  const rows = [{ rowIdCell: await tokenFor('m1'), values: vals() }]; // m2 absent
  const { decisions, candidateDeletes } = await buildImportPlan({ rows, stored, documentId: DOC, scopeId: SCOPE, resolveSecret });
  assert.equal(decisions[0].decision, 'match');
  assert.deepEqual(candidateDeletes, ['m2']);
});
