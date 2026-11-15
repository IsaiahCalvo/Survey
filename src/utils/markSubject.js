// A mark's subject (Nightly flag 'mark-subject', Drawboard Projects parity
// spec SS-31 / MS-30, 2026-11-10): every mark can carry its own subject, such
// as "Fire door" on a cloud, in place of the kind's name. It shows in the
// Markups list and its CSV and is written as the PDF's /Subj on export, so
// Acrobat and Bluebeam list it too. Empty means "use the kind's name".
//
// Stored on the mark as data.subject (carried through export / re-import by
// the app metadata blob). Pure.

export const MARK_SUBJECT_MAX = 80;

/** Typed text as a subject: one line, trimmed, at most MARK_SUBJECT_MAX; '' when blank. */
export function cleanMarkSubject(text) {
  const one = String(text ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return one.slice(0, MARK_SUBJECT_MAX).trim();
}

/** The mark's own subject, or null when it has none. */
export function markSubjectOf(object) {
  const raw = object?.data?.subject;
  if (typeof raw !== 'string') return null;
  const clean = cleanMarkSubject(raw);
  return clean || null;
}

/**
 * A copy of the mark with its subject set (or cleared when blank), or null
 * when nothing would change.
 */
export function withMarkSubject(object, text) {
  if (!object || typeof object !== 'object') return null;
  const next = cleanMarkSubject(text);
  const current = markSubjectOf(object);
  if ((current || '') === next) return null;
  const data = { ...(object.data || {}) };
  if (next) data.subject = next;
  else delete data.subject;
  return { ...object, data };
}

/** The one subject every mark shares ('' when none have one), or null when they differ. */
export function sharedMarkSubject(objects) {
  const list = Array.isArray(objects) ? objects : [];
  if (!list.length) return '';
  const first = markSubjectOf(list[0]) || '';
  return list.every((o) => (markSubjectOf(o) || '') === first) ? first : null;
}
