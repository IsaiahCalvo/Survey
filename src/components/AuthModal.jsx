/**
 * AuthModal.jsx — sign-in / sign-up / SSO / password-reset modal.
 *
 * Named export `AuthModal` ({ isOpen, onClose, onDismiss }); a single-form modal
 * with a `mode` switch (login / signup / confirm / sso / reset) wired to useAuth
 * (signIn, signUp, signInWithGoogle, signInWithSSO, resetPassword,
 * resendConfirmation). onDismiss (when present) lets unauthenticated users
 * continue without an account.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { hasCoarsePointer } from '../hooks/useCoarsePointer';
import { resendCooldownRemainingMs, passwordMeetsRequirements } from './authFlow';
import PasswordRequirements from './PasswordRequirements';
import Spinner from './Spinner';
import TurnstileWidget, { TURNSTILE_ENABLED } from './TurnstileWidget';
import Icon from '../Icons';
import './AuthModal.css';

export const AuthModal = ({ isOpen, onClose, onDismiss }) => {
  const [mode, setMode] = useState('login'); // 'login', 'signup', 'confirm', 'sso', 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [ssoDomain, setSsoDomain] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  // Epoch-ms of the last confirmation email send (signUp counts as one) and
  // the seconds left on the resend cooldown, ticked down by the effect below.
  const [resendLastSentAt, setResendLastSentAt] = useState(0);
  const [resendRemaining, setResendRemaining] = useState(0);
  // Cloudflare Turnstile: token for the current attempt, a nonce to remount the
  // widget for a fresh single-use token, and a fail-open flag if it can't load.
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaNonce, setCaptchaNonce] = useState(0);
  const [captchaBroken, setCaptchaBroken] = useState(false);
  const modalRef = useRef(null);

  const { signIn, signUp, signInWithGoogle, signInWithSSO, resetPassword, resendConfirmation } = useAuth();

  const handleClose = useCallback(() => {
    // If onDismiss is available (for non-authenticated users), use it
    // Otherwise use onClose (for authenticated users or when dismiss isn't available)
    if (onDismiss) {
      onDismiss();
    } else {
      onClose();
    }
  }, [onDismiss, onClose]);

  // Keyboard accessibility: Tab stays inside the dialog, Escape dismisses it,
  // focus opens on the first field and returns to the opener on close.
  // 2026-10-07 (phone loading): on a touch screen focus lands on the title
  // instead (data-autofocus below). The sheet opens by itself when the app
  // starts signed out, and focusing the email field there threw the phone
  // keyboard up over half the screen before anyone asked to type. A tap in the
  // field brings the keyboard as usual; a screen reader still starts inside.
  const focusTitleFirst = hasCoarsePointer();
  useFocusTrap(modalRef, isOpen, { onEscape: handleClose });

  // Modes that hit a captcha-protected endpoint (signin / signup / recover).
  const captchaMode = mode === 'login' || mode === 'signup' || mode === 'reset';
  const resetCaptcha = () => {
    setCaptchaToken('');
    setCaptchaNonce((n) => n + 1);
  };

  useEffect(() => {
    if (!resendLastSentAt) return undefined;
    const update = () => {
      const remaining = Math.ceil(resendCooldownRemainingMs(resendLastSentAt, Date.now()) / 1000);
      setResendRemaining(remaining);
      return remaining;
    };
    if (update() === 0) return undefined;
    const intervalId = setInterval(() => {
      if (update() === 0) clearInterval(intervalId);
    }, 1000);
    return () => clearInterval(intervalId);
  }, [resendLastSentAt]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    // Gate captcha-protected modes on a completed check. Fail open if Turnstile
    // itself couldn't load (captchaBroken) so a blocked CDN never locks anyone out.
    if (TURNSTILE_ENABLED && captchaMode && !captchaToken && !captchaBroken) {
      setError('Please complete the "I\'m human" check below, then try again.');
      return;
    }

    setLoading(true);

    try {
      if (mode === 'login') {
        await signIn(email, password, captchaToken);
        onClose();
      } else if (mode === 'signup') {
        if (password !== confirmPassword) {
          setError('Passwords do not match');
          setLoading(false);
          return;
        }
        if (!passwordMeetsRequirements(password, { email, firstName, lastName })) {
          setError('Password does not meet requirements');
          setLoading(false);
          return;
        }
        const data = await signUp(email, password, {
          first_name: firstName,
          last_name: lastName,
          full_name: `${firstName} ${lastName}`
        }, captchaToken);
        if (data?.session) {
          // Email confirmation is disabled server-side — the user is already
          // signed in, so there's no confirmation email to wait for.
          onClose();
        } else {
          // Stay on a persistent "check your email" panel instead of dropping
          // the user into the app unconfirmed. signUp already sent the first
          // confirmation email, so the resend cooldown starts now.
          setMode('confirm');
          setResendLastSentAt(Date.now());
        }
      } else if (mode === 'sso') {
        await signInWithSSO(ssoDomain);
        // SSO will redirect, so no need to close modal
      } else if (mode === 'reset') {
        await resetPassword(email, captchaToken);
        setMessage('Password reset link sent! Check your email.');
        setTimeout(() => {
          setMode('login');
          setMessage('');
        }, 3000);
      }
    } catch (err) {
      const msg = err.message || 'An error occurred';
      // Turnstile tokens are single-use; a failed attempt burns this one, so
      // always issue a fresh widget before the user retries.
      if (captchaMode) resetCaptcha();
      setError(/captcha|verification|human/i.test(msg)
        ? 'Verification failed — please redo the "I\'m human" check and try again.'
        : msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const result = await signInWithGoogle();
      // OAuth will redirect - if we get a URL, it means we need to navigate
      if (result?.url) {
        // In Electron, the navigation is handled by the main process
        // Just wait a moment for the redirect to happen
        // Don't set loading to false - let the redirect happen
        // The modal will close when auth state changes
      } else {
        // No redirect URL means it might have completed immediately (unlikely for OAuth)
        setLoading(false);
      }
    } catch (err) {
      console.error('Google sign-in error:', err);
      setError(err.message || 'Failed to sign in with Google. Please try again.');
      setLoading(false);
    }
  };

  const handleResendConfirmation = async () => {
    setError('');
    setMessage('');
    setLoading(true);
    try {
      await resendConfirmation(email);
      setResendLastSentAt(Date.now());
      setMessage('Confirmation email sent! Check your inbox.');
    } catch (err) {
      setError(err.message || 'Failed to resend confirmation email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-modal-overlay" onClick={handleClose}>
      <div
        className="auth-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="auth-modal-close" onClick={handleClose} aria-label="Close">
          <Icon name="close" size={18} />
        </button>

        <div className="auth-modal-header">
          <h2
            id="auth-modal-title"
            tabIndex={focusTitleFirst ? -1 : undefined}
            data-autofocus={focusTitleFirst ? '' : undefined}
          >
            {mode === 'login' && 'Welcome back'}
            {mode === 'signup' && 'Create account'}
            {mode === 'confirm' && 'Check your email'}
            {mode === 'sso' && 'Company sign-in'}
            {mode === 'reset' && 'Reset password'}
          </h2>
          <p className="auth-modal-subtitle">
            {mode === 'login' && 'Sign in to save and sync your work'}
            {mode === 'signup' && 'Get started with a free account'}
            {mode === 'confirm' && 'Verify your account to finish signing up'}
            {mode === 'sso' && 'Sign in with your company credentials'}
            {mode === 'reset' && 'We\'ll send you a password reset link'}
          </p>
        </div>

        {error && <div className="auth-error">{error}</div>}
        {message && <div className="auth-message">{message}</div>}

        {mode === 'confirm' && (
          <div className="auth-form">
            <p style={{ fontSize: '14px', lineHeight: 1.5, margin: '0 0 12px' }}>
              We sent a confirmation link to <strong>{email}</strong>.
              Click the link in that email to verify your account, then sign in.
            </p>
            <button
              type="button"
              className="auth-submit-btn"
              onClick={handleResendConfirmation}
              disabled={loading || resendRemaining > 0}
            >
              {loading
                ? 'Please wait...'
                : resendRemaining > 0
                  ? `Resend available in ${resendRemaining}s`
                  : 'Resend confirmation email'}
            </button>
          </div>
        )}

        {mode !== 'confirm' && (
        <form onSubmit={handleSubmit} className="auth-form" autoComplete="on">
          {mode !== 'sso' && (
            <div className="auth-form-group">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                name="username"
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                disabled={loading}
              />
            </div>
          )}

          {mode === 'signup' && (
            <>
              <div className="auth-form-group">
                <label htmlFor="firstName">First name</label>
                <input
                  id="firstName"
                  type="text"
                  name="given-name"
                  autoComplete="given-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="John"
                  required
                  disabled={loading}
                />
              </div>

              <div className="auth-form-group">
                <label htmlFor="lastName">Last name</label>
                <input
                  id="lastName"
                  type="text"
                  name="family-name"
                  autoComplete="family-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Doe"
                  required
                  disabled={loading}
                />
              </div>
            </>
          )}

          {(mode === 'login' || mode === 'signup') && (
            <div className="auth-form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                name="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                disabled={loading}
              />
              {mode === 'signup' && (
                <div style={{ marginTop: 6 }}>
                  <PasswordRequirements password={password} email={email} firstName={firstName} lastName={lastName} />
                </div>
              )}
            </div>
          )}

          {mode === 'signup' && (
            <div className="auth-form-group">
              <label htmlFor="confirmPassword">Confirm password</label>
              <input
                id="confirmPassword"
                type="password"
                name="confirm-password"
                autoComplete="new-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
                disabled={loading}
              />
            </div>
          )}

          {mode === 'sso' && (
            <div className="auth-form-group">
              <label htmlFor="ssoDomain">Company domain</label>
              <input
                id="ssoDomain"
                type="text"
                value={ssoDomain}
                onChange={(e) => setSsoDomain(e.target.value)}
                placeholder="company.com"
                required
                disabled={loading}
              />
            </div>
          )}

          {captchaMode && (
            <TurnstileWidget
              key={captchaNonce}
              onToken={setCaptchaToken}
              onError={() => setCaptchaBroken(true)}
              action={mode}
            />
          )}

          {/* UX (KAL-73): auth round-trips routinely exceed 500ms, so the button
              shows the shared loading treatment — a 14px ring left of the label
              and the label in its present-participle form, so the user reads
              which action is in flight rather than a generic "Please wait". */}
          <button type="submit" className="auth-submit-btn" disabled={loading}>
            {loading && <Spinner size={14} color="var(--accent-text)" trackColor="rgba(21,17,10,0.25)" style={{ marginRight: 8 }} />}
            {loading
              ? (mode === 'login' ? 'Signing in…' : mode === 'signup' ? 'Creating account…' : mode === 'sso' ? 'Continuing…' : 'Sending link…')
              : (mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : mode === 'sso' ? 'Continue with SSO' : 'Send reset link')}
          </button>
        </form>
        )}

        {mode === 'login' && (
          <>
            <div className="auth-divider">
              <span>or</span>
            </div>

            <button
              type="button"
              className="auth-google-btn"
              onClick={handleGoogleSignIn}
              disabled={loading}
            >
              <Icon name="google" size={18} />
              Continue with Google
            </button>

            <button
              type="button"
              className="auth-sso-link"
              onClick={() => setMode('sso')}
              disabled={loading}
            >
              Sign in with company SSO (enterprise)
            </button>
          </>
        )}

        <div className="auth-footer">
          {mode === 'login' && (
            <>
              <p>
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('signup');
                    setError('');
                  }}
                  className="auth-link-btn"
                >
                  Create an account
                </button>
              </p>
              <button
                type="button"
                onClick={() => {
                  setMode('reset');
                  setError('');
                }}
                className="auth-link-btn"
              >
                Forgot password?
              </button>
            </>
          )}

          {mode === 'signup' && (
            <p>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError('');
                }}
                className="auth-link-btn"
              >
                Sign in
              </button>
            </p>
          )}

          {mode === 'confirm' && (
            <>
              <p>
                Wrong address?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('signup');
                    setEmail('');
                    setPassword('');
                    setConfirmPassword('');
                    setError('');
                    setMessage('');
                  }}
                  className="auth-link-btn"
                >
                  Use a different email
                </button>
              </p>
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError('');
                  setMessage('');
                }}
                className="auth-link-btn"
              >
                ← Back to sign in
              </button>
            </>
          )}

          {(mode === 'sso' || mode === 'reset') && (
            <p>
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError('');
                  setMessage('');
                }}
                className="auth-link-btn"
              >
                ← Back to sign in
              </button>
            </p>
          )}
        </div>

        {onDismiss && (
          <div className="auth-dismiss">
            <button type="button" onClick={onDismiss} className="auth-dismiss-btn">
              Continue without an account
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
