// Opening a guest link (Nightly, flag 'guest-links'): /?guest=<secret>.
// Someone with no account types a name and agrees to the terms; Survey signs
// them in as an anonymous guest (a Turnstile check first, as for any sign-in)
// and opens the shared document. Someone already signed in just opens it.
// While a guest, a small badge says so and offers to leave.
import { useEffect, useRef, useState } from 'react';
import TurnstileWidget, { TURNSTILE_ENABLED } from '../components/TurnstileWidget';
import { GUEST_NAME_MAX, GUEST_LINK_PARAM, cleanGuestName, redeemGuestLink } from '../services/guestLinks.js';
import './guestLinks.css';

function openDocument(documentId) {
  const url = new URL(window.location.href);
  url.searchParams.delete(GUEST_LINK_PARAM);
  url.searchParams.set('docId', documentId);
  window.location.replace(`${url.pathname}${url.search}${url.hash}`);
}

function dropToken() {
  const url = new URL(window.location.href);
  url.searchParams.delete(GUEST_LINK_PARAM);
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

export default function GuestLinkGate({ client, token, user, authReady, onSignIn }) {
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaNonce, setCaptchaNonce] = useState(0);
  const [captchaBroken, setCaptchaBroken] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const redeemed = useRef(false);

  // Already signed in (an account, or a guest from before): open it straight away.
  useEffect(() => {
    if (!token || !authReady || !user || redeemed.current) return;
    redeemed.current = true;
    const label = cleanGuestName(user.user_metadata?.full_name || user.user_metadata?.name || (user.email || '').split('@')[0] || 'Guest') || 'Guest';
    redeemGuestLink(client, { token, name: label })
      .then((row) => openDocument(row.documentId))
      .catch((err) => { redeemed.current = false; setError(err.message); setDismissed(false); });
  }, [client, token, user, authReady]);

  if (!token || dismissed || !authReady || (user && !error)) return null;

  const join = async (event) => {
    event.preventDefault();
    const clean = cleanGuestName(name);
    if (!clean) { setError('Type your name so others know who you are.'); return; }
    if (!agreed) { setError('Agree to the terms to go on.'); return; }
    if (TURNSTILE_ENABLED && !captchaToken && !captchaBroken) { setError('One moment: finishing the check that you are a person.'); return; }
    setBusy(true);
    setError('');
    try {
      redeemed.current = true;
      const { error: signInError } = await client.auth.signInAnonymously({
        options: { data: { full_name: clean, guest: true }, ...(captchaToken ? { captchaToken } : {}) },
      });
      if (signInError) throw new Error(signInError.message);
      const row = await redeemGuestLink(client, { token, name: clean });
      openDocument(row.documentId);
    } catch (err) {
      redeemed.current = false;
      setError(err.message || 'Could not open the guest link');
      setCaptchaToken('');
      setCaptchaNonce((n) => n + 1);
      setBusy(false);
    }
  };

  return (
    <div className="guest-join" data-testid="guest-join">
      <form className="guest-join__card" role="dialog" aria-modal="true" aria-labelledby="guest-join-title" onSubmit={join}>
        <h2 id="guest-join-title" className="guest-join__title">You're invited as a guest</h2>
        {user ? null : (
          <>
            <p className="guest-join__text">Someone shared a document with you. You don't need an account: type your name and you're in.</p>
            <label className="guest-join__field">
              Your name
              <input
                type="text"
                value={name}
                maxLength={GUEST_NAME_MAX}
                autoComplete="name"
                onChange={(e) => setName(e.target.value)}
                data-guest-name
                autoFocus
              />
            </label>
            <label className="guest-join__terms">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} data-guest-terms />
              <span>I agree to the <a href="/terms.html" target="_blank" rel="noreferrer">Terms</a> and the <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy notice</a>.</span>
            </label>
            {TURNSTILE_ENABLED ? (
              <TurnstileWidget key={captchaNonce} onToken={setCaptchaToken} onError={() => setCaptchaBroken(true)} action="guest" />
            ) : null}
          </>
        )}
        {error ? <div className="guest-join__error" role="alert">{error}</div> : null}
        <div className="guest-join__actions">
          {/* An account holder signs in; the link then opens for that account. */}
          <button type="button" className="hub-btn" onClick={() => { setDismissed(true); if (user) dropToken(); else onSignIn?.(); }}>
            {user ? 'Close' : 'I have an account'}
          </button>
          {user ? null : (
            <button type="submit" className="hub-btn hub-btn--primary" disabled={busy} data-guest-join>
              {busy ? 'Opening…' : 'Join as guest'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/** Shown to a signed-in guest: who they are here, and a way out. */
export function GuestBadge({ user, onLeave }) {
  if (!user?.is_anonymous) return null;
  const name = user.user_metadata?.full_name || 'Guest';
  return (
    <div className="guest-badge" data-testid="guest-badge">
      <span>Guest: {name}</span>
      <button type="button" className="hub-btn" onClick={onLeave}>Leave</button>
    </div>
  );
}
