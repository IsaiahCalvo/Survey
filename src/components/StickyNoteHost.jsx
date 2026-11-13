/* Nightly 'note-tool': the Note tool's viewer side (Drawboard Insert > Note).
 *   - While the tool is armed, a click on a page (pen or mouse; a finger only
 *     where fingers run tools, utils/pencilMode.js) opens "New note" there.
 *     Add drops the note where you clicked (one save, one Undo step, picked);
 *     Cancel drops nothing.
 *   - Note on the picked bar (NOTE_EDIT_EVENT) opens "Note" for the picked
 *     note, to read or change its words and colour.
 * The mark and its rules: utils/stickyNote.js. */
import { useCallback, useEffect, useRef, useState } from 'react';
import DialogCard, { DIALOG_LABEL_STYLE } from './DialogCard.jsx';
import { useTooltip } from './Tooltip';
import './StickyNoteHost.css';
import { pointerMayUseTool } from '../utils/pencilMode.js';
import { pageElementAt, placeLibraryItem } from '../markLibrary/markLibraryPlacement.js';
import {
  NOTE_COLORS,
  NOTE_EDIT_EVENT,
  NOTE_TEXT_MAX,
  STICKY_NOTE_TOOL_ID,
  readNoteLastColor,
  saveNoteLastColor,
  stickyNoteItem,
} from '../utils/stickyNote.js';

const CONTROL = 'button, input, textarea, select, a[href], [role="menu"], [role="dialog"], [role="toolbar"], [contenteditable="true"], [data-shape-id]';

export function StickyNoteDialog({ open, mode = 'create', initial = null, readOnly = false, onSubmit, onCancel }) {
  const tip = useTooltip();
  const [text, setText] = useState('');
  const [color, setColor] = useState(NOTE_COLORS[0].hex);
  const fieldRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    setText(initial?.text || '');
    setColor(initial?.color || NOTE_COLORS[0].hex);
  }, [open, initial]);
  useEffect(() => {
    if (open && !readOnly) fieldRef.current?.focus?.();
  }, [open, readOnly]);
  const title = mode === 'edit' ? 'Note' : 'New note';
  const submit = () => onSubmit?.({ text, color });
  return (
    <DialogCard
      open={open}
      title={title}
      ariaLabel={title}
      onClose={onCancel}
      width={360}
      zIndex={1400}
      cardProps={{ 'data-sticky-note-dialog': mode }}
      footer={readOnly ? (
        <button type="button" className="hub-btn dialog-touch-pad" onClick={onCancel}>Close</button>
      ) : (
        <>
          <button type="button" className="hub-btn dialog-touch-pad" onClick={onCancel}>Cancel</button>
          <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" data-sticky-note-submit="" onClick={submit}>
            {mode === 'edit' ? 'Save' : 'Add'}
          </button>
        </>
      )}
    >
      <textarea
        ref={fieldRef}
        className="dialog-prompt-input sticky-note-dialog__text"
        aria-label="Note"
        placeholder="Write a note"
        maxLength={NOTE_TEXT_MAX}
        readOnly={readOnly}
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}
      />
      {!readOnly && (
        <>
          <span style={DIALOG_LABEL_STYLE} id="sticky-note-colour-label">Colour</span>
          <div className="sticky-note-dialog__colours" role="radiogroup" aria-labelledby="sticky-note-colour-label">
            {NOTE_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={color === c.hex}
                aria-label={c.label}
                {...tip(c.label, 'below')}
                className={`sticky-note-dialog__swatch${color === c.hex ? ' is-on' : ''}`}
                style={{ background: c.hex }}
                data-sticky-note-colour={c.id}
                onClick={() => setColor(c.hex)}
              />
            ))}
          </div>
        </>
      )}
    </DialogCard>
  );
}

export default function StickyNoteHost({
  isActive = true,
  readOnly = false,
  activeTool,
  hostRef,
  selectedNote = null, // { id, text, color } for the one picked note
  onPatchSelectedNote = null,
}) {
  // { mode: 'create', where: { clientX, clientY }, initial } | { mode: 'edit', initial }
  const [dialog, setDialog] = useState(null);
  const armed = isActive && !readOnly && activeTool === STICKY_NOTE_TOOL_ID;

  useEffect(() => {
    if (!armed) return undefined;
    const host = hostRef?.current;
    if (!host) return undefined;
    host.setAttribute('data-sticky-note-tool', 'true');
    // A finger opens the card on lift, and only if it did not travel (so a
    // swipe still pans); a pen or mouse press opens it at once.
    let pendingTouch = null; // { pointerId, x, y }
    const open = (clientX, clientY) => {
      setDialog({ mode: 'create', where: { clientX, clientY }, initial: { text: '', color: readNoteLastColor() } });
    };
    const onDown = (event) => {
      pendingTouch = null;
      if (event.button !== 0 || !event.isPrimary || !pointerMayUseTool(event.pointerType)) return;
      const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
      if (target?.closest?.(CONTROL)) return;
      if (!pageElementAt(host, event.clientX, event.clientY)) return;
      if (event.pointerType === 'touch') {
        pendingTouch = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      open(event.clientX, event.clientY);
    };
    const onUp = (event) => {
      const pending = pendingTouch;
      pendingTouch = null;
      if (!pending || pending.pointerId !== event.pointerId) return;
      if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 8) return;
      open(pending.x, pending.y);
    };
    const onCancel = () => { pendingTouch = null; };
    host.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    return () => {
      host.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      host.removeAttribute('data-sticky-note-tool');
    };
  }, [armed, hostRef]);

  // Leaving the tab closes an open card: it is portalled to <body>.
  useEffect(() => {
    if (!isActive) setDialog(null);
  }, [isActive]);

  const selectedRef = useRef(selectedNote);
  selectedRef.current = selectedNote;
  useEffect(() => {
    if (!isActive) return undefined;
    const onEdit = () => {
      const picked = selectedRef.current;
      if (!picked) return;
      setDialog({ mode: 'edit', initial: { text: picked.text, color: picked.color } });
    };
    window.addEventListener(NOTE_EDIT_EVENT, onEdit);
    return () => window.removeEventListener(NOTE_EDIT_EVENT, onEdit);
  }, [isActive]);

  // Cleared at once on submit, so a second click before the re-render can't
  // place the same note twice.
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  const close = useCallback(() => setDialog(null), []);
  const submit = useCallback(({ text, color }) => {
    const current = dialogRef.current;
    dialogRef.current = null;
    setDialog(null);
    if (!current) return;
    saveNoteLastColor(color);
    if (current.mode === 'edit') {
      onPatchSelectedNote?.({ text, color });
      return;
    }
    const item = stickyNoteItem({ text, color });
    placeLibraryItem(item, current.where);
  }, [onPatchSelectedNote]);

  return (
    <StickyNoteDialog
      open={Boolean(dialog)}
      mode={dialog?.mode || 'create'}
      initial={dialog?.initial || null}
      readOnly={readOnly}
      onSubmit={submit}
      onCancel={close}
    />
  );
}
