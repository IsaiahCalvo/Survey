// Document review (Nightly, flag 'document-review'; migration
// 20261110133000_document_review.sql; Drawboard Projects round 2).
//
// Drawboard's drawings list shows each sheet's review status, who owns the
// review and its markup count, with filter chips. Survey's documents list
// gets the same: a status chip, the owner's initials and "12 marks" under the
// name, Status and Owner in the preview, and chips above the list.
// Pure: no React, no Supabase, so node tests import it.

export const REVIEW_STATUSES = Object.freeze([
  { id: 'needs-review', label: 'Needs review', tone: 'amber' },
  { id: 'in-progress', label: 'In progress', tone: 'blue' },
  { id: 'reviewed', label: 'Reviewed', tone: 'slate' },
  { id: 'revise-resubmit', label: 'Revise and resubmit', tone: 'red' },
  { id: 'approved', label: 'Approved', tone: 'green' },
]);

const STATUS_BY_ID = new Map(REVIEW_STATUSES.map((s) => [s.id, s]));

export const reviewStatus = (id) => STATUS_BY_ID.get(id) || null;

export function markupCountLabel(count) {
  if (!Number.isFinite(count)) return '';
  return `${count} ${count === 1 ? 'mark' : 'marks'}`;
}

/** Rows keyed by document id: { status, ownerId, ownerName, markupCount }. */
export function mapReviewRows(rows) {
  const out = new Map();
  for (const row of rows || []) {
    if (!row?.document_id) continue;
    out.set(row.document_id, {
      status: STATUS_BY_ID.has(row.status) ? row.status : null,
      ownerId: row.owner_id || null,
      ownerName: row.owner_name || null,
      markupCount: Number.isFinite(row.markup_count) ? row.markup_count : null,
    });
  }
  return out;
}

export const EMPTY_REVIEW_FILTER = Object.freeze({ status: null, mine: false, marks: null });

/**
 * The chips: one status at a time ('none' = no status yet), "Mine" (I own
 * the review) and marks: 'with' | 'without'. A document never opened since
 * counting began has no count: it shows under neither marks chip.
 */
export function passesReviewFilter(review, filter, myId) {
  const f = filter || EMPTY_REVIEW_FILTER;
  const r = review || {};
  if (f.status === 'none' ? Boolean(r.status) : (f.status && r.status !== f.status)) return false;
  if (f.mine && (!myId || r.ownerId !== myId)) return false;
  if (f.marks === 'with' && !(r.markupCount > 0)) return false;
  if (f.marks === 'without' && r.markupCount !== 0) return false;
  return true;
}

export const reviewFilterIsEmpty = (f) => !f || (!f.status && !f.mine && !f.marks);

/** How many documents each status chip would show. */
export function reviewStatusCounts(ids, reviews) {
  const counts = { none: 0 };
  for (const s of REVIEW_STATUSES) counts[s.id] = 0;
  for (const id of ids || []) {
    const status = reviews?.get?.(id)?.status;
    counts[status || 'none'] += 1;
  }
  return counts;
}

/** Markup count of a viewer's marks: page marks plus Survey Markers. */
export function countMarkups(annotationsByPage, surveyMarkers) {
  let n = 0;
  for (const page of Object.values(annotationsByPage || {})) {
    if (Array.isArray(page?.objects)) n += page.objects.filter(Boolean).length;
  }
  n += Object.values(surveyMarkers || {}).filter(Boolean).length;
  return n;
}

// --- Server (the client is passed in, so tests can fake it) -------------

export async function listDocumentReviews(client, ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  const rows = [];
  for (let i = 0; i < list.length; i += 500) {
    const { data, error } = await client.rpc('list_document_reviews', { p_document_ids: list.slice(i, i + 500) });
    if (error) throw new Error(error.message || 'Could not read review status');
    rows.push(...(data || []));
  }
  return mapReviewRows(rows);
}

export async function setDocumentReview(client, { documentId, status = null, ownerId = null }) {
  const { data, error } = await client.rpc('set_document_review', { p_document_id: documentId, p_status: status, p_owner_id: ownerId });
  if (error) throw new Error(error.message || 'Could not save the review status');
  const row = Array.isArray(data) ? data[0] : data;
  return mapReviewRows(row ? [row] : []).get(documentId) || { status, ownerId, markupCount: null };
}

// The documents list stays mounted behind an open document: this tells it
// a count changed, so the row is right when you go back Home.
export const MARKUP_COUNT_EVENT = 'survey:markup-count';

/** Never throws: a missed count only leaves the list a little behind. */
export async function reportMarkupCount(client, documentId, count) {
  try {
    const { error } = await client.rpc('set_document_markup_count', { p_document_id: documentId, p_count: count });
    if (error) { console.warn('[document-review] markup count not saved', error.message || error); return; }
    if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent(MARKUP_COUNT_EVENT, { detail: { documentId, count } }));
    }
  } catch (err) {
    console.warn('[document-review] markup count not saved', err?.message || err);
  }
}
