// src/components/dialogPrompts.jsx
//
// KAL-57 (+ KAL-72) — promise-based, themed replacements for the native
// `confirm()` and `prompt()` dialogs that survived the alert() migration.
//
// WHY A PROMISE: every call site we replaced had the shape
//   `if (!confirm(msg)) return;`  /  `const raw = prompt(msg); if (raw == null) return;`
// inside a longer body, and two of them (`hubDeleteProjects`) even return a
// boolean the caller consumes. Modelling the themed modal as a promise keeps
// that control flow byte-for-byte equivalent — `if (!(await askConfirm(...)))
// return;` — instead of forcing every handler to be split into a callback and
// risking code running before the user has answered.
//
// WHY NOT A NEW MODAL: `useConfirmDialog` renders the app's existing
// `ConfirmModal` (src/home/BulkModals.jsx) — the same component the hub bulk
// actions already use. No third confirm pattern, no new library.
//
// `PromptModal` below is the one genuinely new piece: the app had no themed
// text-input dialog. It deliberately mirrors ConfirmModal's shell (same card,
// scrim, rule, footer bar and palette) so it reads as the same family.
//
// UX / KAL-72 contract for both:
//   - Footer order is Cancel (ghost, LEFT) then the primary action (RIGHT).
//   - Destructive primary actions render red (`danger`); non-destructive ones
//     (e.g. "Lock document") use the brand gold primary.
//   - Escape and the scrim both cancel, and cancelling resolves to the same
//     value the native dialog returned on cancel (false / null) so no caller
//     can mistake a dismissal for a confirmation.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmModal } from '../home/BulkModals';
import { closeButtonStyle } from '../home/hubControls';
import { Icon } from '../home/HubShell';
import { C } from '../uiPalette';

// Literal hex colors mirror src/home/BulkModals.jsx: these overlays render
// outside the `.survey-hub` root where the palette CSS variables aren't in
// scope. Keep in sync with that file's `C` map.

const overlay = {
  position: 'fixed', inset: 0, background: C.scrim,
  backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1300,
  fontFamily: 'var(--font-ui)',
};

const cancelButtonStyle = {
  background: 'transparent', border: 0, color: C.muted, padding: '6px 10px',
  fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', borderRadius: 6,
};

/**
 * Themed stand-in for native `prompt()`.
 *
 * Resolves through `onSubmit(value)` on confirm (value may be an empty string,
 * exactly like `prompt()` returning '') and `onCancel()` on dismissal, so the
 * "user typed nothing but pressed OK" case stays distinguishable from
 * "user cancelled" — the lock flow depends on that distinction.
 */
export function PromptModal({
  open,
  title = '',
  message = '',
  label = '',
  placeholder = '',
  defaultValue = '',
  confirmLabel = 'OK',
  onSubmit,
  onCancel,
}) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  // Reset the field every time the dialog opens so a previous answer never
  // leaks into the next one.
  useEffect(() => {
    if (open) setValue(defaultValue);
  }, [open, defaultValue]);

  // Accessibility: Escape cancels, the text field takes focus on open, and
  // focus returns to whatever triggered the dialog once it closes. Mirrors the
  // per-modal pattern in BulkModals (no shared modal primitive / focus trap).
  useEffect(() => {
    if (!open) return undefined;
    previouslyFocusedRef.current = document.activeElement;
    inputRef.current?.focus?.();
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel?.();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => {
      window.removeEventListener('keydown', handleKey, true);
      previouslyFocusedRef.current?.focus?.();
      previouslyFocusedRef.current = null;
    };
  }, [open, onCancel]);

  if (!open) return null;

  const submit = () => { onSubmit?.(value); };

  return (
    <div onClick={onCancel} style={overlay}>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{ width: 400, maxWidth: '92vw', background: C.card, border: `1px solid ${C.rule}`, borderRadius: 'var(--radius-dialog)', boxShadow: '0 24px 60px rgba(0,0,0,0.55)', color: C.ink, overflow: 'hidden' }}
      >
        <div style={{ padding: '18px 18px 14px', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.015em' }}>{title}</div>
            {message && <div style={{ fontSize: 12, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>{message}</div>}
            {label && (
              <div style={{ fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.muted, fontWeight: 700, marginTop: 14, marginBottom: 6 }}>
                {label}
              </div>
            )}
            <input
              ref={inputRef}
              type="text"
              value={value}
              placeholder={placeholder}
              onChange={(e) => setValue(e.target.value)}
              // Enter submits, matching the native prompt()'s keyboard contract.
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
              style={{
                width: '100%', boxSizing: 'border-box', marginTop: label ? 0 : 14,
                // A text field's edge is the only thing saying "type here", so
                // it takes the identifying rule (tokens.css revision 4).
                background: C.deep, border: `1px solid ${C.ruleStrong}`, borderRadius: 6,
                color: C.ink, padding: '7px 10px', fontSize: 12.5, fontFamily: 'inherit',
                outline: 'none',
              }}
            />
          </div>
          <button onClick={onCancel} title="Close" aria-label="Close" style={closeButtonStyle({ borderColor: C.ruleStrong, color: C.muted })}><Icon name="close" size={13} /></button>
        </div>
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.rule}`, background: C.deep, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={cancelButtonStyle}>Cancel</button>
          <button
            onClick={submit}
            style={{ background: C.gold, color: 'var(--accent-text)', border: 0, borderRadius: 6, padding: '5px 14px', height: 28, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * `const [askConfirm, confirmDialog] = useConfirmDialog();`
 *
 * `askConfirm({ title, message, confirmLabel, danger })` returns a Promise
 * that resolves `true` only when the user presses the primary button, and
 * `false` for every dismissal path (Cancel, ×, Escape, scrim click).
 * Render `confirmDialog` somewhere in the component's tree.
 */
export function useConfirmDialog() {
  const [state, setState] = useState(null);
  const resolveRef = useRef(null);

  const settle = useCallback((answer) => {
    const resolve = resolveRef.current;
    // Clear FIRST: ConfirmModal calls onConfirm() and then onClose(), so the
    // second call must be a no-op rather than resolving an already-settled
    // promise with `false`.
    resolveRef.current = null;
    if (!resolve) return;
    setState(null);
    resolve(answer);
  }, []);

  // Safety net: if the host component unmounts while a dialog is open, resolve
  // as "cancelled" so an awaiting handler can never hang forever.
  useEffect(() => () => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(false);
  }, []);

  const askConfirm = useCallback((options = {}) => new Promise((resolve) => {
    // A second ask while one is open cancels the first — never silently drop
    // a pending promise.
    const pending = resolveRef.current;
    resolveRef.current = null;
    pending?.(false);

    resolveRef.current = resolve;
    setState({
      title: 'Are you sure?',
      message: '',
      confirmLabel: 'Confirm',
      danger: false,
      ...options,
    });
  }), []);

  const element = (
    <ConfirmModal
      open={!!state}
      title={state?.title}
      message={state?.message}
      confirmLabel={state?.confirmLabel}
      danger={!!state?.danger}
      onConfirm={() => settle(true)}
      onClose={() => settle(false)}
    />
  );

  return [askConfirm, element];
}

/**
 * `const [askPrompt, promptDialog] = usePromptDialog();`
 *
 * `askPrompt({ title, message, label, placeholder, defaultValue, confirmLabel })`
 * returns a Promise resolving to the entered string (possibly '') on confirm,
 * or `null` on any dismissal — the same contract native `prompt()` had.
 */
export function usePromptDialog() {
  const [state, setState] = useState(null);
  const resolveRef = useRef(null);

  const settle = useCallback((answer) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    if (!resolve) return;
    setState(null);
    resolve(answer);
  }, []);

  useEffect(() => () => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(null);
  }, []);

  const askPrompt = useCallback((options = {}) => new Promise((resolve) => {
    const pending = resolveRef.current;
    resolveRef.current = null;
    pending?.(null);

    resolveRef.current = resolve;
    setState({ defaultValue: '', confirmLabel: 'OK', ...options });
  }), []);

  const element = (
    <PromptModal
      open={!!state}
      title={state?.title}
      message={state?.message}
      label={state?.label}
      placeholder={state?.placeholder}
      defaultValue={state?.defaultValue ?? ''}
      confirmLabel={state?.confirmLabel}
      onSubmit={(value) => settle(value)}
      onCancel={() => settle(null)}
    />
  );

  return [askPrompt, element];
}
