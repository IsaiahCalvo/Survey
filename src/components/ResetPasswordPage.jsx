/* Account-flow: `/reset-password` landing page for Supabase recovery links.
 *
 * AuthContext.resetPassword() emails a link that redirects here. supabase-js
 * (detectSessionInUrl: true) exchanges the link's code for a session during
 * client boot, so this page just waits for the AuthProvider to finish booting
 * and derives its phase from whether a session materialized:
 *   checking  → validating the link / waiting for the recovery session.
 *   ready     → session present; show new-password + confirm form.
 *   success   → password updated; "Back to Survey" CTA.
 *   invalid   → no session (expired/used/mistyped link); offer to email a
 *               fresh link via resetPassword().
 *   link-sent → fresh reset link sent.
 *
 * All supabase.auth traffic goes through AuthContext (updatePassword /
 * resetPassword) — this page never imports the client directly. Card styling
 * mirrors src/home/InviteAcceptPage.jsx.
 */
import { useContext, useEffect, useState } from 'react';
import { AuthContext } from '../contexts/AuthContext';
import { RECOVERY_SESSION_GRACE_MS, resolveRecoveryPhase, validateNewPassword } from './authFlow';
import PasswordRequirements from './PasswordRequirements';
import TurnstileWidget, { TURNSTILE_ENABLED } from './TurnstileWidget';

const C = {
  bg: 'var(--surface-1)',
  card: 'var(--surface-2)',
  rule: 'var(--border)',
  ink: 'var(--text-1)',
  inkSoft: 'var(--text-2)',
  muted: 'var(--text-3)',
  gold: 'var(--accent)',
  danger: 'var(--danger)',
  good: 'var(--accent)',
};

function goHome() {
  if (typeof window !== 'undefined') window.location.assign('/');
}

export default function ResetPasswordPage() {
  const auth = useContext(AuthContext) || {};
  const { session, loading, updatePassword, resetPassword } = auth;

  const [phase, setPhase] = useState('checking'); // checking | ready | success | invalid | link-sent
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resendEmail, setResendEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [graceElapsed, setGraceElapsed] = useState(false);
  // Cloudflare Turnstile — the "request a new link" call hits /recover, a
  // captcha-protected endpoint. Set-new-password (updateUser) is not gated.
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaNonce, setCaptchaNonce] = useState(0);
  const [captchaBroken, setCaptchaBroken] = useState(false);

  // Start the grace clock only once the AuthProvider finished booting — the
  // boot itself (which performs the URL code exchange) can take arbitrarily
  // long on a cold connection.
  useEffect(() => {
    if (loading || graceElapsed) return undefined;
    const timer = setTimeout(() => setGraceElapsed(true), RECOVERY_SESSION_GRACE_MS);
    return () => clearTimeout(timer);
  }, [loading, graceElapsed]);

  // Derive checking → ready | invalid. Only ever moves forward out of
  // 'checking' so a submit-side phase (success / link-sent) is never clobbered
  // by a late auth event.
  useEffect(() => {
    const next = resolveRecoveryPhase({
      hasSession: !!session,
      bootFinished: !loading,
      graceElapsed,
    });
    if (next !== 'checking') {
      setPhase((prev) => (prev === 'checking' ? next : prev));
    }
  }, [session, loading, graceElapsed]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationError = validateNewPassword(password, confirmPassword, { email: session?.user?.email });
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await updatePassword(password);
      setPhase('success');
    } catch (err) {
      setError(err?.message || 'Failed to update password');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestNewLink = async (e) => {
    e.preventDefault();
    if (!resendEmail) {
      setError('Enter your email address to request a new link');
      return;
    }
    if (TURNSTILE_ENABLED && !captchaToken && !captchaBroken) {
      setError('Please complete the "I\'m human" check below, then try again.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await resetPassword(resendEmail, captchaToken);
      setPhase('link-sent');
    } catch (err) {
      setCaptchaToken(''); setCaptchaNonce((n) => n + 1); // single-use token spent
      const rmsg = (err?.message || '').toLowerCase();
      setError(/captcha|verification|human/.test(rmsg)
        ? 'Verification failed — please redo the "I\'m human" check and try again.'
        : (err?.message || 'Failed to send a new reset link'));
    } finally {
      setSubmitting(false);
    }
  };

  const heading = (() => {
    switch (phase) {
      case 'checking': return 'Checking your reset link…';
      case 'ready': return 'Choose a new password';
      case 'success': return 'Password updated';
      case 'link-sent': return 'New link sent';
      case 'invalid':
      default: return 'This reset link is no longer valid';
    }
  })();

  const description = (() => {
    switch (phase) {
      case 'checking': return 'Validating your password reset link. One moment…';
      case 'ready': return `Set a new password${session?.user?.email ? ` for ${session.user.email}` : ''}. You'll stay signed in after saving.`;
      case 'success': return 'Your password has been changed. Use it the next time you sign in.';
      case 'link-sent': return `If an account exists for ${resendEmail}, a fresh reset link is on its way. Check your email.`;
      case 'invalid':
      default: return 'The link may have expired or already been used. Enter your email and we\'ll send you a new one.';
    }
  })();

  const accent = (() => {
    if (phase === 'success' || phase === 'link-sent') return C.good;
    if (phase === 'invalid') return C.danger;
    return C.gold;
  })();

  return (
    <div
      data-reset-password-page="true"
      style={{
        position: 'fixed', inset: 0, background: C.bg, color: C.ink,
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div
        style={{
          width: 460, maxWidth: '94vw', background: C.card,
          border: `1px solid ${C.rule}`, borderRadius: 12,
          boxShadow: '0 24px 60px rgba(0,0,0,0.55)', overflow: 'hidden',
        }}
        data-reset-password-phase={phase}
      >
        <div style={{ padding: '20px 22px 14px', borderBottom: `1px solid ${C.rule}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 4, height: 32, background: accent, borderRadius: 2, flex: 'none' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.muted, fontWeight: 700 }}>Survey · Reset Password</div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.015em', marginTop: 4 }}>{heading}</div>
          </div>
        </div>

        <div style={{ padding: '18px 22px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ color: C.inkSoft, fontSize: 13, lineHeight: 1.5 }}>{description}</div>

          {error && (
            <div style={{ background: 'var(--danger-soft)', borderLeft: `3px solid ${C.danger}`, borderRadius: 8, padding: '8px 10px', color: C.ink, fontSize: 12 }}>
              {error}
            </div>
          )}

          {phase === 'ready' && (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={labelStyle()}>
                New password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  disabled={submitting}
                  autoFocus
                  style={inputStyle()}
                />
              </label>
              <PasswordRequirements password={password} email={session?.user?.email} theme={C} />
              <label style={labelStyle()}>
                Confirm new password
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  disabled={submitting}
                  style={inputStyle()}
                />
              </label>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="submit" disabled={submitting} style={btnPrimary(accent)}>
                  {submitting ? 'Saving…' : 'Set new password'}
                </button>
                <button type="button" onClick={goHome} disabled={submitting} style={btnGhost()}>Cancel</button>
              </div>
            </form>
          )}

          {phase === 'invalid' && (
            <form onSubmit={handleRequestNewLink} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={labelStyle()}>
                Email
                <input
                  type="email"
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  disabled={submitting}
                  style={inputStyle()}
                />
              </label>
              {TURNSTILE_ENABLED && (
                <TurnstileWidget
                  key={captchaNonce}
                  onToken={setCaptchaToken}
                  onError={() => setCaptchaBroken(true)}
                  action="recover"
                />
              )}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="submit" disabled={submitting} style={btnPrimary(accent)}>
                  {submitting ? 'Sending…' : 'Request a new link'}
                </button>
                <button type="button" onClick={goHome} disabled={submitting} style={btnGhost()}>Back to Survey</button>
              </div>
            </form>
          )}

          {(phase === 'success' || phase === 'link-sent') && (
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
              <button onClick={goHome} style={btnPrimary(accent)}>Back to Survey</button>
            </div>
          )}

          {phase === 'checking' && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <span style={{ color: C.muted, fontSize: 12 }}>Loading…</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function labelStyle() {
  return {
    display: 'flex', flexDirection: 'column', gap: 6,
    color: C.muted, fontSize: 11.5, fontWeight: 600,
    letterSpacing: '0.06em', textTransform: 'uppercase',
  };
}

function inputStyle() {
  return {
    background: C.bg, color: C.ink, border: `1px solid ${C.rule}`,
    borderRadius: 6, padding: '8px 10px', fontSize: 13,
    fontFamily: 'inherit', outline: 'none',
  };
}

function btnPrimary(color) {
  return {
    background: color, color: 'var(--accent-text)', border: 0, borderRadius: 6,
    padding: '6px 14px', height: 30, fontSize: 12, fontWeight: 700, cursor: 'pointer',
    fontFamily: 'inherit',
  };
}

function btnGhost() {
  return {
    background: 'transparent', color: C.ink, border: `1px solid ${C.rule}`,
    borderRadius: 6, padding: '6px 12px', height: 30, fontSize: 12, fontWeight: 500,
    cursor: 'pointer', fontFamily: 'inherit',
  };
}
