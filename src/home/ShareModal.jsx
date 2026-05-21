/* Survey Hub — Share / Invite popup (KAL-31).
 *
 * Locked product spec (see KAL-31 Linear comment 2026-05-21 17:00 + doc 9164fae3):
 *   - Roles are exactly Viewer | Editor | Owner. Default is Viewer.
 *   - One role selector controls BOTH the link role and the email role
 *     (per "Final locked permission preferences"). The displayed sentence
 *     explicitly names the effective role: "Anyone with this invite link can
 *     join as <Role>".
 *   - Only owners may create invites.
 *   - Free-tier users cannot create invite emails or invite links — block before
 *     send with a clear upgrade prompt.
 *   - Invite link/email creation hits the backend (`document_invites` table +
 *     `kal31_*` RPCs from migration 20260521000100). Real Resend email delivery
 *     is wired in Phase C.
 *
 * UI structure is preserved from the approved design — do not redesign.
 */
import React, { useContext, useEffect, useMemo, useState } from 'react';
import { AuthContext } from '../contexts/AuthContext';
import { createDocumentInvite, buildInviteUrl } from '../services/documentInviteService';

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

const KIND_LABEL = { document: 'document', project: 'project', template: 'template' };
const ROLE_OPTIONS = ['Viewer', 'Editor', 'Owner'];

const PAID_TIERS = new Set(['pro', 'enterprise', 'developer']);

function parseEmails(raw) {
  return (raw || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
}

export default function ShareModal({
  open,
  onClose,
  kind = 'project',
  name = '',
  item = null,
}) {
  // Tolerant of missing provider — direct context read so tests/standalone
  // renders don't throw the way `useAuth` does.
  const auth = useContext(AuthContext) || {};
  const currentUser = auth?.user || null;
  const tier = (auth?.tier || auth?.plan || 'free').toLowerCase();
  const canInvite = PAID_TIERS.has(tier);

  // Locked spec: single role selector, default Viewer.
  const [role, setRole] = useState('Viewer');
  const [emails, setEmails] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeInvite, setActiveInvite] = useState(null); // last link-invite for share-link display

  useEffect(() => {
    if (!open) {
      setRole('Viewer');
      setEmails('');
      setError('');
      setSuccess('');
      setActiveInvite(null);
      setCopied(false);
      setBusy(false);
    }
  }, [open]);

  const noun = KIND_LABEL[kind] || 'item';
  const documentId = useMemo(() => {
    if (!item) return null;
    return item.id || item.document_id || item.documentId || null;
  }, [item]);

  // Fallback display link (no backend round-trip yet) — replaced as soon as the
  // user clicks "Copy link" and we mint a real token.
  const previewSlug = (name || noun).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || noun;
  const linkText = activeInvite
    ? buildInviteUrl(activeInvite)
    : `survey.app/${noun}/${previewSlug}?role=${role.toLowerCase()}`;

  if (!open) return null;

  const blockedReason = !canInvite
    ? 'Free plan accounts cannot create invite links. Upgrade to Pro or higher to share.'
    : (kind !== 'document'
        ? `Sharing for ${noun}s is rolling out in a follow-up — Phase A ships document sharing only.`
        : (!documentId
            ? 'This share dialog needs a target document id. Open the document and share from there.'
            : ''));

  const explicitLinkText = `Anyone with this invite link can join as ${role}.`;
  const freeNote = ' Free recipients enter as Viewer until they upgrade.';

  const copyLink = async () => {
    setError(''); setSuccess('');
    if (blockedReason) { setError(blockedReason); return; }
    setBusy(true);
    const res = await createDocumentInvite({
      documentId,
      role: role.toLowerCase(),
      email: null, // link-only
      currentUser,
    });
    setBusy(false);
    if (!res.success) { setError(res.error || 'Could not create invite link.'); return; }
    setActiveInvite(res.invite);
    const url = buildInviteUrl(res.invite);
    try { await navigator.clipboard.writeText(url); } catch { /* clipboard unavailable */ }
    setCopied(true);
    setSuccess(`Link copied. ${explicitLinkText}`);
    setTimeout(() => setCopied(false), 1800);
  };

  const sendInvite = async () => {
    setError(''); setSuccess('');
    if (blockedReason) { setError(blockedReason); return; }
    const list = parseEmails(emails);
    if (!list.length) { setError('Enter at least one valid email.'); return; }
    setBusy(true);
    const results = await Promise.all(list.map((addr) =>
      createDocumentInvite({
        documentId,
        role: role.toLowerCase(),
        email: addr,
        currentUser,
      })));
    setBusy(false);
    const failed = results.filter((r) => !r.success);
    if (failed.length) {
      setError(`Sent ${results.length - failed.length} of ${results.length}. First failure: ${failed[0].error || 'unknown'}.`);
    } else {
      setSuccess(`Sent ${results.length} ${role} invite${results.length === 1 ? '' : 's'}. (Email delivery wires through Phase C; tokens are live.)`);
      setEmails('');
    }
  };

  const fieldLabel = { fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.muted, fontWeight: 700, marginBottom: 8 };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: C.scrim,
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1300,
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 440, maxWidth: '92vw', background: C.card, border: `1px solid ${C.rule}`, borderRadius: 10, boxShadow: '0 24px 60px rgba(0,0,0,0.55)', color: C.ink, overflow: 'hidden' }}
      >
        {/* Header */}
        <div style={{ padding: '16px 18px 14px', borderBottom: `1px solid ${C.rule}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 3, height: 30, background: C.gold, borderRadius: 2, flex: 'none' }}></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.muted, fontWeight: 700 }}>Share {noun}</div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.015em', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name || 'Untitled'}</div>
          </div>
          <button onClick={onClose} title="Close" style={{ background: 'transparent', border: `1px solid ${C.rule}`, color: C.muted, width: 24, height: 24, borderRadius: 6, cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0, display: 'grid', placeItems: 'center', fontFamily: 'inherit', flex: 'none' }}>×</button>
        </div>

        {/* Single role selector — applies to both link and email per locked spec. */}
        <div style={{ padding: '14px 18px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={fieldLabel}>Permission</div>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            style={{ height: 30, background: C.card, color: C.ink, border: `1px solid ${C.rule}`, borderRadius: 6, padding: '0 10px', fontSize: 12, fontFamily: 'inherit', marginBottom: 8 }}
          >
            {ROLE_OPTIONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>

        {/* Body */}
        <div style={{ padding: '4px 18px 16px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <div style={fieldLabel}>Invite link</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 82px', gap: 6 }}>
              <div style={{ flex: 1, minWidth: 0, background: C.deep, border: `1px solid ${C.rule}`, borderRadius: 6, padding: '0 11px', height: 30, display: 'flex', alignItems: 'center', fontSize: 11.5, color: C.inkSoft, fontFamily: 'ui-monospace, Menlo, monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{linkText}</div>
              <button onClick={copyLink} disabled={busy || !!blockedReason} style={{ flex: 'none', height: 30, whiteSpace: 'nowrap', background: C.card, color: C.ink, border: `1px solid ${C.rule}`, borderRadius: 6, padding: '0 11px', fontSize: 11.5, cursor: busy || blockedReason ? 'not-allowed' : 'pointer', opacity: busy || blockedReason ? 0.5 : 1, fontFamily: 'inherit', boxSizing: 'border-box' }}>{copied ? 'Copied' : 'Copy link'}</button>
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 8, lineHeight: 1.4 }}>{explicitLinkText}{freeNote}</div>
          </div>

          <div>
            <div style={fieldLabel}>Invite by email</div>
            <textarea
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder="name@example.com, name@example.com"
              rows={3}
              style={{ width: '100%', background: C.deep, border: `1px solid ${C.rule}`, borderRadius: 6, padding: '9px 11px', fontSize: 12.5, fontFamily: 'inherit', color: C.ink, resize: 'vertical', outline: 'none', minHeight: 72, lineHeight: 1.45, boxSizing: 'border-box' }}
            />
            <div style={{ fontSize: 11, color: C.muted, marginTop: 8, lineHeight: 1.4 }}>Separate addresses with commas. Each invitee gets an email with a link to join as {role}.</div>
          </div>

          {blockedReason && (
            <div style={{ background: 'rgba(207,111,111,0.10)', border: `1px solid ${C.danger}`, borderRadius: 6, padding: '8px 10px', color: C.danger, fontSize: 11.5 }}>
              {blockedReason}
            </div>
          )}
          {error && !blockedReason && (
            <div style={{ background: 'rgba(207,111,111,0.10)', border: `1px solid ${C.danger}`, borderRadius: 6, padding: '8px 10px', color: C.danger, fontSize: 11.5 }}>
              {error}
            </div>
          )}
          {success && (
            <div style={{ background: 'rgba(216,168,78,0.10)', border: `1px solid ${C.gold}`, borderRadius: 6, padding: '8px 10px', color: C.gold, fontSize: 11.5 }}>
              {success}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.rule}`, background: C.deep, display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
          <button onClick={onClose} style={{ background: 'transparent', border: 0, color: C.muted, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', borderRadius: 6 }}>Cancel</button>
          <button
            disabled={busy || !emails.trim() || !!blockedReason}
            onClick={sendInvite}
            style={{ opacity: busy || !emails.trim() || blockedReason ? 0.45 : 1, cursor: busy || !emails.trim() || blockedReason ? 'not-allowed' : 'pointer', background: C.gold, color: '#15110a', border: 0, borderRadius: 6, padding: '5px 14px', height: 28, fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit' }}
          >
            {busy ? 'Sending…' : `Send ${role} invite`}
          </button>
        </div>
      </div>
    </div>
  );
}
