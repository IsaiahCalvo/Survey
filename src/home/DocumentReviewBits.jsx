/* Document review (Nightly, flag 'document-review'): the pieces the
   documents list adds. Pure rules and server calls: home/documentReview.js.

   - useDocumentReviews: the review rows of the listed documents.
   - ReviewChips: filter chips above the list.
   - ReviewLine: status chip, owner initials and "12 marks" under a name.
   - ReviewFields: Status and Owner pickers in the preview / phone details.
   - useReviewPeople: who can own a document's review. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  mergeFetchedReviews,
  reviewStatus,
  setDocumentReview,
} from './documentReview.js';
import './documentReview.css';

export function useDocumentReviews(enabled, ids) {
  const [reviews, setReviews] = useState(() => new Map());
  const key = enabled ? [...ids].sort().join(',') : '';
  // Bumped on every local status / owner change, per document: a list read
  // that started before a change must not put the old values back.
  const writeTickRef = useRef(0);
  const touchedRef = useRef(new Map()); // documentId -> writeTick of its last change
  const pendingRef = useRef(new Map()); // documentId -> { wanted, seq, confirmed, chain }
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    const load = () => {
      const startTick = writeTickRef.current;
      return listDocumentReviews(supabase, key.split(','))
        .then((next) => {
          if (!live) return;
          setReviews((current) => mergeFetchedReviews(next, current, {
            changedSince: (id) => (touchedRef.current.get(id) || 0) > startTick || pendingRef.current.has(id),
          }));
        })
        .catch((err) => console.warn('[document-review]', err?.message || err));
    };
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
  // Status and owner save through one call that writes both, so saves for a
  // document run one at a time, each sending everything wanted so far (never
  // a stale render's value), and only the last answer lands.
  const reviewsRef = useRef(reviews);
  reviewsRef.current = reviews;
  const save = useCallback((documentId, patch) => {
    writeTickRef.current += 1;
    touchedRef.current.set(documentId, writeTickRef.current);
    const pending = pendingRef.current.get(documentId);
    const confirmed = pending ? pending.confirmed : (reviewsRef.current.get(documentId) || { status: null, ownerId: null, markupCount: null });
    const wanted = { ...(pending ? pending.wanted : confirmed), ...patch };
    const seq = (pending?.seq || 0) + 1;
    const entry = { wanted, seq, confirmed, chain: null };
    pendingRef.current.set(documentId, entry);
    setReviews((m) => new Map(m).set(documentId, wanted));
    const run = async () => {
      const latest = () => pendingRef.current.get(documentId) === entry;
      if (!latest()) return; // a later change will send this one's fields too
      try {
        const saved = await setDocumentReview(supabase, { documentId, status: wanted.status, ownerId: wanted.ownerId });
        const done = { ...saved, ownerName: saved.ownerId ? wanted.ownerName : null, markupCount: saved.markupCount ?? entry.confirmed.markupCount };
        if (!latest()) { pendingRef.current.get(documentId).confirmed = done; return; }
        pendingRef.current.delete(documentId);
        setReviews((m) => new Map(m).set(documentId, done));
      } catch (err) {
        if (!latest()) return;
        pendingRef.current.delete(documentId);
        // An earlier save that landed while this one waited updated
        // entry.confirmed; roll back to that, never to the queue-time value.
        setReviews((m) => new Map(m).set(documentId, entry.confirmed));
        showToast(err?.message || 'Could not save the review status', 'warn');
      }
    };
    entry.chain = (pending?.chain || Promise.resolve()).then(run, run);
    return entry.chain;
  }, []);
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
