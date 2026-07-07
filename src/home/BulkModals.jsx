/* Survey Hub — small modals for Documents bulk actions.
   MoveCopyModal — pick a destination project; move the documents there or
   copy them there (copy leaves the originals in place), matching the
   Move/Copy feature from the original app.
   ConfirmModal — a simple confirm gate, used before deleting.

   Literal hex colors: these overlays render outside the `.survey-hub` root,
   where the palette CSS variables are not in scope.
*/
import { useEffect, useRef, useState } from 'react';

const C = {
  scrim: 'rgba(13,15,20,0.55)',
  card: '#181c24',
  deep: '#12151c',
  rule: '#2a3140',
  ink: '#f4f1ea',
  inkSoft: '#e8e2d4',
  muted: '#8d96a6',
  gold: '#d8a84e',
  danger: '#cf6f6f',
};

const overlay = {
  position: 'fixed', inset: 0, background: C.scrim,
  backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1300,
  fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
};

export function MoveCopyModal({ open, onClose, projects = [], count = 0, onConfirm }) {
  const [mode, setMode] = useState('move'); // 'move' | 'copy'
  const [destId, setDestId] = useState(null);
  const previouslyFocusedRef = useRef(null);

  // Accessibility: Escape closes the modal, and focus returns to whatever
  // triggered it once it closes (minimal per-modal patch, no shared modal
  // primitive/focus trap).
  useEffect(() => {
    if (!open) return undefined;
    previouslyFocusedRef.current = document.activeElement;
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => {
      window.removeEventListener('keydown', handleKey, true);
      previouslyFocusedRef.current?.focus?.();
      previouslyFocusedRef.current = null;
    };
  }, [open, onClose]);

  if (!open) return null;

  const modeBtn = (val, label) => (
    <button
      onClick={() => setMode(val)}
      style={{
        flex: 1, height: 28, borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
        fontSize: 11.5, fontWeight: 600,
        background: mode === val ? C.gold : 'transparent',
        color: mode === val ? '#15110a' : C.inkSoft,
        border: `1px solid ${mode === val ? C.gold : C.rule}`,
      }}
    >
      {label}
    </button>
  );

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 420, maxWidth: '92vw', background: C.card, border: `1px solid ${C.rule}`, borderRadius: 10, boxShadow: '0 24px 60px rgba(0,0,0,0.55)', color: C.ink, overflow: 'hidden' }}>
        <div style={{ padding: '16px 18px 14px', borderBottom: `1px solid ${C.rule}` }}>
          <div style={{ fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.muted, fontWeight: 700 }}>Move or copy</div>
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.015em', marginTop: 4 }}>{count} {count === 1 ? 'document' : 'documents'}</div>
        </div>
        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {modeBtn('move', 'Move')}
            {modeBtn('copy', 'Copy')}
          </div>
          <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.4 }}>
            {mode === 'move' ? 'Moves the documents into the chosen project.' : 'Copies the documents into the chosen project; originals stay where they are.'}
          </div>
          <div>
            <div style={{ fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.muted, fontWeight: 700, marginBottom: 8 }}>Destination project</div>
            <div style={{ maxHeight: 200, overflowY: 'auto', border: `1px solid ${C.rule}`, borderRadius: 6 }}>
              {projects.length === 0 && <div style={{ padding: '12px', fontSize: 11.5, color: C.muted }}>No projects to move into.</div>}
              {projects.map((p) => (
                <div
                  key={p.id}
                  onClick={() => setDestId(p.id)}
                  style={{
                    padding: '9px 12px', fontSize: 12.5, cursor: 'pointer',
                    background: destId === p.id ? 'rgba(216,168,78,0.12)' : 'transparent',
                    borderLeft: `2px solid ${destId === p.id ? C.gold : 'transparent'}`,
                  }}
                >
                  {p.name}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.rule}`, background: C.deep, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'transparent', border: 0, color: C.muted, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', borderRadius: 6 }}>Cancel</button>
          <button
            disabled={!destId}
            onClick={() => { onConfirm && onConfirm(destId, mode); onClose(); }}
            style={{ opacity: destId ? 1 : 0.45, cursor: destId ? 'pointer' : 'not-allowed', background: C.gold, color: '#15110a', border: 0, borderRadius: 6, padding: '5px 14px', height: 28, fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit' }}
          >
            {mode === 'move' ? 'Move here' : 'Copy here'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmModal({ open, onClose, title = 'Are you sure?', message = '', confirmLabel = 'Confirm', danger = false, onConfirm }) {
  const previouslyFocusedRef = useRef(null);

  // Accessibility: Escape closes the modal, and focus returns to whatever
  // triggered it once it closes (minimal per-modal patch, no shared modal
  // primitive/focus trap).
  useEffect(() => {
    if (!open) return undefined;
    previouslyFocusedRef.current = document.activeElement;
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => {
      window.removeEventListener('keydown', handleKey, true);
      previouslyFocusedRef.current?.focus?.();
      previouslyFocusedRef.current = null;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 380, maxWidth: '92vw', background: C.card, border: `1px solid ${C.rule}`, borderRadius: 10, boxShadow: '0 24px 60px rgba(0,0,0,0.55)', color: C.ink, overflow: 'hidden' }}>
        <div style={{ padding: '18px 18px 14px' }}>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.015em' }}>{title}</div>
          {message && <div style={{ fontSize: 12, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>{message}</div>}
        </div>
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.rule}`, background: C.deep, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'transparent', border: 0, color: C.muted, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', borderRadius: 6 }}>Cancel</button>
          <button
            onClick={() => { onConfirm && onConfirm(); onClose(); }}
            style={{ background: danger ? C.danger : C.gold, color: danger ? '#fff' : '#15110a', border: 0, borderRadius: 6, padding: '5px 14px', height: 28, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
