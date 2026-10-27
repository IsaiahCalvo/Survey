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
import { useFocusTrap } from '../hooks/useFocusTrap';
import {
  getDocumentCollaborators,
  updateCollaboratorRole,
  removeDocumentCollaborator,
  getDocumentOwnerProfile,
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
import { grantRememberedDocumentTemplates } from '../services/sharedTemplates.js';
import { supabase } from '../supabaseClient';
import { accessInviteRows, memberIdentity } from './accessRows';
import { presenceInitials } from '../components/presenceIdentity.js';
import { USER_INITIALS_INK, userColorFill } from '../utils/userColors.js';
import { Icon } from './HubShell';
import { C } from '../uiPalette';
import { useTooltip } from '../components/Tooltip';
import DismissBarrier from '../components/DismissBarrier';
import MenuRows from '../components/MenuRows.jsx';
import { menuAtButton, menuRowHeight } from '../utils/menuItems.js';


const ROLES = ['Owner', 'Editor', 'Viewer'];
const MONO_FONT = '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace';

/* Avatar colours for collaborators: each person's own pastel from their user
   id (utils/userColors.js, owner 2026-10-07), the one palette ManageTeamModal,
   ProjectsFolderTree, the account button and the viewer use, so one person
   wears one colour everywhere - an owner too (no gold: gold means selected).
   These colours are identity, never state. A pending invite stays grey:
   nobody is active on it yet. */
const colorFor = (seed) => userColorFill(seed);

function roleLabel(role) {
  const r = String(role || '').toLowerCase();
  return r.charAt(0).toUpperCase() + r.slice(1);
}

/* The one app-wide initials rule (presenceIdentity.js): an email gives its
   first and last name part ("dana.smith@…" -> "DS"), not just "D". */
function initialsOf(name) {
  return String(name || '').trim() ? presenceInitials(name) : '-';
}

function labelForKind(kind) {
  if (kind === 'template') return 'Template access';
  if (kind === 'document') return 'Document access';
  return 'Access';
}

/* One person (or invite, or link) in the access list. Design review
   2026-10-27: Share and Manage team listed the same people two ways (a role
   drop-down, a Status column and a Remove button per row here; plain text and
   a More menu there), and here emails broke mid-word ("e2e-viewer@example.co /
   m") and the owner's row showed a dead Remove. Both now share Manage team's
   row: the name and email on one line each (cut with an ellipsis, the full
   text in the chip), the role as a word, and every action in the row's More
   menu (the shared action menu, components/MenuRows.jsx). */
function AccessRow({ rowProps, pending = false, avatar, primary, secondary, role, status, tip, menuOpen, onMenu, onCloseMenu, menuItems }) {
  // The menu is fixed to the window at the More button, so the scrolling list
  // never clips it.
  const [at, setAt] = useState(null);
  const rows = menuItems.filter(Boolean).length + (menuItems.some((it) => it?.danger) ? 1 : 0);
  const line = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 };
  return (
    <div {...rowProps} className="access-grid" style={{ position: 'relative', display: 'grid', gap: 14, alignItems: 'center', padding: '8px 10px', borderRadius: 6, minHeight: 50, boxSizing: 'border-box', ...(pending ? { background: 'var(--surface-2)' } : null) }}>
      <div data-user-avatar="" style={{ width: 30, height: 30, borderRadius: '50%', background: avatar.background, color: avatar.color, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600, flex: 'none' }}>{avatar.text}</div>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div {...tip(primary)} style={{ ...line, fontSize: 13, fontWeight: 600 }}>{primary}</div>
        {secondary ? <div {...tip(secondary)} style={{ ...line, fontFamily: MONO_FONT, fontSize: 11, color: C.muted }}>{secondary}</div> : null}
      </div>
      <div style={{ ...line, fontSize: 12, color: C.inkSoft }}>{role}</div>
      <div style={{ ...line, fontSize: 12, fontWeight: 600 }}>{status}</div>
      <button type="button" aria-haspopup="menu" aria-expanded={menuOpen} aria-label="More" {...tip('More')} onClick={(e) => { e.stopPropagation(); setAt(menuAtButton(e.currentTarget.getBoundingClientRect(), { height: rows * menuRowHeight() + 16, viewport: { width: window.innerWidth, height: window.innerHeight } })); onMenu(); }} className="hub-icon-btn dialog-close-touch-pad" style={{ justifySelf: 'end' }}>
        <Icon name="more" size={14} />
      </button>
      {menuOpen && at && (
        <div role="menu" aria-label={`${primary} actions`} data-access-menu-surface="true" className="hub-menu" onClick={(e) => e.stopPropagation()} style={{ left: at.left, top: at.top, zIndex: 1400, width: 180 }}>
          <MenuRows items={menuItems} tip={tip} tipSide="left" onClose={onCloseMenu} />
        </div>
      )}
    </div>
  );
}

export default function AccessManagementModal({ open, onClose, kind = 'document', item = null, user = null }) {
  const tip = useTooltip();
  const auth = useContext(AuthContext) || {};
  const currentUser = auth?.user || user || null;

  const documentId = useMemo(() => {
    if (!item) return null;
    return item.id || item.document_id || item.documentId || null;
  }, [item]);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [members, setMembers] = useState([]);   // real collaborator rows
  const [invites, setInvites] = useState([]);   // real invite rows
  const [ownerProfile, setOwnerProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [linksOpen, setLinksOpen] = useState(false);
  // The row whose More menu is open ('m:<id>', 'i:<id>' or 'l:<id>').
  const [openMenu, setOpenMenu] = useState(null);
  const cardRef = useRef(null);

  // Accessibility (KAL-66): the shared modal primitive — Tab stays inside the
  // dialog, Escape closes it, focus moves in on open and returns to the opener
  // on close. The nested ShareModal (Invite) registers on the same open-dialog
  // stack (src/hooks/modalStack.js), so while it is open Tab and Escape belong
  // to it and this dialog waits underneath.
  // Escape first closes an open row menu, then the dialog.
  useFocusTrap(cardRef, Boolean(open), { onEscape: () => (openMenu ? setOpenMenu(null) : onClose?.()) });

  const refresh = useCallback(async () => {
    if (!documentId) { setMembers([]); setInvites([]); return; }
    setLoading(true);
    setError('');
    try {
      const [colRes, invRes, owner] = await Promise.all([
        getDocumentCollaborators(documentId),
        listDocumentInvites(documentId),
        getDocumentOwnerProfile(documentId).catch(() => null),
      ]);
      setMembers(Array.isArray(colRes?.data) ? colRes.data : []);
      setInvites(Array.isArray(invRes?.data) ? invRes.data : []);
      setOwnerProfile(owner || null);
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
    // Their survey template role follows (editor edits, viewer uses only);
    // the templates this device saw the document use. Fire-and-forget.
    void grantRememberedDocumentTemplates({ client: supabase, documentId, user: currentUser });

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

  // One person, one row: an email invite for someone who is already an active
  // member (e.g. their invite email failed after access was granted) is not
  // listed again as Pending with Resend. See accessRows.js.
  const { links: activeLinks, emails: emailPending } = accessInviteRows(invites, members);

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: C.scrim, backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1300, fontFamily: 'var(--font-ui)' }}>
        <div ref={cardRef} role="dialog" aria-modal="true" aria-label={`${labelForKind(kind)}: ${documentName}`} onClick={(e) => e.stopPropagation()} style={{ width: 620, maxWidth: '94vw', background: C.card, border: `1px solid ${C.rule}`, borderRadius: 'var(--radius-dialog)', boxShadow: 'var(--shadow-dialog)', color: C.ink, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '88vh' }}>
          <div style={{ padding: '16px 18px 14px', borderBottom: `1px solid ${C.rule}`, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 3, height: 30, background: C.gold, borderRadius: 2, flex: 'none', marginRight: 10 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, letterSpacing: 0, color: C.muted, fontWeight: 600 }}>{labelForKind(kind)}</div>
              <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.015, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{documentName}</div>
            </div>
            <button onClick={() => setInviteOpen(true)} data-kal31-invite-btn="true" className="hub-btn hub-btn--primary">Invite</button>
            <button onClick={onClose} aria-label="Close" {...tip('Close')} className="hub-icon-btn"><Icon name="close" size={13} /></button>
          </div>

          <div className="access-grid access-grid--head" style={{ display: 'grid', gap: 14, alignItems: 'center', padding: '8px 18px 6px', borderBottom: `1px solid ${C.rule}`, fontSize: 11, letterSpacing: 0, color: C.muted, fontWeight: 600 }}>
            <span />
            <span>Users</span>
            <span>Role</span>
            <span>Status</span>
            <span />
          </div>

          <DismissBarrier active={openMenu != null} insideSelector="[data-access-menu-surface='true']" onDismiss={() => setOpenMenu(null)} />
          <div className="slim-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '6px 8px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {loading && <div style={{ padding: '20px 12px', color: C.muted, fontSize: 12 }}>Loading collaborators…</div>}

            {!loading && members.length === 0 && emailPending.length === 0 && activeLinks.length === 0 && (
              <div style={{ padding: '20px 12px', color: C.muted, fontSize: 12 }}>No collaborators yet. Use Invite to add one.</div>
            )}

            {/* Active collaborators. */}
            {members.map((m) => {
              const rl = String(m.role || '').toLowerCase();
              const ident = memberIdentity(m, { owner: ownerProfile, currentUser });
              const isLastOwner = rl === 'owner' && ownerCount <= 1;
              const menuKey = `m:${m.id || m.user_id}`;
              const email = m.email || m.user?.email || ident.secondary || (ident.primary.includes('@') ? ident.primary : '');
              return (
                <AccessRow
                  key={m.id || `${m.user_id}-${m.document_id}`}
                  rowProps={{ 'data-kal31-row': 'member', 'data-kal31-role': rl }}
                  avatar={{ text: initialsOf(ident.primary), background: colorFor(m.user_id || m.user?.email || m.email), color: USER_INITIALS_INK }}
                  primary={ident.primary}
                  secondary={ident.secondary}
                  role={roleLabel(rl)}
                  status={<span style={{ color: 'var(--text-2)' }}>{m.status === 'active' ? 'Active' : roleLabel(m.status || 'Active')}</span>}
                  tip={tip}
                  menuOpen={openMenu === menuKey}
                  onMenu={() => setOpenMenu(openMenu === menuKey ? null : menuKey)}
                  onCloseMenu={() => setOpenMenu(null)}
                  // The last owner can't lose the role or be removed; the rows
                  // say why instead of doing nothing (the old Remove button sat
                  // greyed out with no reason).
                  menuItems={[
                    ...ROLES.filter((role) => role.toLowerCase() !== rl).map((role) => ({
                      label: `Make ${role.toLowerCase()}`,
                      disabled: busy,
                      reason: isLastOwner ? 'At least one owner must remain' : null,
                      onClick: () => handleRoleChange(m, role),
                    })),
                    { label: 'Copy email', disabled: !email, onClick: async () => {
                      const result = await copyTextToClipboard(email, { surface: 'document_access_member_email' });
                      if (result.ok) { setError(''); setStatus('Email copied.'); }
                      else { setStatus(''); setError('Survey could not copy this email.'); }
                    } },
                    { label: 'Remove access', danger: true, disabled: busy, reason: isLastOwner ? 'At least one owner must remain' : null, onClick: () => handleRemove(m) },
                  ]}
                />
              );
            })}

            {/* Pending email invites. */}
            {emailPending.map((inv) => (
              <AccessRow
                key={inv.id}
                pending
                rowProps={{ 'data-kal31-row': 'invite' }}
                avatar={{ text: initialsOf(inv.target_email), background: 'var(--text-3)', color: 'var(--accent-text)' }}
                primary={inv.target_email}
                secondary={`expires ${new Date(inv.expires_at).toLocaleDateString()}`}
                role={roleLabel(inv.intended_role)}
                status={<span style={{ color: C.gold }}>Pending</span>}
                tip={tip}
                menuOpen={openMenu === `i:${inv.id}`}
                onMenu={() => setOpenMenu(openMenu === `i:${inv.id}` ? null : `i:${inv.id}`)}
                onCloseMenu={() => setOpenMenu(null)}
                menuItems={[
                  { label: 'Resend invite', disabled: busy, onClick: () => handleResend(inv) },
                  { label: 'Revoke invite', danger: true, disabled: busy, onClick: () => handleRevoke(inv) },
                ]}
              />
            ))}

            {/* Active link-only invites group. */}
            {activeLinks.length > 0 && (
              <div style={{ marginTop: 6, padding: '6px 4px', borderTop: `1px dashed ${C.rule}` }}>
                <button
                  onClick={() => setLinksOpen((o) => !o)}
                  style={{ background: 'transparent', border: 0, color: C.muted, fontSize: 11, fontWeight: 600, letterSpacing: 0, cursor: 'pointer', padding: '8px 14px', display: 'block', width: '100%', textAlign: 'left', fontFamily: 'inherit' }}
                >
                  {linksOpen ? '▾' : '▸'} Active share links ({activeLinks.length})
                </button>
                {linksOpen && activeLinks.map((inv) => (
                  <AccessRow
                    key={inv.id}
                    rowProps={{ 'data-kal31-row': 'link' }}
                    avatar={{ text: 'L', background: 'var(--surface-3)', color: C.ink }}
                    primary="Link invite"
                    secondary={buildInviteUrl(inv)}
                    role={roleLabel(inv.intended_role)}
                    status={<span style={{ color: C.muted, fontWeight: 400 }}>created {new Date(inv.created_at).toLocaleDateString()}</span>}
                    tip={tip}
                    menuOpen={openMenu === `l:${inv.id}`}
                    onMenu={() => setOpenMenu(openMenu === `l:${inv.id}` ? null : `l:${inv.id}`)}
                    onCloseMenu={() => setOpenMenu(null)}
                    menuItems={[
                      { label: 'Copy link', disabled: busy, onClick: async () => {
                        const result = await copyTextToClipboard(buildInviteUrl(inv), { surface: 'document_access_link' });
                        if (result.ok) { setError(''); setStatus('Link copied.'); }
                        else { setStatus(''); setError('Survey could not copy this share link.'); }
                      } },
                      { label: 'Revoke link', danger: true, disabled: busy, onClick: () => handleRevoke(inv) },
                    ]}
                  />
                ))}
              </div>
            )}
          </div>

          {(error || status) && (
            <div style={{ padding: '8px 18px', borderTop: `1px solid ${C.rule}`, background: C.deep }}>
              {error && <div style={{ color: C.dangerText, fontSize: 12 }}>{error}</div>}
              {status && !error && <div style={{ color: C.gold, fontSize: 12 }}>{status}</div>}
            </div>
          )}

          <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.rule}`, background: C.deep, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: C.muted, letterSpacing: 0, fontWeight: 600 }}>
              {members.length} member{members.length === 1 ? '' : 's'} · {emailPending.length} pending · {activeLinks.length} link{activeLinks.length === 1 ? '' : 's'}
            </span>
            <button onClick={onClose} className="hub-btn hub-btn--primary">Done</button>
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
