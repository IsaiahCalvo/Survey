/* KAL-31 — Phase D: Invite accept landing page.
 *
 * Renders the six branches required by the locked spec when a user opens
 * `/invite/:token`:
 *   1. valid          → "Open document" CTA; signed-in user already had access.
 *   2. accepted       → success, optional "Viewer (upgrade required)" banner.
 *   3. expired        → expired card.
 *   4. revoked        → revoked card.
 *   5. already_accepted → "You already have access" card.
 *   6. wrong_account  → "Switch account" card with sign-out CTA.
 *   7. invalid        → "Invite link looks invalid" card.
 *
 * Sign-in/sign-up gating: if the visitor is unauthenticated we show a
 * "Sign in to accept" card with a button that flips into the normal login
 * flow. We carry the token through localStorage so the user lands back on
 * the same invite after auth.
 *
 * Token resolution: document, project, and template invites all share the
 * /invite/<token> URL space. We try the document accept first; only a hard
 * 'invalid' falls through to project, then template (see acceptAnyInvite).
 */
import { useContext, useEffect, useState } from 'react';
import { AuthContext } from '../contexts/AuthContext';
import { acceptDocumentInvite } from '../services/documentInviteService';
import { acceptProjectInvite } from '../services/projectInviteService';
import { acceptTemplateInvite } from '../services/templateInviteService';
import { supabase } from '../supabaseClient';
import { buildAppDestination } from '../utils/accountPlatform';

const PENDING_KEY = 'kal31_pending_invite_token';

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

function getTokenFromPath() {
  if (typeof window === 'undefined') return null;
  const m = window.location.pathname.match(/\/invite\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function goHome() {
  if (typeof window !== 'undefined') {
    try { window.localStorage.removeItem(PENDING_KEY); } catch (_e) { /* ignore */ }
    window.location.assign(buildAppDestination());
  }
}

/* Resolve a token across all three invite kinds. Document, project, and
 * template invites share the /invite/<token> URL space, so we try document
 * first (the common case), and only on a hard 'invalid' fall through to
 * project, then template. Any non-invalid status (expired, revoked,
 * wrong_account, …) is a definitive answer for that kind — stop there. */
async function acceptAnyInvite(token) {
  const doc = await acceptDocumentInvite(token);
  if (doc.status !== 'invalid') return { ...doc, kind: 'document' };
  const proj = await acceptProjectInvite(token);
  if (proj.status !== 'invalid') return { ...proj, kind: 'project' };
  const tpl = await acceptTemplateInvite(token);
  if (tpl.status !== 'invalid') return { ...tpl, kind: 'template' };
  return { ...doc, status: 'invalid', kind: 'document' };
}

export default function InviteAcceptPage() {
  const auth = useContext(AuthContext) || {};
  const user = auth?.user || null;
  const [token] = useState(getTokenFromPath);
  const [phase, setPhase] = useState('loading'); // loading | needs-auth | result
  const [result, setResult] = useState(null); // { status, effectiveRole, intendedRole, upgradeRequired, documentId }
  const [error, setError] = useState('');

  // Persist token for round-trip through sign-in/sign-up.
  useEffect(() => {
    if (!token) return;
    try { window.localStorage.setItem(PENDING_KEY, token); } catch (_e) { /* ignore */ }
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setPhase('result');
        setResult({ status: 'invalid' });
        return;
      }
      if (!user) {
        setPhase('needs-auth');
        return;
      }
      setPhase('loading');
      try {
        const r = await acceptAnyInvite(token);
        if (cancelled) return;
        setResult(r);
        setPhase('result');
        if (r.status === 'accepted') {
          try { window.localStorage.removeItem(PENDING_KEY); } catch (_e) { /* ignore */ }
        }
      } catch (err) {
        if (cancelled) return;
        console.error('[KAL-31] InviteAcceptPage error:', err);
        setError(err?.message || String(err));
        setResult({ status: 'invalid' });
        setPhase('result');
      }
    })();
    return () => { cancelled = true; };
  }, [token, user?.id]); // re-run when user signs in

  const heading = (() => {
    if (phase === 'loading') return 'Checking invite…';
    if (phase === 'needs-auth') return 'Sign in to accept this invite';
    if (!result) return 'Invite';
    switch (result.status) {
      case 'accepted': return result.upgradeRequired ? 'Welcome — Viewer access granted' : 'Welcome!';
      case 'already_accepted': return 'You already accepted this invite';
      case 'wrong_account': return 'Wrong account';
      case 'expired': return 'This invite has expired';
      case 'revoked': return 'This invite was revoked';
      case 'invalid':
      default: return 'Invite link looks invalid';
    }
  })();

  // Which kind of thing the token resolved to — names the noun in the copy
  // and decides what "Open" does. Defaults to 'document' pre-resolution.
  const kindNoun = result?.kind || 'document';

  const description = (() => {
    if (phase === 'loading') return 'Validating your invite. One moment…';
    if (phase === 'needs-auth') return 'Sign in or create a free Survey account to accept this invite.';
    if (!result) return '';
    switch (result.status) {
      case 'accepted':
        if (result.upgradeRequired) {
          const intended = (result.intendedRole || 'editor').toLowerCase();
          return `You have Viewer access for now. Upgrade to Pro or higher to unlock ${intended.charAt(0).toUpperCase() + intended.slice(1)} access.`;
        }
        return `You now have ${(result.effectiveRole || 'viewer')} access to this ${kindNoun}.`;
      case 'already_accepted':
        return 'This invite was used previously. Your access is still active.';
      case 'wrong_account':
        return 'This invite was sent to a different email address. Sign out and sign back in with the invited email to accept.';
      case 'expired':
        return 'This invite expired. Ask the owner to send a new one.';
      case 'revoked':
        return 'The owner revoked this invite before you accepted it. Ask them for a new one if you need access.';
      case 'invalid':
      default:
        return 'We couldn\'t find that invite. The link may be mistyped or the invite was deleted.';
    }
  })();

  const accent = (() => {
    if (!result) return C.gold;
    if (result.status === 'accepted') return C.good;
    if (result.status === 'wrong_account' || result.status === 'expired' || result.status === 'revoked' || result.status === 'invalid') return C.danger;
    return C.gold;
  })();

  const openTarget = async () => {
    // Documents deep-open via ?docId=. Projects and templates land on the
    // hub root — the shared item is now visible there (simplest correct
    // behavior; no per-project/template deep link exists yet).
    if (kindNoun === 'document' && result?.documentId) {
      if (typeof window !== 'undefined') {
        // App.jsx reads ?docId= for direct-open. Fall back to home.
        window.location.assign(buildAppDestination({ params: { docId: result.documentId } }));
      }
      return;
    }
    goHome();
  };

  const openLabel = kindNoun === 'document' ? 'Open document' : 'Go to Survey';

  const switchAccount = async () => {
    try { await supabase.auth.signOut(); } catch (_e) { /* ignore */ }
    if (typeof window !== 'undefined') window.location.reload();
  };

  const signIn = () => {
    // Bounce to root with `?signIn=1`; AuthContext will pop the login UI.
    // If the app doesn't honor that query, simply reload so the AuthProvider
    // re-evaluates and the standard sign-in surface shows.
    if (typeof window !== 'undefined') {
      window.location.assign(buildAppDestination({ params: { signIn: '1', invite: token || '' } }));
    }
  };

  return (
    <div
      data-kal31-invite-page="true"
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
        data-kal31-status={result?.status || phase}
      >
        <div style={{ padding: '20px 22px 14px', borderBottom: `1px solid ${C.rule}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 4, height: 32, background: accent, borderRadius: 2, flex: 'none' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.muted, fontWeight: 700 }}>Survey · Invite</div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.015em', marginTop: 4 }}>{heading}</div>
          </div>
        </div>

        <div style={{ padding: '18px 22px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ color: C.inkSoft, fontSize: 13, lineHeight: 1.5 }}>{description}</div>

          {result?.status === 'accepted' && result.upgradeRequired && (
            <div style={{ background: 'var(--accent-soft)', border: `1px solid ${C.gold}`, borderRadius: 8, padding: '10px 12px', color: C.gold, fontSize: 12.5, lineHeight: 1.45 }}>
              Upgrade to use {(result.intendedRole || 'editor')} permissions. Your original role ({result.intendedRole}) is preserved and activates automatically after upgrade.
            </div>
          )}

          {error && (
            <div style={{ background: 'var(--danger-soft)', borderLeft: `3px solid ${C.danger}`, borderRadius: 8, padding: '8px 10px', color: C.ink, fontSize: 12 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            {phase === 'needs-auth' && (
              <button onClick={signIn} style={btnPrimary(accent)}>Sign in to continue</button>
            )}
            {phase === 'result' && (
              <>
                {result?.status === 'accepted' && (
                  <button onClick={openTarget} style={btnPrimary(accent)}>{openLabel}</button>
                )}
                {result?.status === 'already_accepted' && (
                  <button onClick={openTarget} style={btnPrimary(accent)}>{openLabel}</button>
                )}
                {result?.status === 'wrong_account' && (
                  <button onClick={switchAccount} style={btnPrimary(accent)}>Sign out and switch</button>
                )}
                <button onClick={goHome} style={btnGhost()}>Back to Survey</button>
              </>
            )}
            {phase === 'loading' && (
              <span style={{ color: C.muted, fontSize: 12 }}>Loading…</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
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
