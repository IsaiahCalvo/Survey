import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  REVIEW_STATUSES,
  EMPTY_REVIEW_FILTER,
  countMarkups,
  listDocumentReviews,
  mapReviewRows,
  markupCountLabel,
  mergeFetchedReviews,
  passesReviewFilter,
  reviewFilterIsEmpty,
  reviewStatusCounts,
  setDocumentReview,
} from '../src/home/documentReview.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

test("Drawboard's five review statuses, in its order", () => {
  assert.deepEqual(REVIEW_STATUSES.map((s) => s.label), ['Needs review', 'In progress', 'Reviewed', 'Revise and resubmit', 'Approved']);
});

test('rows map by document id; unknown statuses are dropped', () => {
  const m = mapReviewRows([
    { document_id: 'd1', status: 'approved', owner_id: 'u1', owner_name: 'Olive', markup_count: 4 },
    { document_id: 'd2', status: 'nonsense', owner_id: null, markup_count: null },
  ]);
  assert.deepEqual(m.get('d1'), { status: 'approved', ownerId: 'u1', ownerName: 'Olive', markupCount: 4 });
  assert.deepEqual(m.get('d2'), { status: null, ownerId: null, ownerName: null, markupCount: null });
});

test('filters: status, none, mine, with and without marks', () => {
  const a = { status: 'approved', ownerId: 'me', markupCount: 3 };
  const b = { status: null, ownerId: 'you', markupCount: 0 };
  const c = undefined; // never counted
  const pass = (r, f) => passesReviewFilter(r, { ...EMPTY_REVIEW_FILTER, ...f }, 'me');
  assert.equal(pass(a, {}), true);
  assert.equal(pass(c, {}), true);
  assert.equal(pass(a, { status: 'approved' }), true);
  assert.equal(pass(b, { status: 'approved' }), false);
  assert.equal(pass(b, { status: 'none' }), true);
  assert.equal(pass(a, { status: 'none' }), false);
  assert.equal(pass(a, { mine: true }), true);
  assert.equal(pass(b, { mine: true }), false);
  assert.equal(pass(a, { marks: 'with' }), true);
  assert.equal(pass(b, { marks: 'with' }), false);
  assert.equal(pass(b, { marks: 'without' }), true);
  assert.equal(pass(c, { marks: 'without' }), false);
  assert.equal(reviewFilterIsEmpty(EMPTY_REVIEW_FILTER), true);
  assert.equal(reviewFilterIsEmpty({ ...EMPTY_REVIEW_FILTER, mine: true }), false);
});

test('status counts and mark labels', () => {
  const reviews = mapReviewRows([{ document_id: 'd1', status: 'approved' }, { document_id: 'd2', status: 'approved' }]);
  const counts = reviewStatusCounts(['d1', 'd2', 'd3'], reviews);
  assert.equal(counts.approved, 2);
  assert.equal(counts.none, 1);
  assert.equal(markupCountLabel(1), '1 mark');
  assert.equal(markupCountLabel(0), '0 marks');
  assert.equal(markupCountLabel(null), '');
});

test('markups = page marks plus Survey Markers', () => {
  assert.equal(countMarkups({ 1: { objects: [{}, null, {}] }, 2: { objects: [{}] }, 3: {} }, { m1: {}, m2: null }), 4);
  assert.equal(countMarkups(null, null), 0);
});

test('server calls go through the checked functions', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push([name, args]); return name === 'list_document_reviews' ? { data: [{ document_id: 'd1', status: 'reviewed' }], error: null } : { data: [{ document_id: 'd1', status: 'approved', owner_id: 'u1' }], error: null }; } };
  const listed = await listDocumentReviews(client, ['d1', 'd1', null]);
  assert.equal(listed.get('d1').status, 'reviewed');
  assert.deepEqual(calls[0], ['list_document_reviews', { p_document_ids: ['d1'] }]);
  const saved = await setDocumentReview(client, { documentId: 'd1', status: 'approved', ownerId: 'u1' });
  assert.equal(saved.status, 'approved');
  assert.deepEqual(calls[1], ['set_document_review', { p_document_id: 'd1', p_status: 'approved', p_owner_id: 'u1' }]);
});

test('document-review is a Nightly beta flag; the table is written only through functions', () => {
  assert.equal(FEATURE_FLAGS['document-review'].stage, 'beta');
  const sql = readFileSync(new URL('../supabase/migrations/20261110133000_document_review.sql', import.meta.url), 'utf8');
  assert.match(sql, /'document-review'/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON public\.document_reviews FROM authenticated/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  for (const fn of ['set_document_review', 'set_document_markup_count', 'list_document_reviews']) {
    assert.match(sql, new RegExp(`FUNCTION public\\.${fn}\\([^)]*\\)\\s+RETURNS[\\s\\S]*?SET search_path = ''`), `${fn} pins search_path`);
  }
});

test('review fields are editable only for the owner or when the server says I can edit (never on a missing role)', () => {
  const ledger = readFileSync(new URL('../src/home/DocumentsLedger.jsx', import.meta.url), 'utf8');
  assert.match(ledger, /supabase\.rpc\('user_can_access_document', \{ doc_id: teamDocId, required_role: 'editor' \}\)/);
  assert.match(ledger, /const canEditReview = teamOwnerIsMe \|\| \(reviewEditAccess\.id === teamDocId && reviewEditAccess\.ok\);/);
  assert.doesNotMatch(ledger, /myTeamRole !== 'viewer'/);
  assert.equal((ledger.match(/people=\{reviewPeople\} canEdit=\{canEditReview\}/g) || []).length, 2);
  assert.doesNotMatch(ledger, /people=\{reviewPeople\} canEdit onSave/);
});

test('a failed review save rolls back to what the server last confirmed', () => {
  const bits = readFileSync(new URL('../src/home/DocumentReviewBits.jsx', import.meta.url), 'utf8');
  // An earlier save that lands while a later one waits records its row on the
  // later entry; the later one's failure rolls back to that, not to the
  // values it saw when it was queued.
  assert.match(bits, /if \(!latest\(\)\) \{ pendingRef\.current\.get\(documentId\)\.confirmed = done; return; \}/);
  assert.match(bits, /setReviews\(\(m\) => new Map\(m\)\.set\(documentId, entry\.confirmed\)\);/);
  assert.doesNotMatch(bits, /set\(documentId, confirmed\)\)/);
});

test('a list read that began before a status change does not put the old status back', () => {
  const fetched = new Map([
    ['a', { status: 'open', ownerId: null, markupCount: 7 }],
    ['b', { status: 'open', ownerId: null, markupCount: 2 }],
  ]);
  const shown = new Map([
    ['a', { status: 'approved', ownerId: 'u1', ownerName: 'Pat', markupCount: 5 }],
    ['b', { status: 'in-review', ownerId: null, markupCount: 2 }],
  ]);
  const merged = mergeFetchedReviews(fetched, shown, { changedSince: (id) => id === 'a' });
  assert.deepEqual(merged.get('a'), { status: 'approved', ownerId: 'u1', ownerName: 'Pat', markupCount: 7 });
  assert.deepEqual(merged.get('b'), { status: 'open', ownerId: null, markupCount: 2 });
  const bits = readFileSync(new URL('../src/home/DocumentReviewBits.jsx', import.meta.url), 'utf8');
  assert.match(bits, /changedSince: \(id\) => \(touchedRef\.current\.get\(id\) \|\| 0\) > startTick \|\| pendingRef\.current\.has\(id\)/);
});
