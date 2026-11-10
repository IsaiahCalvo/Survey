/* Document review (Nightly, flag 'document-review'): the pieces the
   documents list adds. Pure rules and server calls: home/documentReview.js.

   - useDocumentReviews: the review rows of the listed documents.
   - ReviewChips: filter chips above the list.
   - ReviewLine: status chip, owner initials and "12 marks" under a name.
   - ReviewFields: Status and Owner pickers in the preview / phone details.
   - useReviewPeople: who can own a document's review. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import ValueSelect from '../components/ValueSelect.jsx';
import { isPhoneLayout } from '../utils/layoutMode.js';
import { presenceInitials } from '../components/presenceIdentity.js';
import { showToast } from '../utils/toast';
import {
  MARKUP_COUNT_EVENT,
  REVIEW_STATUSES,
  listDocumentReviews,
  markupCountLabel,
  reviewStatus,
  setDocumentReview,
} from './documentReview.js';
import './documentReview.css';

export function useDocumentReviews(enabled, ids) {
  const [reviews, setReviews] = useState(() => new Map());
  const key = enabled ? [...ids].sort().join(',') : '';
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    const load = () => listDocumentReviews(supabase, key.split(','))
      .then((next) => { if (live) setReviews(next); })
      .catch((err) => console.warn('[document-review]', err?.message || err));
    load();
    // Counts change in the viewer: read again when the list comes back.
    const onFocus = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    const onCount = (event) => {
      const { documentId, count } = event.detail || {};
      if (!documentId || !live) return;
      setReviews((m) => new Map(m).set(documentId, { status: null, ownerId: null, ownerName: null, ...m.get(documentId), markupCount: count }));
    };
    window.addEventListener(MARKUP_COUNT_EVENT, onCount);
    return () => {
      live = false;
      window.removeEventListener(MARKUP_COUNT_EVENT, onCount);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [key]);
  const save = useCallback(async (documentId, patch) => {
    const before = reviews.get(documentId) || { status: null, ownerId: null, markupCount: null };
    const next = { ...before, ...patch };
    setReviews((m) => new Map(m).set(documentId, next));
    try {
      const saved = await setDocumentReview(supabase, { documentId, status: next.status, ownerId: next.ownerId });
      setReviews((m) => new Map(m).set(documentId, { ...saved, ownerName: saved.ownerId ? next.ownerName : null, markupCount: saved.markupCount ?? before.markupCount }));
    } catch (err) {
      setReviews((m) => new Map(m).set(documentId, before));
      showToast(err?.message || 'Could not save the review status', 'warn');
    }
  }, [reviews]);
  return { reviews, save };
}

export function ReviewChips({ filter, onChange, counts, phone = false }) {
  const toggle = (patch) => onChange({ ...filter, ...patch });
  return (
    <div className={`doc-review-chips${phone ? ' doc-review-chips--phone' : ''}`} role="group" aria-label="Filter by review" data-doc-review-chips="">
      {REVIEW_STATUSES.map((s) => (
        <button
          key={s.id}
          type="button"
          className="doc-review-chip"
          aria-pressed={filter.status === s.id}
          data-review-filter={s.id}
          onClick={() => toggle({ status: filter.status === s.id ? null : s.id })}
        >
          <span className={`doc-review-dot doc-review-dot--${s.tone}`} aria-hidden="true" />
          {s.label}
          {counts?.[s.id] ? <span className="doc-review-chip__count">{counts[s.id]}</span> : null}
        </button>
      ))}
      <button type="button" className="doc-review-chip" aria-pressed={filter.mine} data-review-filter="mine" onClick={() => toggle({ mine: !filter.mine })}>Mine</button>
      <button type="button" className="doc-review-chip" aria-pressed={filter.marks === 'with'} data-review-filter="with-marks" onClick={() => toggle({ marks: filter.marks === 'with' ? null : 'with' })}>Has marks</button>
      <button type="button" className="doc-review-chip" aria-pressed={filter.marks === 'without'} data-review-filter="no-marks" onClick={() => toggle({ marks: filter.marks === 'without' ? null : 'without' })}>No marks</button>
    </div>
  );
}

export function ReviewLine({ review }) {
  const status = reviewStatus(review?.status);
  const ownerName = review?.ownerName || null;
  const marks = markupCountLabel(review?.markupCount);
  if (!status && !ownerName && !marks) return null;
  return (
    <span className="doc-review-line" data-doc-review-line="">
      {status && (
        <span className={`doc-review-status doc-review-status--${status.tone}`}>{status.label}</span>
      )}
      {ownerName && <span className="doc-review-owner" aria-label={`Owner ${ownerName}`}>{presenceInitials(ownerName)}</span>}
      {marks && <span className="doc-review-marks">{marks}</span>}
    </span>
  );
}

/* People on one document (not guests), for the Owner picker. */
export function useReviewPeople(documentId) {
  const [people, setPeople] = useState([]);
  useEffect(() => {
    if (!documentId) { setPeople([]); return undefined; }
    let live = true;
    import('../services/markComments.js')
      .then(({ listCommentPeople, personLabel }) => listCommentPeople(supabase, documentId)
        .then((rows) => { if (live) setPeople(rows.filter((p) => !p.guest).map((p) => ({ id: p.id, name: personLabel(p) }))); }))
      .catch(() => { if (live) setPeople([]); });
    return () => { live = false; };
  }, [documentId]);
  return people;
}

const NOBODY = '__nobody__';
const NO_STATUS = '__none__';

/* Status and Owner. `people` = [{ id, name }] on the document; read-only for
   someone who can't edit it. */
export function ReviewFields({ review, people, canEdit, onSave }) {
  const phone = isPhoneLayout();
  const statusOptions = useMemo(() => [{ value: NO_STATUS, label: 'No status' }, ...REVIEW_STATUSES.map((s) => ({ value: s.id, label: s.label }))], []);
  const ownerOptions = useMemo(() => [{ value: NOBODY, label: 'Nobody' }, ...(people || []).map((p) => ({ value: p.id, label: p.name }))], [people]);
  const field = (label, value, options, onChange, testId) => (
    <label className="doc-review-field" data-doc-review-field={testId}>
      <span className="section-label">{label}</span>
      {phone ? (
        <select className="doc-review-native" aria-label={label} value={value} disabled={!canEdit} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <ValueSelect label={label} value={value} options={options} disabled={!canEdit} size="sm" onChange={onChange} />
      )}
    </label>
  );
  return (
    <div className="doc-review-fields">
      {field('Review status', review?.status || NO_STATUS, statusOptions, (v) => onSave({ status: v === NO_STATUS ? null : v }), 'status')}
      {field('Review owner', review?.ownerId || NOBODY, ownerOptions, (v) => onSave({ ownerId: v === NOBODY ? null : v, ownerName: (people || []).find((p) => p.id === v)?.name || null }), 'owner')}
    </div>
  );
}
