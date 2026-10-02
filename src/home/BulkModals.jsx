/* Survey Hub — small modals for Documents bulk actions.
   MoveCopyModal — pick a destination project; move the documents there or
   copy them there (copy leaves the originals in place), matching the
   Move/Copy feature from the original app.
   ConfirmModal — a simple confirm gate, used before deleting.

   Literal hex colors: these overlays render outside the `.survey-hub` root,
   where the palette CSS variables are not in scope.
*/
import { useEffect, useRef, useState } from 'react';
import { Icon } from './HubShell';
import { useFocusTrap } from '../hooks/useFocusTrap';
import Spinner from '../components/Spinner';
import { C } from '../uiPalette';


const overlay = {
  position: 'fixed', inset: 0, background: C.scrim,
  backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1300,
  fontFamily: 'var(--font-ui)',
};

export function MoveCopyModal({ open, onClose, projects = [], count = 0, onConfirm }) {
  const [mode, setMode] = useState('move'); // 'move' | 'copy'
  const [destId, setDestId] = useState(null);
  const cardRef = useRef(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const handleConfirm = async () => {
    if (!destId || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await onConfirm?.(destId, mode);
      onClose?.();
    } catch (error) {
      setSubmitError(error?.message || `Could not ${mode} the selected documents.`);
    } finally {
      setSubmitting(false);
    }
  };


  // Accessibility (KAL-66): Tab stays inside the dialog, Escape closes it,
  // and focus returns to whatever opened it.
  useFocusTrap(cardRef, open, { onEscape: submitting ? undefined : onClose });

  useEffect(() => {
    if (open) setSubmitError('');
  }, [open]);

  if (!open) return null;

  const modeBtn = (val, label) => (
    <button
      onClick={() => setMode(val)}
      style={{
        flex: 1, height: 28, borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
        fontSize: 12, fontWeight: 600,
        background: mode === val ? C.gold : 'transparent',
        color: mode === val ? 'var(--accent-text)' : C.inkSoft,
        border: `1px solid ${mode === val ? C.gold : C.ruleStrong}`,
      }}
    >
      {label}
    </button>
  );

  return (
    <div onClick={submitting ? undefined : onClose} style={overlay}>
      <div ref={cardRef} role="dialog" aria-modal="true" aria-label="Move or copy documents" onClick={(e) => e.stopPropagation()} style={{ width: 420, maxWidth: '92vw', background: C.card, border: `1px solid ${C.rule}`, borderRadius: 10, boxShadow: '0 24px 60px rgba(0,0,0,0.55)', color: C.ink, overflow: 'hidden' }}>
        <div style={{ padding: '16px 18px 14px', borderBottom: `1px solid ${C.rule}`, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 0, color: C.muted, fontWeight: 600 }}>Move or copy</div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.015em', marginTop: 4 }}>{count} {count === 1 ? 'document' : 'documents'}</div>
          </div>
          <button disabled={submitting} onClick={onClose} title="Close" aria-label="Close" className="hub-icon-btn"><Icon name="close" size={13} /></button>
        </div>
        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {modeBtn('move', 'Move')}
            {modeBtn('copy', 'Copy')}
          </div>
          <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.4 }}>
            {mode === 'move' ? 'Moves the documents into the chosen project.' : 'Copies the documents into the chosen project; originals stay where they are.'}
          </div>
          {submitError && (
            <div role="alert" style={{ fontSize: 12, color: C.dangerText, lineHeight: 1.4 }}>
              {submitError} Try again.
            </div>
          )}
          <div>
            <div style={{ fontSize: 11, letterSpacing: 0, color: C.muted, fontWeight: 600, marginBottom: 8 }}>Destination project</div>
            <div style={{ maxHeight: 200, overflowY: 'auto', border: `1px solid ${C.rule}`, borderRadius: 6 }}>
              {projects.length === 0 && <div style={{ padding: '12px', fontSize: 12, color: C.muted }}>No projects to move into.</div>}
              {projects.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => setDestId(p.id)}
                  aria-pressed={destId === p.id}
                  style={{
                    display: 'block', width: '100%', padding: '9px 12px', fontSize: 13,
                    cursor: 'pointer', color: C.ink, textAlign: 'left', fontFamily: 'inherit',
                    // UX 2026-09-17 (owner ruling: no warm fill on a selected thing).
                    // A destination is a ROW, so it takes the approved row cue — a
                    // surface step plus the 2px gold left edge below.
                    background: destId === p.id ? 'var(--surface-3)' : 'transparent',
                    border: 0, borderLeft: `2px solid ${destId === p.id ? C.gold : 'transparent'}`,
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.rule}`, background: C.deep, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button disabled={submitting} onClick={onClose} className="hub-btn">Cancel</button>
          <button
            disabled={!destId || submitting}
            onClick={handleConfirm}
            className="hub-btn hub-btn--primary"
          >
            {/* KAL-73: ring to the left of the participle label while the batch runs. */}
            {submitting && <Spinner size={14} color="currentColor" />}
            {submitting ? (mode === 'move' ? 'Moving…' : 'Copying…') : (mode === 'move' ? 'Move here' : 'Copy here')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmModal({ open, onClose, title = 'Are you sure?', message = '', confirmLabel = 'Confirm', busyLabel = null, danger = false, onConfirm }) {
  const cardRef = useRef(null);
  // KAL-73: when onConfirm returns a promise (bulk delete etc.), the modal
  // stays up with a ring + participle label until it settles. Synchronous
  // confirms keep the old close-immediately behavior — no one-frame spinner.
  const [submitting, setSubmitting] = useState(false);

  // Accessibility (KAL-66): the shared modal primitive — Tab stays inside the
  // dialog, Escape closes it, and focus returns to whatever opened it. This is
  // the destructive confirm gate, so letting Tab escape onto the rows being
  // deleted was the worst place in the app to lose focus.
  useFocusTrap(cardRef, open, { onEscape: submitting ? undefined : onClose });

  useEffect(() => {
    if (open) setSubmitting(false);
  }, [open]);

  if (!open) return null;

  const handleConfirm = async () => {
    if (submitting) return;
    const result = onConfirm && onConfirm();
    if (result && typeof result.then === 'function') {
      setSubmitting(true);
      try { await result; } catch { /* the action owns its own error toast */ }
    }
    onClose();
  };

  return (
    <div onClick={submitting ? undefined : onClose} style={overlay}>
      <div ref={cardRef} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={{ width: 380, maxWidth: '92vw', background: C.card, border: `1px solid ${C.rule}`, borderRadius: 10, boxShadow: '0 24px 60px rgba(0,0,0,0.55)', color: C.ink, overflow: 'hidden' }}>
        <div style={{ padding: '18px 18px 14px', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.015em' }}>{title}</div>
            {message && <div style={{ fontSize: 12, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>{message}</div>}
          </div>
          <button disabled={submitting} onClick={onClose} title="Close" aria-label="Close" className="hub-icon-btn"><Icon name="close" size={13} /></button>
        </div>
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.rule}`, background: C.deep, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button disabled={submitting} onClick={onClose} className="hub-btn">Cancel</button>
          {/* A delete confirm is still the dialog's primary action, so it keeps
              the filled shape and only swaps gold for the destructive red
              (is-danger on PRIMARY = --danger-fill + white label). */}
          <button
            disabled={submitting}
            onClick={handleConfirm}
            className={danger ? 'hub-btn hub-btn--primary is-danger' : 'hub-btn hub-btn--primary'}
          >
            {submitting && <Spinner size={14} color="currentColor" />}
            {submitting ? (busyLabel || `${confirmLabel}…`) : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function RenameModal({ open, onClose, title = 'Rename', initialName = '', onConfirm }) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setName(initialName);
    previouslyFocusedRef.current = document.activeElement;
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleKey, true);
      previouslyFocusedRef.current?.focus?.();
      previouslyFocusedRef.current = null;
    };
  }, [initialName, onClose, open]);

  if (!open) return null;
  const trimmed = name.trim();
  // Owner 2026-10-02: only a real change is saved. The same name just closes.
  const unchanged = trimmed === (initialName || '').trim();
  const submit = () => {
    if (!trimmed) return;
    if (!unchanged) onConfirm?.(trimmed);
    onClose?.();
  };

  return (
    <div onClick={onClose} style={overlay}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        style={{ width: 380, maxWidth: '92vw', background: C.card, border: `1px solid ${C.rule}`, borderRadius: 10, boxShadow: '0 24px 60px rgba(0,0,0,0.55)', color: C.ink, overflow: 'hidden' }}
      >
        <div style={{ padding: '18px 18px 14px', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.015em' }}>{title}</div>
            <label style={{ display: 'block', marginTop: 12 }}>
              <span style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 6 }}>Name</span>
              <input
                ref={inputRef}
                aria-label="Name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submit();
                  }
                }}
                style={{ width: '100%', height: 44, boxSizing: 'border-box', borderRadius: 7, border: `1px solid ${C.ruleStrong}`, background: C.deep, color: C.ink, padding: '0 11px', fontSize: 16, fontFamily: 'inherit', outline: 'none' }}
              />
            </label>
          </div>
          <button onClick={onClose} title="Close" className="hub-icon-btn"><Icon name="close" size={16} /></button>
        </div>
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.rule}`, background: C.deep, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="hub-btn" style={{ minHeight: 44 }}>Cancel</button>
          <button
            disabled={!trimmed || unchanged}
            onClick={submit}
            className="hub-btn hub-btn--primary"
            style={{ minHeight: 44 }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
