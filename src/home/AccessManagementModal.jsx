/* KAL-31 Phase E — Manage Access modal (live behavior).
 *
 * Loads real collaborators + pending invites for a document, lets the owner
 * change a role, remove a collaborator, revoke a pending invite, or resend a
 * pending invite. Persists via documentAnnotationService + documentInviteService
 * and best-effort fires permission-changed / access-removed emails through
 * the Resend-backed `send-email` function.
 *
 * Locked spec (Linear comment 2026-05-21 16:59):
 *   - Only owners see / use this UI; the underlying RLS also enforces it.
 *   - Last owner cannot be demoted or removed — surfaced as inline error.
 *   - Pending invites show with `Pending` badge; revoke + resend available.
 *   - Active share links are listed grouped (link-only invites with no
 *     target_email).
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AuthContext } from '../contexts/AuthContext';
import ShareModal from './ShareModal';
import {
  getDocumentCollaborators,
  updateCollaboratorRole,
  removeDocumentCollaborator,
} from '../services/documentAnnotationService';
import {
  listDocumentInvites,
  revokeDocumentInvite,
  resendDocumentInvite,
  buildInviteUrl,
} from '../services/documentInviteService';
import {
  sendPermissionChangedEmail,
  sendAccessRemovedEmail,
} from '../services/shareEmailService';
import { copyTextToClipboard } from '../utils/clipboard';
import { closeButtonStyle } from './hubControls';
import { Icon } from './HubShell';

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

const ROLES = ['Owner', 'Editor', 'Viewer'];
const MONO_FONT = '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace';

/* Avatar colours for collaborators — the same identity palette and the same
   deterministic pick as ManageTeamModal and ProjectsFolderTree, so one person
   wears one colour everywhere. An owner keeps gold.
   UX 2026-09-17: every non-owner here used to be the SAME #5fbf83 green, which
   told you nothing about who they were and read as a status ("all good") in an
   app where green means synced. These colours are identity, never state. */
const COLLAB_COLORS = ['#5fbf83', '#7aa2f7', '#b48ead', '#8fbcbb', '#cf9f6f'];
const colorFor = (seed) => {
  const str = String(seed || '');
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return COLLAB_COLORS[hash % COLLAB_COLORS.length];
};

function roleLabel(role) {
  const r = String(role || '').toLowerCase();
  return r.charAt(0).toUpperCase() + r.slice(1);
}

function initialsOf(name) {
  return (name || '').trim().split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase() || '-';
}

function labelForKind(kind) {
  if (kind === 'template') return 'Template Access';
  if (kind === 'document') return 'Document Access';
  return 'Access';
}

export default function AccessManagementModal({ open, onClose, kind = 'document', item = null, user = null }) {
  const auth = useContext(AuthContext) || {};
  const currentUser = auth?.user || user || null;

  const documentId = useMemo(() => {
    if (!item) return null;
    return item.id || item.document_id || item.documentId || null;
  }, [item]);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [members, setMembers] = useState([]);   // real collaborator rows
  const [invites, setInvites] = useState([]);   // real invite rows
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [linksOpen, setLinksOpen] = useState(false);
  const previouslyFocusedRef = useRef(null);

  // Accessibility: Escape closes the modal, and focus returns to whatever
  // triggered it once it closes (minimal per-modal patch, no shared modal
  // primitive/focus trap). Skipped while the nested ShareModal (invite
  // popup) is open so Escape closes that one first.
  useEffect(() => {
    if (!open) return undefined;
    previouslyFocusedRef.current = document.activeElement;
    const handleKey = (e) => {
      if (e.key === 'Escape' && !inviteOpen) {
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
  }, [open, onClose, inviteOpen]);

  const refresh = useCallback(async () => {
    if (!documentId) { setMembers([]); setInvites([]); return; }
    setLoading(true);
    setError('');
    try {
      const [colRes, invRes] = await Promise.all([
        getDocumentCollaborators(documentId),
        listDocumentInvites(documentId),
      ]);
      setMembers(Array.isArray(colRes?.data) ? colRes.data : []);
      setInvites(Array.isArray(invRes?.data) ? invRes.data : []);
    } catch (err) {
      console.error('[KAL-31] AccessManagementModal load failed:', err);
      setError(err?.message || 'Could not load access list.');
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    if (!open) return;
    setStatus(''); setError('');
    refresh();
  }, [open, refresh]);

  const ownerCount = members.filter((m) => String(m.role).toLowerCase() === 'owner').length;
  const documentName = item?.name || item?.title || 'Untitled';
  const inviterName = currentUser?.user_metadata?.full_name || currentUser?.email || 'An owner';

  const handleRoleChange = async (member, newRole) => {
    setError(''); setStatus('');
    const oldRole = String(member.role || '').toLowerCase();
    const next = String(newRole || '').toLowerCase();
    if (oldRole === next) return;

    if (oldRole === 'owner' && next !== 'owner' && ownerCount <= 1) {
      setError('You cannot demote the last owner. Promote another collaborator first.');
      return;
    }
    setBusy(true);
    const res = await updateCollaboratorRole(documentId, member.user_id, next);
    setBusy(false);
    if (!res?.success) {
      setError(res?.error?.message || res?.error || 'Could not update role.');
      return;
    }
    setStatus(`Updated ${member.email || 'collaborator'} to ${roleLabel(next)}.`);

    // Email best-effort.
    if (member.email) {
      sendPermissionChangedEmail({
        email: member.email,
        documentName,
        changedByName: inviterName,
        newRole: roleLabel(next),
        oldRole: roleLabel(oldRole),
      }).catch(() => {});
    }
    refresh();
  };

  const handleRemove = async (member) => {
    setError(''); setStatus('');
    if (String(member.role).toLowerCase() === 'owner' && ownerCount <= 1) {
      setError('You cannot remove the last owner. Promote another collaborator first.');
      return;
    }
    setBusy(true);
    const res = await removeDocumentCollaborator(documentId, member.user_id);
    setBusy(false);
    if (!res?.success) {
      setError(res?.error?.message || res?.error || 'Could not remove collaborator.');
      return;
    }
    setStatus(`Removed ${member.email || 'collaborator'}.`);
    if (member.email) {
      sendAccessRemovedEmail({
        email: member.email,
        documentName,
        removedByName: inviterName,
      }).catch(() => {});
    }
    refresh();
  };

  const handleRevoke = async (invite) => {
    setError(''); setStatus('');
    setBusy(true);
    const res = await revokeDocumentInvite(invite.id);
    setBusy(false);
    if (!res?.success) {
      setError(res?.error || 'Could not revoke invite.');
      return;
    }
    setStatus('Invite revoked.');
    refresh();
  };

  const handleResend = async (invite) => {
    setError(''); setStatus('');
    setBusy(true);
    const res = await resendDocumentInvite(invite.id, {
      documentName,
      inviterName,
      forceNewDelivery: true,
    });
    setBusy(false);
    if (!res?.success) {
      setError(res?.error || 'Could not resend invite.');
      return;
    }
    setStatus(`Invite to ${invite.target_email || 'recipient'} resent.`);
    refresh();
  };

  if (!open) return null;

  const pendingInvites = invites.filter((i) => !i.accepted_at && !i.revoked_at && new Date(i.expires_at) > new Date());
  const activeLinks = pendingInvites.filter((i) => !i.target_email);
  const emailPending = pendingInvites.filter((i) => i.target_email);

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: C.scrim, backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1300, fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: 620, maxWidth: '94vw', background: C.card, border: `1px solid ${C.rule}`, borderRadius: 10, boxShadow: '0 24px 60px rgba(0,0,0,0.55)', color: C.ink, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '88vh' }}>
          <div style={{ padding: '16px 18px 14px', borderBottom: `1px solid ${C.rule}`, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 3, height: 30, background: C.gold, borderRadius: 2, flex: 'none', marginRight: 10 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10.5, letterSpacing: 0.14, textTransform: 'uppercase', color: C.muted, fontWeight: 700 }}>{labelForKind(kind)}</div>
              <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.015, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{documentName}</div>
            </div>
            <button onClick={() => setInviteOpen(true)} data-kal31-invite-btn="true" style={{ flex: 'none', background: C.gold, color: 'var(--accent-text)', border: 0, borderRadius: 6, padding: '5px 11px', height: 28, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Invite</button>
            <button onClick={onClose} title="Close" aria-label="Close" style={closeButtonStyle({ borderColor: C.rule, color: C.muted })}><Icon name="close" size={13} /></button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '30px 1fr 1fr 1fr 90px', gap: 14, alignItems: 'center', padding: '8px 18px 6px', borderBottom: `1px solid ${C.rule}`, fontSize: 10.5, letterSpacing: 0.14, textTransform: 'uppercase', color: C.muted, fontWeight: 700 }}>
            <span />
            <span>Users</span>
            <span>Role</span>
            <span>Status</span>
            <span />
          </div>

          <div className="slim-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '6px 8px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {loading && <div style={{ padding: '20px 12px', color: C.muted, fontSize: 12 }}>Loading collaborators…</div>}

            {!loading && members.length === 0 && pendingInvites.length === 0 && (
              <div style={{ padding: '20px 12px', color: C.muted, fontSize: 12 }}>No collaborators yet. Use Invite to add one.</div>
            )}

            {/* Active collaborators. */}
            {members.map((m) => {
              const rl = String(m.role || '').toLowerCase();
              const initials = initialsOf(m.user?.email || m.email || 'U');
              const isLastOwner = rl === 'owner' && ownerCount <= 1;
              return (
                <div key={m.id || `${m.user_id}-${m.document_id}`} data-kal31-row="member" data-kal31-role={rl} style={{ display: 'grid', gridTemplateColumns: '30px 1fr 1fr 1fr 90px', gap: 14, alignItems: 'center', padding: '8px 10px', borderRadius: 6, height: 56, boxSizing: 'border-box' }}>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: rl === 'owner' ? C.gold : colorFor(m.user_id || m.user?.email || m.email), color: 'var(--accent-text)', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800, flex: 'none' }}>{initials}</div>
                  <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.user?.email || m.email || 'Unknown'}</div>
                    <div style={{ fontFamily: MONO_FONT, fontSize: 11, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.user_id}</div>
                  </div>
                  <select
                    value={roleLabel(rl)}
                    disabled={busy}
                    onChange={(e) => handleRoleChange(m, e.target.value)}
                    style={{ background: 'transparent', border: 0, padding: '0 14px 0 0', color: C.inkSoft, font: 'inherit', fontFamily: 'inherit', fontSize: 12, height: 24, lineHeight: '24px', textAlign: 'left', cursor: busy ? 'not-allowed' : 'pointer', width: 'max-content', maxWidth: '100%' }}
                  >
                    {ROLES.map((role) => <option key={role}>{role}</option>)}
                  </select>
                  <div style={{ fontSize: 11.5, color: 'var(--text-2)', fontWeight: 600 }}>{m.status === 'active' ? 'Active' : (m.status || 'Active')}</div>
                  <button
                    disabled={busy || isLastOwner}
                    onClick={() => handleRemove(m)}
                    title={isLastOwner ? 'At least one owner must remain' : 'Remove'}
                    data-kal31-remove="true"
                    style={{ background: 'transparent', border: 0, color: isLastOwner ? C.muted : C.danger, cursor: busy || isLastOwner ? 'not-allowed' : 'pointer', fontSize: 12, fontFamily: 'inherit', textAlign: 'right' }}
                  >
                    Remove
                  </button>
                </div>
              );
            })}

            {/* Pending email invites. */}
            {emailPending.map((inv) => (
              <div key={inv.id} data-kal31-row="invite" style={{ display: 'grid', gridTemplateColumns: '30px 1fr 1fr 1fr 90px', gap: 14, alignItems: 'center', padding: '8px 10px', borderRadius: 6, height: 56, boxSizing: 'border-box', background: 'rgba(216,168,78,0.03)' }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--text-3)', color: 'var(--accent-text)', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800, flex: 'none' }}>{initialsOf(inv.target_email)}</div>
                <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{inv.target_email}</div>
                  <div style={{ fontFamily: MONO_FONT, fontSize: 11, color: C.muted }}>expires {new Date(inv.expires_at).toLocaleDateString()}</div>
                </div>
                <div style={{ fontSize: 12, color: C.inkSoft }}>{roleLabel(inv.intended_role)}</div>
                <div style={{ fontSize: 11.5, color: C.gold, fontWeight: 600 }}>Pending</div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button disabled={busy} onClick={() => handleResend(inv)} style={{ background: 'transparent', border: `1px solid ${C.rule}`, color: C.ink, fontSize: 11, padding: '3px 8px', borderRadius: 4, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>Resend</button>
                  <button disabled={busy} onClick={() => handleRevoke(inv)} style={{ background: 'transparent', border: `1px solid ${C.rule}`, color: C.danger, fontSize: 11, padding: '3px 8px', borderRadius: 4, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>Revoke</button>
                </div>
              </div>
            ))}

            {/* Active link-only invites group. */}
            {activeLinks.length > 0 && (
              <div style={{ marginTop: 6, padding: '6px 4px', borderTop: `1px dashed ${C.rule}` }}>
                <button
                  onClick={() => setLinksOpen((o) => !o)}
                  style={{ background: 'transparent', border: 0, color: C.muted, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer', padding: '8px 14px', display: 'block', width: '100%', textAlign: 'left', fontFamily: 'inherit' }}
                >
                  {linksOpen ? '▾' : '▸'} Active share links ({activeLinks.length})
                </button>
                {linksOpen && activeLinks.map((inv) => (
                  <div key={inv.id} data-kal31-row="link" style={{ display: 'grid', gridTemplateColumns: '30px 1fr 1fr 1fr 90px', gap: 14, alignItems: 'center', padding: '8px 10px', borderRadius: 6, height: 56, boxSizing: 'border-box' }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--surface-3)', color: C.ink, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800, flex: 'none' }}>L</div>
                    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>Link invite</div>
                      <div style={{ fontFamily: MONO_FONT, fontSize: 11, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{buildInviteUrl(inv)}</div>
                    </div>
                    <div style={{ fontSize: 12, color: C.inkSoft }}>{roleLabel(inv.intended_role)}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>created {new Date(inv.created_at).toLocaleDateString()}</div>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button disabled={busy} onClick={async () => {
                        const result = await copyTextToClipboard(buildInviteUrl(inv), { surface: 'document_access_link' });
                        if (result.ok) { setError(''); setStatus('Link copied.'); }
                        else { setStatus(''); setError('Survey could not copy this share link.'); }
                      }} style={{ background: 'transparent', border: `1px solid ${C.rule}`, color: C.ink, fontSize: 11, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}>Copy</button>
                      <button disabled={busy} onClick={() => handleRevoke(inv)} style={{ background: 'transparent', border: `1px solid ${C.rule}`, color: C.danger, fontSize: 11, padding: '3px 8px', borderRadius: 4, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>Revoke</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {(error || status) && (
            <div style={{ padding: '8px 18px', borderTop: `1px solid ${C.rule}`, background: C.deep }}>
              {error && <div style={{ color: C.danger, fontSize: 12 }}>{error}</div>}
              {status && !error && <div style={{ color: C.gold, fontSize: 12 }}>{status}</div>}
            </div>
          )}

          <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.rule}`, background: C.deep, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10.5, color: C.muted, letterSpacing: 0.06, textTransform: 'uppercase', fontWeight: 700 }}>
              {members.length} member{members.length === 1 ? '' : 's'} · {emailPending.length} pending · {activeLinks.length} link{activeLinks.length === 1 ? '' : 's'}
            </span>
            <button onClick={onClose} style={{ background: C.gold, color: 'var(--accent-text)', border: 0, borderRadius: 6, padding: '5px 14px', height: 28, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Done</button>
          </div>
        </div>
      </div>

      <ShareModal
        open={inviteOpen}
        onClose={() => { setInviteOpen(false); refresh(); }}
        kind={kind}
        name={documentName}
        item={item}
      />
    </>
  );
}
