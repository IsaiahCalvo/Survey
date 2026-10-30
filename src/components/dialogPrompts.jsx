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
import DialogCard from './DialogCard.jsx';
import { DIALOG_FIELD_STYLE, DIALOG_LABEL_STYLE } from './DialogCard.jsx';

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
  zIndex,
  onSubmit,
  onCancel,
}) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef(null);

  // Reset the field every time the dialog opens so a previous answer never
  // leaks into the next one.
  useEffect(() => {
    if (open) setValue(defaultValue);
  }, [open, defaultValue]);

  const submit = () => { onSubmit?.(value); };

  // KAL-461: a tap on the scrim cancels only while nothing has been typed;
  // with a changed answer it does nothing (Cancel, x and Escape still cancel),
  // so a stray tap never throws the typing away.
  const onScrim = () => { if (value === defaultValue) onCancel?.(); };

  // Design review 2026-10-27: the prompt had its own card (a boxed x, an ALL
  // CAPS label, a small gold button). It now sits on the one dialog shell
  // (DialogCard: KAL-66 focus trap, Escape cancels, focus goes back to the
  // opener) with the shared field and hub buttons.
  return (
    <DialogCard
      open={open}
      title={title}
      ariaLabel={typeof title === 'string' && title ? title : 'Enter a value'}
      message={message}
      onClose={onCancel}
      onScrim={onScrim}
      width={400}
      zIndex={zIndex}
      footer={(
        <>
          <button type="button" className="hub-btn dialog-touch-pad" onClick={onCancel}>Cancel</button>
          <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" onClick={submit}>{confirmLabel}</button>
        </>
      )}
    >
      <label style={{ display: 'block', marginTop: message ? 2 : 0 }}>
        {label && <span style={DIALOG_LABEL_STYLE}>{label}</span>}
        <input
          ref={inputRef}
          className="dialog-prompt-input"
          type="text"
          aria-label={label || title || undefined}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          // Enter submits, matching the native prompt()'s keyboard contract.
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          style={DIALOG_FIELD_STYLE}
        />
      </label>
    </DialogCard>
  );
}

/**
 * `const [askConfirm, confirmDialog] = useConfirmDialog();`
 *
 * `askConfirm({ title, message, confirmLabel, danger, zIndex })` returns a Promise
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
      zIndex={state?.zIndex}
      onConfirm={() => settle(true)}
      onClose={() => settle(false)}
    />
  );

  return [askConfirm, element];
}

/**
 * `const [askPrompt, promptDialog] = usePromptDialog();`
 *
 * `askPrompt({ title, message, label, placeholder, defaultValue, confirmLabel, zIndex })`
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
      zIndex={state?.zIndex}
      onSubmit={(value) => settle(value)}
      onCancel={() => settle(null)}
    />
  );

  return [askPrompt, element];
}
