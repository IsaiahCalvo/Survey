// src/components/collab/ReSignInModal.jsx
// Phase 28 — Inline re-sign-in form on document page.
// Source: .planning/phases/28-transport-spike-auth-validator/28-UI-SPEC.md
//         Component Inventory section 2.
//
// UX: when the silent token refresh fails (password changed elsewhere, account locked,
// refresh token revoked), this modal pops INLINE on the document page. After successful
// re-sign-in the user is still on the same document — they don't get bounced back to the
// dashboard or login screen. Per CONTEXT.md decision: "don't make them lose their place."
//
// Why not extend AuthModal.jsx:
//   - AuthModal is fullscreen position:fixed at z-index:10000 — covers the document
//     the user is trying to keep their place in (defeats CONTEXT decision)
//   - AuthModal carries 4 modes (login/signup/SSO/reset) that are wrong for re-sign-in
//   - Refactoring AuthModal is out of scope; not in DO NOT CHANGE allowlist but expansive
//
// Hard contract (UI-SPEC anti-UI departures from typical modal etiquette):
//   - ESC key is a NO-OP (modal is non-dismissible — must commit to re-sign-in)
//   - Click outside is a NO-OP (no scrim layer anyway)
//   - The only ways out are successful sign-in OR closing the document via
//     "Sign in with a different account"

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import './ReSignInModal.css';

/**
 * Inline re-sign-in modal — mounts on the document page (NOT fullscreen).
 *
 * @param {object} props
 * @param {boolean} props.isOpen
 * @param {() => void} [props.onSignedIn]      Fires after successful re-sign-in
 * @param {() => void} [props.onCloseDocument] Fires when user picks "Sign in with a different account"
 * @param {string|null} [props.prefillEmail]   Pre-fills the email input (current auth.user.email if available)
 */
export function ReSignInModal({ isOpen, onSignedIn, onCloseDocument, prefillEmail }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState(prefillEmail || '');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // 'bad_password' | 'network' | 'account_locked' | null — error code drives copy below.
  const [errorCode, setErrorCode] = useState(null);
  const passwordRef = useRef(null);
  const emailRef = useRef(null);

  // UX: initial focus per UI-SPEC — email input UNLESS prefilled, then password.
  // Avoids a useless tab into an already-filled field; saves the user one keystroke.
  useEffect(() => {
    if (!isOpen) return;
    const target = prefillEmail ? passwordRef.current : emailRef.current;
    target?.focus();
  }, [isOpen, prefillEmail]);

  // UX: ESC is a deliberate NO-OP. Modal is non-dismissible per UI-SPEC.
  // The only ways out are successful sign-in OR clicking "Sign in with a different
  // account" (which calls onCloseDocument). Bailing without re-auth would loop the
  // user right back to the login_expiry_failure banner — it would be a fake escape.
  // Do NOT add an Escape handler that closes.
  useEffect(() => {
    if (!isOpen) return;
    const noOpEsc = (e) => {
      if (e.key === 'Escape') e.preventDefault();
    };
    window.addEventListener('keydown', noOpEsc);
    return () => window.removeEventListener('keydown', noOpEsc);
  }, [isOpen]);

  if (!isOpen) return null;

  // UX: CTA enables only when both fields have content AND a previous submit
  // is not in flight. Disabled state uses opacity 0.5 + cursor:not-allowed
  // (defined in ReSignInModal.css) so the user gets a visible cue that the
  // button isn't actionable yet.
  const canSubmit = email.length > 0 && password.length > 0 && !submitting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorCode(null);
    try {
      // useAuth().signIn signature throws on error in this project (see
      // AuthContext.jsx:226 — signInWithPassword, throws on error). The
      // surrounding try/catch is the canonical error gate; we never see
      // a {error: ...} return shape from this hook. Branch on err.message
      // tags to map onto the UI-SPEC error copy.
      await signIn(email, password);
      onSignedIn?.();
    } catch (err) {
      const msg = (err?.message || '').toLowerCase();
      if (msg.includes('network') || err?.name === 'TypeError' || msg.includes('fetch')) {
        // UX: network failure — the server is unreachable. Tells the user to
        // check their connection rather than blaming their credentials.
        setErrorCode('network');
      } else if (msg.includes('locked') || msg.includes('disabled')) {
        // UX: account locked — admin contact path; user can't self-recover.
        setErrorCode('account_locked');
      } else {
        // UX: default — bad password is the most common reason. The copy says
        // "email and password don't match" rather than blaming just the
        // password (could be a typo'd email too).
        setErrorCode('bad_password');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // UX: error message is decoupled from raw error so the copy is editable
  // here (not at every catch site). All three strings come from UI-SPEC verbatim.
  const errorMessage = (() => {
    if (errorCode === 'bad_password') return "That email and password don't match. Try again.";
    if (errorCode === 'network') return "We couldn't reach the server. Check your connection and try again.";
    if (errorCode === 'account_locked') return "This account is locked. Contact your administrator.";
    return null;
  })();

  return (
    <div
      className="re-signin-modal"
      // dialog + aria-modal so assistive tech treats this as a modal even
      // though there's no scrim layer — matches UI-SPEC accessibility contract.
      role="dialog"
      aria-modal="true"
      aria-labelledby="re-signin-heading"
    >
      <h2 id="re-signin-heading" className="re-signin-modal__heading">Sign back in</h2>
      <p className="re-signin-modal__subtitle">
        We'll bring you right back to where you left off — your edits are safe on this device.
      </p>
      {errorMessage && (
        // UX: role="alert" so screen readers announce the error immediately
        // when it appears. aria-live is implicit on role="alert".
        <div className="re-signin-modal__error" role="alert">{errorMessage}</div>
      )}
      <form onSubmit={handleSubmit} className="re-signin-modal__form">
        <label className="re-signin-modal__label" htmlFor="re-signin-email">Email</label>
        <input
          id="re-signin-email"
          ref={emailRef}
          type="email"
          className="re-signin-modal__input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          // autoComplete cue: the password manager should treat this as a current
          // sign-in (not a new account / signup). Browser's saved credential
          // suggestions appear under the email field.
          autoComplete="email"
        />
        <label className="re-signin-modal__label" htmlFor="re-signin-password">Password</label>
        <input
          id="re-signin-password"
          ref={passwordRef}
          type="password"
          className="re-signin-modal__input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          autoComplete="current-password"
        />
        <button
          type="submit"
          className="re-signin-modal__cta"
          disabled={!canSubmit}
        >
          {/* UX: loading-state label per UI-SPEC — "Signing in…" with the ellipsis
              character (single glyph U+2026). Confirms to the user the click
              registered without a separate spinner element. */}
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <div className="re-signin-modal__secondary">
        <a
          href="#forgot"
          className="re-signin-modal__link-primary"
          onClick={(e) => {
            e.preventDefault();
            // UX: Phase 33 wires this to the password reset flow. Until then,
            // tell the user the only path: close the document and use the
            // dashboard sign-in. Honest-over-silent — don't pretend the link
            // works when it doesn't.
            // TODO(Phase 33): wire to AuthContext.resetPassword(email) once
            // the inline reset surface is designed.
            window.alert(
              'Password reset is not wired up yet — close the document and use the dashboard sign-in to reset your password.'
            );
          }}
        >
          Forgot password?
        </a>
        <button
          type="button"
          className="re-signin-modal__link-secondary"
          onClick={() => onCloseDocument?.()}
        >
          {/* UX: last-resort exit. Closes the document so the user can pick a
              different account from the dashboard. Closing here is fine — the
              document is unsaved-state-safe via Phase 27 IndexedDB persistence. */}
          Sign in with a different account
        </button>
      </div>
    </div>
  );
}

export default ReSignInModal;
