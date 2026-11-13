// Nightly 'note-tool' (Drawboard PDF Insert > Note): a small sticky note
// placed with a click. It holds a few lines of words that open from the
// picked bar's Note button. The mark is a rect with the PDF sticky-note glyph
// (the same shape an imported /Text note takes), so it draws, prints and
// syncs like the other marks, and it exports as a real PDF /Text note with
// its words in /Contents, which every PDF reader opens.

export const STICKY_NOTE_TOOL_ID = 'sticky-note';
export const NOTE_EDIT_EVENT = 'survey:sticky-note-edit';
export const NOTE_SIZE_PT = 22;
export const NOTE_TEXT_MAX = 5000;
export const NOTE_ID_PREFIX = 'sticky-note:';

// Drawboard's note colours: yellow first.
export const NOTE_COLORS = Object.freeze([
  { id: 'yellow', label: 'Yellow', hex: '#FFD43B' },
  { id: 'orange', label: 'Orange', hex: '#FFA94D' },
  { id: 'green', label: 'Green', hex: '#8CE99A' },
  { id: 'blue', label: 'Blue', hex: '#74C0FC' },
  { id: 'pink', label: 'Pink', hex: '#F783AC' },
]);
export const NOTE_DEFAULT_COLOR = NOTE_COLORS[0].hex;
const NOTE_LOOK_KEY = 'survey.noteColor.v1';

const newId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

export const cleanNoteText = (text) => String(text ?? '').replace(/\r\n?/g, '\n').slice(0, NOTE_TEXT_MAX);

export const noteColorOrDefault = (hex) => {
  const value = String(hex || '').toUpperCase();
  return NOTE_COLORS.some((c) => c.hex === value) ? value : NOTE_DEFAULT_COLOR;
};

/** A note this tool made (imported PDF notes keep their own path). */
export const isSurveyStickyNote = (obj) => obj?.data?.type === 'note' && obj?.data?.surveyNote === true;

/** The note as a library-like item, so the library's placement drops it (one save, one Undo step, picked). */
export function stickyNoteItem({ text = '', color = NOTE_DEFAULT_COLOR, id = newId() } = {}) {
  const fill = noteColorOrDefault(color);
  const object = {
    id,
    type: 'rect',
    left: 0,
    top: 0,
    width: NOTE_SIZE_PT,
    height: NOTE_SIZE_PT,
    fill,
    stroke: 'rgba(0, 0, 0, 0.4)',
    strokeWidth: 1,
    strokeUniform: true,
    rx: 3,
    ry: 3,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    opacity: 1,
    selectable: true,
    evented: true,
    data: {
      id,
      type: 'note',
      surveyNote: true,
      pdfNoteGlyph: 'note',
      pdfNoteIcon: 'Note',
      noteText: cleanNoteText(text),
    },
  };
  return {
    id: `${NOTE_ID_PREFIX}${id}`,
    name: 'Note',
    kinds: ['note'],
    tags: [],
    builtIn: true,
    payload: {
      version: 1,
      pageWidth: 612,
      pageHeight: 792,
      extent: { left: 0, top: 0, width: NOTE_SIZE_PT, height: NOTE_SIZE_PT },
      items: [{ kind: 'mark', object }],
    },
  };
}

/** { id, text, color } for one picked note, else null. */
export function selectedNoteOf(obj, id) {
  if (!isSurveyStickyNote(obj)) return null;
  return { id: id ?? obj.id ?? obj.data?.id ?? null, text: String(obj.data.noteText ?? ''), color: noteColorOrDefault(obj.fill) };
}

/** The note with new words and / or colour (a new object; the old one is untouched). */
export function applyNoteEdit(obj, { text, color } = {}) {
  if (!isSurveyStickyNote(obj)) return obj;
  return {
    ...obj,
    ...(color !== undefined ? { fill: noteColorOrDefault(color) } : {}),
    data: { ...obj.data, ...(text !== undefined ? { noteText: cleanNoteText(text) } : {}) },
  };
}

export function readNoteLastColor() {
  try { return noteColorOrDefault(globalThis.localStorage?.getItem(NOTE_LOOK_KEY)); } catch { return NOTE_DEFAULT_COLOR; }
}
export function saveNoteLastColor(hex) {
  try { globalThis.localStorage?.setItem(NOTE_LOOK_KEY, noteColorOrDefault(hex)); } catch { /* private mode */ }
}
