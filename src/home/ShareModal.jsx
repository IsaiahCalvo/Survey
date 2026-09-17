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
 *   - kind='project' and kind='template' route to project_invites /
 *     template_invites and their kal31_* RPCs (migration 20260701120000) —
 *     same token shape, same /invite/<token> URL space, same tier gate.
 *
 * UI structure is preserved from the approved design — do not redesign.
 */
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AuthContext } from '../contexts/AuthContext';
import { createDocumentInvite, buildInviteUrl } from '../services/documentInviteService';
import { createProjectInvite } from '../services/projectInviteService';
import { createTemplateInvite } from '../services/templateInviteService';
import { copyTextToClipboard } from '../utils/clipboard';
import { closeButtonStyle } from './hubControls';
import { Icon } from './HubShell';
import Spinner from '../components/Spinner';
import useModalFocusTrap from './useModalFocusTrap';

const C = {
  scrim: 'rgba(13,15,20,0.55)',
  card: 'var(--surface-2)',
  deep: 'var(--surface-1)',
  rule: 'var(--border)',
  ink: 'var(--text-1)',
  inkSoft: 'var(--text-2)',
  muted: 'var(--text-3)',
  gold: 'var(--accent)',
  danger: 'var(--danger)',
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
  const dialogRef = useRef(null);
  const closeRef = useRef(null);

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

  useModalFocusTrap({
    active: open,
    containerRef: dialogRef,
    initialFocusRef: closeRef,
    onClose,
  });

  const noun = KIND_LABEL[kind] || 'item';
  const targetId = useMemo(() => {
    if (!item) return null;
    return item.id || item.document_id || item.documentId || null;
  }, [item]);

  // Route the invite mint to the right backend by kind. All three share the
  // same token shape, RPC contract, and /invite/<token> URL space.
  const mintInvite = (email) => {
    const common = {
      role: role.toLowerCase(),
      email,
      currentUser,
      inviterName: currentUser?.user_metadata?.full_name || currentUser?.email || null,
    };
    if (kind === 'project') {
      return createProjectInvite({ projectId: targetId, projectName: name || '', ...common });
    }
    if (kind === 'template') {
      return createTemplateInvite({ templateId: targetId, templateName: name || '', ...common });
    }
    return createDocumentInvite({ documentId: targetId, documentName: name || '', ...common });
  };

  // Honest placeholder until a real token is minted — never show a fake URL
  // that differs from what "Copy link" actually copies.
  const linkText = activeInvite
    ? buildInviteUrl(activeInvite)
    : `Press Copy link to create a secure ${role.toLowerCase()} link`;

  if (!open) return null;

  const blockedReason = !canInvite
    ? 'Free plan accounts cannot create invite links. Upgrade to Pro or higher to share.'
    : (!targetId
        ? `This share dialog needs a target ${noun} id. Select the ${noun} and share from there.`
        : '');

  const explicitLinkText = `Anyone with this invite link can join as ${role.toLowerCase()}.`;
  const freeNote = ' Free recipients enter as viewer until they upgrade.';

  const copyLink = async () => {
    setError(''); setSuccess('');
    if (blockedReason) { setError(blockedReason); return; }
    setBusy(true);
    const res = await mintInvite(null); // link-only
    setBusy(false);
    if (!res.success) { setError(res.error || 'Could not create invite link.'); return; }
    setActiveInvite(res.invite);
    const url = buildInviteUrl(res.invite);
    const copyResult = await copyTextToClipboard(url, { surface: `${kind}_share_link` });
    if (!copyResult.ok) {
      setError('Invite link created, but Survey could not copy it. Select the link and copy it manually.');
      return;
    }
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
    const results = await Promise.all(list.map((addr) => mintInvite(addr)));
    setBusy(false);
    const failed = results.filter((r) => !r.success);
    if (failed.length) {
      setError(`Sent ${results.length - failed.length} of ${results.length}. First failure: ${failed[0].error || 'unknown'}.`);
    } else {
      setSuccess(`Sent ${results.length} ${role.toLowerCase()} share email${results.length === 1 ? '' : 's'}.`);
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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Share ${noun}`}
        data-modal-focus-layer="true"
        tabIndex={-1}
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
          <button ref={closeRef} onClick={onClose} title="Close" aria-label="Close" style={closeButtonStyle({ borderColor: C.rule, color: C.muted })}><Icon name="close" size={13} /></button>
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
            <div style={{ fontSize: 11, color: C.muted, marginTop: 8, lineHeight: 1.4 }}>Separate addresses with commas. New users get an invite link; existing users get a direct-access link as {role.toLowerCase()}.</div>
          </div>

          {blockedReason && (
            <div style={{ background: 'rgba(217, 90, 86, 0.10)', borderLeft: `3px solid ${C.danger}`, borderRadius: 8, padding: '8px 10px', color: C.ink, fontSize: 11.5 }}>
              {blockedReason}
            </div>
          )}
          {error && !blockedReason && (
            <div style={{ background: 'rgba(217, 90, 86, 0.10)', borderLeft: `3px solid ${C.danger}`, borderRadius: 8, padding: '8px 10px', color: C.ink, fontSize: 11.5 }}>
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
            style={{ opacity: busy || !emails.trim() || blockedReason ? 0.45 : 1, cursor: busy ? 'progress' : (!emails.trim() || blockedReason ? 'not-allowed' : 'pointer'), background: C.gold, color: 'var(--accent-text)', border: 0, borderRadius: 6, padding: '5px 14px', height: 28, fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            {/* UX (KAL-73): sending an invite is a network round-trip well over
                500ms, so it takes the shared button loading treatment — 14px ring
                on the left, label in its present-participle form, stays disabled. */}
            {busy && <Spinner size={14} color="var(--accent-text)" trackColor="rgba(21,17,10,0.25)" />}
            {busy ? 'Sending invite…' : `Send ${role.toLowerCase()} invite`}
          </button>
        </div>
      </div>
    </div>
  );
}
