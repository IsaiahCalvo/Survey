// A mark's note (Nightly flag 'mark-note', KAL-721, Drawboard's Edit Note):
// any mark can carry a written note, such as "Door swings the wrong way" on
// a cloud. It shows under the mark's row in the Markups list and its CSV,
// and is written as the PDF mark's comment (/Contents) on export when the
// mark has no words of its own, so Acrobat and Bluebeam show it too.
//
// Stored on the mark as data.note (carried through export / re-import by the
// app metadata blob). Pure.

export const MARK_NOTE_MAX = 2000;

/** Typed text as a note: line breaks kept (as \n), trimmed, at most MARK_NOTE_MAX; '' when blank. */
export function cleanMarkNote(text) {
  const lines = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MARK_NOTE_MAX).trim();
}

const isStickyNote = (object) => object?.data?.type === 'note';

/** The mark's note, or null when it has none. */
export function markNoteOf(object) {
  const raw = isStickyNote(object) && typeof object?.data?.noteText === 'string'
    ? object.data.noteText
    : object?.data?.note;
  if (typeof raw !== 'string') return null;
  const clean = cleanMarkNote(raw);
  return clean || null;
}

/** A copy of the mark with its note set (or cleared when blank), or null when nothing would change. */
export function withMarkNote(object, text) {
  if (!object || typeof object !== 'object') return null;
  const next = cleanMarkNote(text);
  const current = markNoteOf(object);
  if ((current || '') === next) return null;
  const data = { ...(object.data || {}) };
  if (isStickyNote(object)) {
    data.noteText = next;
    delete data.note;
  } else if (next) {
    data.note = next;
  } else {
    delete data.note;
  }
  return { ...object, data };
}

/** The one note every mark shares ('' when none have one), or null when they differ. */
export function sharedMarkNote(objects) {
  const list = Array.isArray(objects) ? objects : [];
  if (!list.length) return '';
  const first = markNoteOf(list[0]) || '';
  return list.every((o) => (markNoteOf(o) || '') === first) ? first : null;
}

/** The note on one line for a list row: line breaks as spaces, cut with an ellipsis. */
export function markNotePreview(note, max = 120) {
  const one = String(note || '').replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}
