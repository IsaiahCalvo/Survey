/* Survey Hub — Manage Team modal + Invite / Activity sub-modals.
   Visual design is a faithful 1:1 port of the Claude Design prototype
   (survey-hub/manage-team.jsx — ManageTeam, InviteModal, ActivityModal).

   Behavior is REAL (2026-07-01): the member list loads live rows from
   `project_collaborators` (getProjectCollaborators), pending invites load
   from `project_invites` (listProjectInvites), the Invite sub-dialog mints
   real tokens + sends real emails through createProjectInvite (same path as
   ShareModal), and role-change / remove write through the collaborator
   helpers. Last-owner protection mirrors AccessManagementModal: the project
   creator counts as an owner and can never be demoted or removed here.

   Colors are literal hex (the hub palette) because this overlay renders
   outside the `.survey-hub` root, where the CSS variables are not in scope.
   Palette mapping from survey-hub/styles.css:
     --ink-800 #12151c  --ink-700 #181c24  --ink-500 #2a3140
     --ink-400 #3a4252  --ink-300 #5a6473  --ink-200 #8d96a6
     --bone-100 #f4f1ea --bone-200 #e8e2d4 --gold #d8a84e
*/
import React from 'react';
import { Icon } from './HubShell';
import { AuthContext } from '../contexts/AuthContext';
import Spinner from '../components/Spinner';
import { useFocusTrap } from '../hooks/useFocusTrap';
import DismissBarrier from '../components/DismissBarrier';
import { copyTextToClipboard } from '../utils/clipboard';
import { C } from '../uiPalette';
import {
  createProjectInvite,
  listProjectInvites,
  revokeProjectInvite,
  resendProjectInvite,
  getProjectCollaborators,
  updateProjectCollaboratorRole,
  removeProjectCollaborator,
  buildInviteUrl,
} from '../services/projectInviteService';
import {
  sendPermissionChangedEmail,
  sendAccessRemovedEmail,
} from '../services/shareEmailService';

/* Hub palette — literal hex, see header note. */
const INK_800 = 'var(--surface-1)';
// UX 2026-09-22: these eight names are the shared palette's, aliased for the
// rules below rather than re-declared. See src/uiPalette.js.
const INK_700 = C.card;
const INK_500 = C.rule;
/* UX 2026-09-22 (tokens.css revision 4): borders here split by JOB. INK_500 is
   the subtle, decorative hairline — the modal edge, its header/footer rules,
   the row separators, the popup menus, everything a surface step already
   separates. INK_500_FIELD is the identifying edge, and only the controls the
   token file names may use it: the selects, the email textarea, the search
   field, the checkbox, and the buttons that have no resting fill of their own
   (Close, Copy link, All/None, the icon button). */
const INK_500_FIELD = C.ruleStrong;
const INK_300 = C.disabled;
const INK_200 = C.muted;
const BONE_100 = C.ink;
const BONE_200 = C.inkSoft;
const GOLD = C.gold;
const DANGER = C.danger;

const ROLES = ["Owner", "Editor", "Viewer"];
const ROLE_ORDER = { Owner: 0, Editor: 1, Viewer: 2 };
const PAID_TIERS = new Set(['pro', 'enterprise', 'developer']);

/* Deterministic avatar colors for collaborators (creator keeps gold). */
const COLLAB_COLORS = ['#5fbf83', '#7aa2f7', '#b48ead', '#8fbcbb', '#cf9f6f'];
const colorFor = (seed) => {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return COLLAB_COLORS[h % COLLAB_COLORS.length];
};

/* Two-letter initials from a display name — used for the avatar glyph so the
   circle shows real initials, never a raw user id. */
const initialsOf = (name) => (name || '')
  .trim().split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase() || '—';

const roleLabel = (role) => {
  const r = String(role || 'viewer').toLowerCase();
  return r.charAt(0).toUpperCase() + r.slice(1);
};

const MONO_FONT = '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace';

const timeToMinutes = (t) => {
  const m = /^(\d+):(\d+)\s*(AM|PM)$/i.exec(t || ""); if (!m) return 0;
  let h = parseInt(m[1]); const min = parseInt(m[2]); const pm = /PM/i.test(m[3]);
  if (h === 12) h = 0; if (pm) h += 12;
  return h * 60 + min;
};
const editedMs = (ev) => (Date.parse(ev.date) || 0) + timeToMinutes(ev.time) * 60 * 1000;

const fmtDate = (iso) => (iso
  ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  : '');

function parseEmails(raw) {
  return (raw || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
}

/* ============ Activity sub-modal ============ */
const ActivityModal = ({ member, onClose }) => {
  const [sortKey, setSortKey] = React.useState("edited");
  const [sortDir, setSortDir] = React.useState("desc");
  const cardRef = React.useRef(null);

  // Accessibility (KAL-66): the shared modal primitive — Tab stays inside the
  // dialog, Escape closes it, and focus returns to whatever opened it.
  useFocusTrap(cardRef, Boolean(member), { onEscape: onClose });

  if (!member) return null;
  const arrow = (k) => sortKey === k ? (sortDir === "asc" ? " ↑" : " ↓") : "";
  const click = (k) => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir(k === "file" ? "asc" : "desc"); }
  };
  // Per-member activity history is not tracked yet — no invented events.
  const items = [];
  const sign = sortDir === "asc" ? 1 : -1;
  if (sortKey === "file") items.sort((a, b) => sign * a.file.localeCompare(b.file));
  else items.sort((a, b) => sign * (editedMs(a) - editedMs(b)));

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(13,15,20,0.55)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120, fontFamily: "\"Helvetica Neue\", Helvetica, Arial, sans-serif" }}>
      <div ref={cardRef} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={{ width: 520, background: INK_700, border: `1px solid ${INK_500}`, borderRadius: 10, boxShadow: "0 24px 60px rgba(0,0,0,0.55)", color: BONE_100, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 18px 14px", borderBottom: `1px solid ${INK_500}`, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 3, height: 30, background: member.color, borderRadius: 2, flex: "none", marginRight: 10 }}></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10.5, letterSpacing: 0.14, textTransform: "uppercase", color: INK_200, fontWeight: 700 }}>Activity</div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.015, marginTop: 4 }}>{member.name} · activity</div>
          </div>
          <button onClick={onClose} title="Close" aria-label="Close" className="hub-icon-btn"><Icon name="close" size={13} /></button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 130px", gap: 14, padding: "8px 18px 6px", borderBottom: `1px solid ${INK_500}`, fontSize: 10.5, letterSpacing: 0.14, textTransform: "uppercase", color: INK_200, fontWeight: 700 }}>
          <span onClick={() => click("file")} style={{ cursor: "pointer", userSelect: "none", color: sortKey === "file" ? BONE_100 : "inherit" }}>File{arrow("file")}</span>
          <span onClick={() => click("edited")} style={{ cursor: "pointer", userSelect: "none", color: sortKey === "edited" ? BONE_100 : "inherit" }}>Edited{arrow("edited")}</span>
        </div>
        <div className="slim-scroll" style={{ maxHeight: 420, overflowY: "auto", padding: "6px 8px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
          {items.length === 0 ? (
            <div style={{ padding: "24px 10px", textAlign: "center", color: INK_200, fontSize: 12 }}>No recent activity.</div>
          ) : items.map((ev, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 130px", gap: 14, alignItems: "center", padding: "8px 10px", borderRadius: 6, height: 42, boxSizing: "border-box" }}>
              <div style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ev.file}</div>
              <div className="mono" style={{ fontFamily: MONO_FONT, display: "flex", flexDirection: "column", gap: 1, lineHeight: 1.25 }}>
                <span style={{ fontSize: 11.5, color: BONE_200, fontWeight: 600 }}>{ev.time}</span>
                <span style={{ fontSize: 10.5, color: INK_200 }}>{ev.date}</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: "12px 16px", borderTop: `1px solid ${INK_500}`, background: INK_800, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 10.5, color: INK_200, letterSpacing: 0.06, textTransform: "uppercase", fontWeight: 700 }}>{items.length} event{items.length === 1 ? "" : "s"}</span>
          <button onClick={onClose} className="hub-btn hub-btn--primary">Done</button>
        </div>
      </div>
    </div>
  );
};

/* ============ Invite User sub-modal (REAL) ============
   Mints real project invite tokens via createProjectInvite — the exact path
   ShareModal uses. "Copy link" creates a link-only invite and copies its real
   /invite/<token> URL; "Send invite" creates one email-bound invite per
   address (the service fires the Resend-backed email). */
const InviteModal = ({ project, onClose, currentUser, canInvite, onChanged }) => {
  const [emails, setEmails] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const [linkRole, setLinkRole] = React.useState("Viewer");
  const [emailRole, setEmailRole] = React.useState("Editor");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");
  const [activeInvite, setActiveInvite] = React.useState(null); // last minted link invite
  const cardRef = React.useRef(null);

  // Accessibility (KAL-66): the shared modal primitive — Tab stays inside the
  // dialog, Escape closes it, and focus returns to whatever opened it. This
  // component is only mounted while open (the parent gates it behind
  // `inviteOpen &&`), so `true` is the correct isOpen.
  useFocusTrap(cardRef, true, { onEscape: onClose });

  const projectId = project?.id || null;
  const inviterName = currentUser?.user_metadata?.full_name || currentUser?.email || null;
  const blockedReason = !canInvite
    ? 'Free plan accounts cannot create invite links. Upgrade to Pro or higher to share.'
    : (!projectId ? 'This project has no id yet — save it before inviting.' : '');

  // Honest placeholder until a real token is minted — never show a fake URL
  // that differs from what "Copy link" actually copies.
  const url = activeInvite
    ? buildInviteUrl(activeInvite)
    : `Press Copy link to create a secure ${linkRole} link`;

  const copyLink = async () => {
    setError(""); setSuccess("");
    if (blockedReason) { setError(blockedReason); return; }
    setBusy(true);
    const res = await createProjectInvite({
      projectId,
      role: linkRole.toLowerCase(),
      email: null, // link-only
      currentUser,
      projectName: project?.name || '',
      inviterName,
    });
    setBusy(false);
    if (!res.success) { setError(res.error || 'Could not create invite link.'); return; }
    setActiveInvite(res.invite);
    const link = buildInviteUrl(res.invite);
    const copyResult = await copyTextToClipboard(link, { surface: 'project_invite_link' });
    if (!copyResult.ok) {
      setError('Invite link created, but Survey could not copy it. Select the link and copy it manually.');
      onChanged?.();
      return;
    }
    setCopied(true);
    setSuccess(`Link copied. Anyone with it can join as ${linkRole}.`);
    setTimeout(() => setCopied(false), 1800);
    onChanged?.();
  };

  const sendInvites = async () => {
    setError(""); setSuccess("");
    if (blockedReason) { setError(blockedReason); return; }
    const list = parseEmails(emails);
    if (!list.length) { setError('Enter at least one valid email.'); return; }
    setBusy(true);
    const results = await Promise.all(list.map((addr) => createProjectInvite({
      projectId,
      role: emailRole.toLowerCase(),
      email: addr,
      currentUser,
      projectName: project?.name || '',
      inviterName,
    })));
    setBusy(false);
    const failed = results.filter((r) => !r.success);
    if (failed.length) {
      setError(`Sent ${results.length - failed.length} of ${results.length}. First failure: ${failed[0].error || 'unknown'}.`);
    } else {
      setSuccess(`Sent ${results.length} ${emailRole} invite${results.length === 1 ? '' : 's'}.`);
      setEmails("");
    }
    onChanged?.();
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(13,15,20,0.55)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 130, fontFamily: "\"Helvetica Neue\", Helvetica, Arial, sans-serif" }}>
      <div ref={cardRef} role="dialog" aria-modal="true" aria-label="Invite User" data-kal31-project-invite-modal="true" onClick={(e) => e.stopPropagation()} style={{ width: 440, background: INK_700, border: `1px solid ${INK_500}`, borderRadius: 10, boxShadow: "0 24px 60px rgba(0,0,0,0.55)", color: BONE_100, overflow: "hidden" }}>
        <div style={{ padding: "16px 18px 14px", borderBottom: `1px solid ${INK_500}`, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 3, height: 30, background: project.color || GOLD, borderRadius: 2, flex: "none", marginRight: 10 }}></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10.5, letterSpacing: 0.14, textTransform: "uppercase", color: INK_200, fontWeight: 700 }}>Invite User</div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.015, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{project.name}</div>
          </div>
          <button onClick={onClose} title="Close" aria-label="Close" className="hub-icon-btn"><Icon name="close" size={13} /></button>
        </div>
        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <div style={{ fontSize: 10.5, letterSpacing: 0.14, textTransform: "uppercase", color: INK_200, fontWeight: 700, marginBottom: 8 }}>Share link</div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 96px 82px", gap: 6 }}>
              <div className="mono" style={{ fontFamily: MONO_FONT, flex: 1, minWidth: 0, background: INK_800, border: `1px solid ${INK_500}`, borderRadius: 6, padding: "0 11px", height: 30, display: "flex", alignItems: "center", fontSize: 11.5, color: BONE_200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{url}</div>
              <select value={linkRole} onChange={(e) => setLinkRole(e.target.value)} style={{ height: 30, background: INK_700, color: BONE_100, border: `1px solid ${INK_500_FIELD}`, borderRadius: 6, padding: "0 8px", fontSize: 11.5, fontFamily: "inherit" }}>
                {ROLES.slice().reverse().map((r) => <option key={r}>{r}</option>)}
              </select>
              <button onClick={copyLink} disabled={busy || !!blockedReason} className="hub-btn">{copied ? "Copied" : "Copy link"}</button>
            </div>
            <div style={{ fontSize: 11, color: INK_200, marginTop: 8, lineHeight: 1.4 }}>Anyone with this invite link can join as {linkRole}. Free users enter as Viewer until upgrade.</div>
          </div>
          <div>
            <div style={{ fontSize: 10.5, letterSpacing: 0.14, textTransform: "uppercase", color: INK_200, fontWeight: 700, marginBottom: 8 }}>Invite by email</div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 96px", gap: 6 }}>
              <textarea value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="name@example.com, name@example.com" rows={3} style={{ width: "100%", background: INK_800, border: `1px solid ${INK_500_FIELD}`, borderRadius: 6, padding: "9px 11px", fontSize: 12.5, fontFamily: "inherit", color: BONE_100, resize: "vertical", outline: "none", minHeight: 72, lineHeight: 1.45, boxSizing: "border-box" }}/>
              <select value={emailRole} onChange={(e) => setEmailRole(e.target.value)} style={{ height: 30, alignSelf: "start", background: INK_700, color: BONE_100, border: `1px solid ${INK_500_FIELD}`, borderRadius: 6, padding: "0 8px", fontSize: 11.5, fontFamily: "inherit" }}>
                {ROLES.slice().reverse().map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div style={{ fontSize: 11, color: INK_200, marginTop: 8, lineHeight: 1.4 }}>Separate addresses with commas. Each invitee gets an email with a link to join as {emailRole}.</div>
          </div>
          {(blockedReason || error) && (
            <div style={{ background: "var(--danger-soft)", borderLeft: `3px solid ${DANGER}`, borderRadius: 8, padding: "8px 10px", color: BONE_100, fontSize: 11.5 }}>
              {blockedReason || error}
            </div>
          )}
          {success && !error && (
            <div style={{ background: "var(--accent-soft)", border: `1px solid ${GOLD}`, borderRadius: 6, padding: "8px 10px", color: GOLD, fontSize: 11.5 }}>
              {success}
            </div>
          )}
        </div>
        <div style={{ padding: "12px 16px", borderTop: `1px solid ${INK_500}`, background: INK_800, display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
          <button onClick={onClose} className="hub-btn">Cancel</button>
          {/* UX (KAL-73): invite sends are a network round-trip over 500ms, so the
              button takes the shared loading treatment — 14px ring on the left,
              present-participle label, disabled until the request resolves. */}
          <button disabled={busy || !emails.trim() || !!blockedReason} onClick={sendInvites} className="hub-btn hub-btn--primary">{busy && <Spinner size={14} color="var(--accent-text)" trackColor="rgba(21,17,10,0.25)" />}{busy ? "Sending invite…" : `Send ${emailRole} invite`}</button>
        </div>
      </div>
    </div>
  );
};

/* ============ Manage Team modal ============ */
export default function ManageTeamModal({ open, onClose, project, members }) {
  // Tolerant of missing provider — direct context read so tests/standalone
  // renders don't throw the way `useAuth` does.
  const auth = React.useContext(AuthContext) || {};
  const currentUser = auth?.user || null;
  const tier = (auth?.tier || auth?.plan || 'free').toLowerCase();
  const canInvite = PAID_TIERS.has(tier);

  const projectId = project?.id || null;
  const projectName = project?.name || 'Untitled';
  const inviterName = currentUser?.user_metadata?.full_name || currentUser?.email || 'An owner';

  /* The seed list comes from the host (ProjectsFolderTree) and always carries
     the project creator first. Real collaborator rows are fetched from
     `project_collaborators` and appended; pending invites come from
     `project_invites`. The creator is implicit owner (not a collaborator
     row), so it is never demotable/removable here. */
  const seedMembers = React.useMemo(() => {
    const arr = Array.isArray(members) ? members : [];
    return arr.slice(0, 1).map((m) => ({ ...m, isCreator: true, userId: m.id }));
  }, [members]);

  const [collabRows, setCollabRows] = React.useState([]); // raw project_collaborators rows
  const [invites, setInvites] = React.useState([]);       // raw project_invites rows
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [status, setStatus] = React.useState("");

  const [search, setSearch] = React.useState("");
  const [editMode, setEditMode] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState(() => new Set());
  const [openMenu, setOpenMenu] = React.useState(null);
  const [openInviteMenu, setOpenInviteMenu] = React.useState(null);
  const [openRoleSel, setOpenRoleSel] = React.useState(null);
  const [bulkRoleOpen, setBulkRoleOpen] = React.useState(false);
  const [activityFor, setActivityFor] = React.useState(null);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [sortKey, setSortKey] = React.useState("default");
  const [sortDir, setSortDir] = React.useState("asc");
  const previouslyFocusedRef = React.useRef(null);
  const searchRootRef = React.useRef(null);
  const searchInputRef = React.useRef(null);
  const [searchFocused, setSearchFocused] = React.useState(false);
  const transientDismissActiveRef = React.useRef(false);
  transientDismissActiveRef.current = searchFocused || openMenu != null || openInviteMenu != null || openRoleSel != null || bulkRoleOpen;

  // Accessibility: Escape closes the modal, and focus returns to whatever
  // triggered it once it closes (minimal per-modal patch, no shared modal
  // primitive/focus trap). Skipped while a nested sub-modal (Activity or
  // Invite) is open so Escape closes that one first.
  React.useEffect(() => {
    if (!open) return undefined;
    previouslyFocusedRef.current = document.activeElement;
    const handleKey = (e) => {
      if (e.key === 'Escape' && !activityFor && !inviteOpen) {
        if (transientDismissActiveRef.current) return;
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
  }, [open, onClose, activityFor, inviteOpen]);

  const refresh = React.useCallback(async () => {
    if (!projectId) { setCollabRows([]); setInvites([]); return; }
    setLoading(true);
    try {
      const [colRes, invRes] = await Promise.all([
        getProjectCollaborators(projectId),
        listProjectInvites(projectId),
      ]);
      setCollabRows(Array.isArray(colRes?.data) ? colRes.data : []);
      setInvites(Array.isArray(invRes?.data) ? invRes.data : []);
    } catch (err) {
      console.error('[KAL-31] ManageTeamModal load failed:', err);
      setError(err?.message || 'Could not load the team list.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  React.useEffect(() => {
    if (!open) return;
    setError(""); setStatus(""); setSelectedIds(new Set()); setEditMode(false);
    refresh();
  }, [open, refresh]);

  /* Real member list: creator first, then fetched collaborator rows mapped
     into the display shape the design expects. */
  const memberList = React.useMemo(() => {
    const creatorIds = new Set(seedMembers.map((m) => m.userId));
    const collabs = collabRows
      .filter((r) => !creatorIds.has(r.user_id))
      .map((r) => ({
        id: r.user_id,
        userId: r.user_id,
        name: (r.email || '').split('@')[0] || 'Teammate',
        initials: initialsOf((r.email || '').split('@')[0] || 'Teammate'),
        email: r.email || '',
        role: roleLabel(r.role),
        color: colorFor(r.user_id),
        added: fmtDate(r.created_at),
        isCreator: false,
      }));
    return [...seedMembers, ...collabs];
  }, [seedMembers, collabRows]);

  const pendingInvites = React.useMemo(() => (
    invites.filter((i) => !i.accepted_at && !i.revoked_at && new Date(i.expires_at) > new Date())
  ), [invites]);

  /* Last-owner protection mirrors AccessManagementModal: the creator counts
     as an owner, so ownerCount is creator + collaborator owners. */
  const ownerCount = memberList.filter((m) => String(m.role).toLowerCase() === 'owner').length;

  if (!open) return null;

  const filteredMembers = () => {
    const q = search.trim().toLowerCase();
    if (!q) return memberList;
    return memberList.filter((m) => (m.name || '').toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q));
  };

  const sortedMembers = () => {
    const arr = filteredMembers().slice();
    if (sortKey === "default") {
      arr.sort((a, b) => {
        const r = (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3);
        if (r !== 0) return r;
        return (Date.parse(a.added) || 0) - (Date.parse(b.added) || 0);
      });
      return arr;
    }
    const sign = sortDir === "asc" ? 1 : -1;
    if (sortKey === "name") arr.sort((a, b) => sign * a.name.localeCompare(b.name));
    else if (sortKey === "role") arr.sort((a, b) => sign * ((ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3)) || (Date.parse(a.added) || 0) - (Date.parse(b.added) || 0));
    else if (sortKey === "added") arr.sort((a, b) => sign * ((Date.parse(a.added) || 0) - (Date.parse(b.added) || 0)));
    return arr;
  };
  const onSort = (k) => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir(k === "added" ? "desc" : "asc"); }
  };
  const arrow = (k) => sortKey === k ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  /* ---- Real mutations (project_collaborators via RLS-gated helpers) ---- */

  const guardMember = (m, nextRole) => {
    if (m.isCreator) return 'The project creator is always an owner and cannot be changed here.';
    const isOwner = String(m.role).toLowerCase() === 'owner';
    const demoting = nextRole != null && String(nextRole).toLowerCase() !== 'owner';
    if (isOwner && (nextRole == null || demoting) && ownerCount <= 1) {
      return nextRole == null
        ? 'You cannot remove the last owner. Promote another collaborator first.'
        : 'You cannot demote the last owner. Promote another collaborator first.';
    }
    return '';
  };

  const setRole = async (id, role) => {
    setError(""); setStatus("");
    const m = memberList.find((x) => x.id === id);
    if (!m || m.role === role) return;
    const blocked = guardMember(m, role);
    if (blocked) { setError(blocked); return; }
    setBusy(true);
    const res = await updateProjectCollaboratorRole(projectId, m.userId, role.toLowerCase());
    setBusy(false);
    if (!res?.success) { setError(res?.error?.message || res?.error || 'Could not update role.'); return; }
    setStatus(`Updated ${m.email || m.name} to ${role}.`);
    if (m.email) {
      sendPermissionChangedEmail({
        email: m.email,
        documentName: `the project "${projectName}"`,
        changedByName: inviterName,
        newRole: role,
        oldRole: m.role,
      }).catch(() => {});
    }
    refresh();
  };

  const removeMember = async (id) => {
    setError(""); setStatus("");
    const m = memberList.find((x) => x.id === id);
    if (!m) return;
    const blocked = guardMember(m, null);
    if (blocked) { setError(blocked); return; }
    setBusy(true);
    const res = await removeProjectCollaborator(projectId, m.userId);
    setBusy(false);
    if (!res?.success) { setError(res?.error?.message || res?.error || 'Could not remove collaborator.'); return; }
    setStatus(`Removed ${m.email || m.name}.`);
    if (m.email) {
      sendAccessRemovedEmail({
        email: m.email,
        documentName: `the project "${projectName}"`,
        removedByName: inviterName,
      }).catch(() => {});
    }
    setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    refresh();
  };

  const removeSelected = async () => {
    for (const id of Array.from(selectedIds)) {
      // Sequential on purpose: each step re-checks guards against the latest
      // list, and the first error stops the batch visibly.
      // eslint-disable-next-line no-await-in-loop
      await removeMember(id);
    }
    setSelectedIds(new Set());
  };

  const setRoleBulk = async (role) => {
    setBulkRoleOpen(false);
    for (const id of Array.from(selectedIds)) {
      // eslint-disable-next-line no-await-in-loop
      await setRole(id, role);
    }
  };

  const revokeInvite = async (inv) => {
    setError(""); setStatus("");
    setBusy(true);
    const res = await revokeProjectInvite(inv.id);
    setBusy(false);
    if (!res?.success) { setError(res?.error || 'Could not revoke invite.'); return; }
    setStatus('Invite revoked.');
    refresh();
  };

  const resendInvite = async (inv) => {
    setError(""); setStatus("");
    setBusy(true);
    const res = await resendProjectInvite(inv.id, {
      projectName,
      inviterName,
      forceNewDelivery: true,
    });
    setBusy(false);
    if (!res?.success) { setError(res?.error || 'Could not resend invite.'); return; }
    setStatus(`Invite to ${inv.target_email || 'recipient'} resent.`);
    refresh();
  };

  const toggleEdit = () => { const next = !editMode; setEditMode(next); setOpenMenu(null); if (!next) { setSelectedIds(new Set()); setBulkRoleOpen(false); } };
  const toggleSel = (id) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const sm = sortedMembers();
  const selectable = sm.filter((m) => !m.isCreator);
  const allSel = selectable.length > 0 && selectable.every(m => selectedIds.has(m.id));
  const someSel = selectedIds.size > 0;

  const ICON_BTN = (iconName, title, onClick, color, disabled) => (
    <button title={title} disabled={Boolean(disabled)} onClick={(e) => { if (disabled) return; e.stopPropagation(); onClick(); }}
      className={`hub-btn hub-btn--icon${color === DANGER ? ' is-danger' : ''}`}>
      <Icon name={iconName} size={13} />
    </button>
  );

  return (
    <>
      <DismissBarrier
        active={searchFocused}
        insideRefs={[searchRootRef]}
        onDismiss={() => {
          searchInputRef.current?.blur();
          setSearchFocused(false);
        }}
      />
      <DismissBarrier
        active={openMenu != null || openInviteMenu != null || openRoleSel != null || bulkRoleOpen}
        insideSelector="[data-manage-team-dismiss-surface='true']"
        onDismiss={() => {
          setOpenMenu(null);
          setOpenInviteMenu(null);
          setOpenRoleSel(null);
          setBulkRoleOpen(false);
        }}
      />
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(13,15,20,0.55)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110, fontFamily: "\"Helvetica Neue\", Helvetica, Arial, sans-serif" }}>
        <div role="dialog" aria-modal="true" aria-label="Manage Team" data-kal31-manage-team="true" onClick={(e) => e.stopPropagation()} style={{ width: 560, background: INK_700, border: `1px solid ${INK_500}`, borderRadius: 10, boxShadow: "0 24px 60px rgba(0,0,0,0.55)", color: BONE_100, overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "84vh" }}>
          {/* Header */}
          <div style={{ padding: "16px 18px 14px", borderBottom: `1px solid ${INK_500}`, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 3, height: 30, background: project.color || GOLD, borderRadius: 2, flex: "none", marginRight: 10 }}></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10.5, letterSpacing: 0.14, textTransform: "uppercase", color: INK_200, fontWeight: 700 }}>Manage Team</div>
              <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.015, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{project.name}</div>
            </div>
            <button onClick={() => setInviteOpen(true)} className="hub-btn hub-btn--primary">
              <Icon name="plus" size={11}/>Invite
            </button>
          </div>

          {/* Toolbar */}
          <div style={{ padding: "10px 18px", borderBottom: `1px solid ${INK_500}`, display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap" }}>
            <div ref={searchRootRef} style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: INK_800, border: `1px solid ${INK_500_FIELD}`, borderRadius: 6, padding: "0 10px", height: 28, fontSize: 12, color: INK_200, minWidth: 0 }}>
              <Icon name="search" size={13} color={INK_200}/>
              <input ref={searchInputRef} value={search} onChange={(e) => setSearch(e.target.value)} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} placeholder="Find a teammate…" style={{ background: "transparent", border: 0, outline: 0, color: BONE_100, font: "inherit", fontSize: 12, flex: 1, width: "100%", minWidth: 0 }}/>
            </div>
            {editMode && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 4, flex: "none" }}>
                <button onClick={(e) => { e.stopPropagation(); if (allSel) setSelectedIds(new Set()); else setSelectedIds(new Set(selectable.map(m => m.id))); }}
                  className="hub-btn">{allSel ? "None" : "All"}</button>
                <div style={{ position: "relative", display: "inline-flex" }}>
                  {ICON_BTN(
                    "userRole",
                    "Change role",
                    () => setBulkRoleOpen(o => !o),
                    BONE_100,
                    !someSel || busy
                  )}
                  {bulkRoleOpen && someSel && (
                    <div data-manage-team-dismiss-surface="true" onClick={(e) => e.stopPropagation()} style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 200, background: INK_700, border: `1px solid ${INK_500}`, borderRadius: 6, padding: 4, minWidth: 130, boxShadow: "0 12px 30px rgba(0,0,0,0.5)" }}>
                      {ROLES.map(r => (
                        <button key={r} onClick={() => setRoleBulk(r)} style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: 0, color: BONE_100, padding: "6px 10px", fontSize: 12, borderRadius: 4, cursor: "pointer", fontFamily: "inherit" }}>{r}</button>
                      ))}
                    </div>
                  )}
                </div>
                {ICON_BTN(
                  "mail",
                  "Copy email" + (someSel ? "s" : ""),
                  async () => {
                    const emails = memberList.filter(m => selectedIds.has(m.id)).map(m => m.email).filter(Boolean).join(", ");
                    const result = await copyTextToClipboard(emails, { surface: 'project_team_bulk_emails' });
                    if (result.ok) { setError(''); setStatus('Emails copied.'); }
                    else { setStatus(''); setError('Survey could not copy the selected emails.'); }
                  },
                  BONE_100,
                  !someSel
                )}
                {ICON_BTN(
                  "trash",
                  "Remove from team",
                  removeSelected,
                  DANGER,
                  !someSel || busy
                )}
              </div>
            )}
            <button onClick={toggleEdit} className="hub-btn hub-btn--tertiary">{editMode ? "Done" : "Edit"}</button>
          </div>

          {/* Column headers */}
          <div style={{ display: "grid", gridTemplateColumns: "30px 1fr 1fr 1fr 24px", gap: 14, alignItems: "center", padding: "8px 18px 6px", borderBottom: `1px solid ${INK_500}`, fontSize: 10.5, letterSpacing: 0.14, textTransform: "uppercase", color: INK_200, fontWeight: 700 }}>
            <span></span>
            <span onClick={() => onSort("name")} style={{ cursor: "pointer", userSelect: "none", color: sortKey === "name" ? BONE_100 : "inherit" }}>Users{arrow("name")}</span>
            <span onClick={() => onSort("role")} style={{ cursor: "pointer", userSelect: "none", color: sortKey === "role" ? BONE_100 : "inherit" }}>Role{arrow("role")}</span>
            <span onClick={() => onSort("added")} style={{ cursor: "pointer", userSelect: "none", color: sortKey === "added" ? BONE_100 : "inherit" }}>Added{arrow("added")}</span>
            <span></span>
          </div>

          {/* Member rows */}
          <div className="slim-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "6px 8px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
            {loading && sm.length === 0 && (
              <div style={{ padding: "18px 10px", color: INK_200, fontSize: 12 }}>Loading team…</div>
            )}
            {sm.map(m => {
              const checked = selectedIds.has(m.id);
              const lastOwnerLocked = !m.isCreator && String(m.role).toLowerCase() === 'owner' && ownerCount <= 1;
              return (
                <div key={m.id} data-kal31-project-member={m.userId || m.id} style={{ position: "relative" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "30px 1fr 1fr 1fr 24px", gap: 14, alignItems: "center", padding: "8px 10px", borderRadius: 6, height: 50, boxSizing: "border-box" }}>
                    <div style={{ width: 30, height: 30, borderRadius: "50%", background: m.color, color: "var(--accent-text)", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 800, flex: "none" }}>{m.initials || initialsOf(m.name)}</div>
                    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}{m.isCreator ? " · creator" : ""}</div>
                      <div className="mono" style={{ fontFamily: MONO_FONT, fontSize: 11, color: INK_200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.email}</div>
                    </div>
                    {editMode && !m.isCreator ? (
                      <div style={{ position: "relative", minWidth: 0 }}>
                        {/* UX: the role trigger's caret is the app's shared
                            chevron, rendered as a child rather than painted as a
                            background image. It used to be a bespoke 10x6 SVG
                            data URI stroked at 1.4, which resolves to 3.36 on
                            the house 24 grid — over twice the 1.5 every other
                            caret in the hub paints, so this one control carried
                            the heaviest glyph on the surface. Reference
                            behaviour matched: the archive tree's disclosure
                            caret, the same Icon in the same var(--text-3).
                            The 14px glyph replaces the 14px right padding the
                            background image sat in, so the button's box, its hit
                            area and the text's position are all unchanged.
                            Fixed 2026-09-16 (r5-icons). */}
                        <button data-kal31-role-trigger="true" onClick={(e) => { e.stopPropagation(); setOpenRoleSel(openRoleSel === m.id ? null : m.id); }}
                          className="hub-btn hub-btn--field" style={{ maxWidth: "100%" }}>{m.role}<Icon name="chevronDown" size={14} color="var(--text-3)" style={{ display: "block", flex: "none" }} /></button>
                        {openRoleSel === m.id && (
                          <div data-kal31-role-menu="true" data-manage-team-dismiss-surface="true" onClick={(e) => e.stopPropagation()} style={{ position: "absolute", left: 0, top: "calc(100% + 4px)", zIndex: 50, background: INK_700, border: `1px solid ${INK_500}`, borderRadius: 6, padding: 4, minWidth: 110, boxShadow: "0 12px 30px rgba(0,0,0,0.5)" }}>
                            {ROLES.map(r => (
                              <button key={r} data-kal31-role-option={r.toLowerCase()} disabled={busy || (lastOwnerLocked && r !== 'Owner')} onClick={() => { setRole(m.id, r); setOpenRoleSel(null); }} style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: 0, color: r === m.role ? GOLD : (lastOwnerLocked && r !== 'Owner' ? INK_300 : BONE_100), padding: "6px 10px", fontSize: 12, borderRadius: 4, cursor: busy || (lastOwnerLocked && r !== 'Owner') ? "not-allowed" : "pointer", fontFamily: "inherit" }}>{r}</button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11.5, color: BONE_200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: 14 }}>{m.role}</div>
                    )}
                    <div className="mono" style={{ fontFamily: MONO_FONT, fontSize: 11.5, color: INK_200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.added}</div>
                    {editMode ? (
                      m.isCreator ? <span /> : (
                        <span onClick={(e) => { e.stopPropagation(); toggleSel(m.id); }}
                          style={{ width: 18, height: 18, border: `1.4px solid ${checked ? GOLD : INK_500_FIELD}`, background: checked ? GOLD : "transparent", borderRadius: 3, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", justifySelf: "center" }}>
                          {checked && <Icon name="check" size={11} color="var(--accent-text)" />}
                        </span>
                      )
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); setOpenInviteMenu(null); setOpenMenu(openMenu === m.id ? null : m.id); }}
                        title="More" aria-label="More"
                        className="hub-icon-btn"><Icon name="more" size={14} /></button>
                    )}
                  </div>
                  {!editMode && openMenu === m.id && (
                    <div data-manage-team-dismiss-surface="true" onClick={(e) => e.stopPropagation()} style={{ position: "absolute", right: 14, top: 38, zIndex: 20, background: INK_700, border: `1px solid ${INK_500}`, borderRadius: 8, padding: 4, minWidth: 150, boxShadow: "0 12px 30px rgba(0,0,0,0.45)" }}>
                      {[
                        { label: "Invite user", onClick: () => { setOpenMenu(null); setInviteOpen(true); } },
                        ...(m.isCreator ? [] : [{ label: "Change role", onClick: () => { setOpenMenu(null); setEditMode(true); setOpenRoleSel(m.id); } }]),
                        { label: "View activity", onClick: () => { setOpenMenu(null); setActivityFor(m); } },
                        { label: "Copy email", disabled: !m.email, onClick: async () => {
                          setOpenMenu(null);
                          const result = await copyTextToClipboard(m.email, { surface: 'project_team_member_email' });
                          if (result.ok) { setError(''); setStatus('Email copied.'); }
                          else { setStatus(''); setError('Survey could not copy this email.'); }
                        } },
                        ...(m.isCreator ? [] : [{ label: "Remove from team", danger: true, onClick: () => { setOpenMenu(null); removeMember(m.id); } }]),
                      ].map(it => (
                        <button key={it.label} disabled={it.disabled || busy} onClick={it.onClick} style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: 0, color: it.danger ? C.dangerText : (it.disabled ? INK_300 : BONE_100), padding: "7px 10px", fontSize: 12, borderRadius: 4, cursor: it.disabled || busy ? "not-allowed" : "pointer", fontFamily: "inherit" }}>{it.label}</button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Pending invites — real rows from project_invites. */}
            {pendingInvites.map((inv) => {
              const isLink = !inv.target_email;
              const label = isLink ? 'Link invite' : inv.target_email;
              return (
                <div key={inv.id} data-kal31-project-invite={inv.id} style={{ position: "relative" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "30px 1fr 1fr 1fr 24px", gap: 14, alignItems: "center", padding: "8px 10px", borderRadius: 6, height: 50, boxSizing: "border-box", background: "var(--accent-soft)" }}>
                    <div style={{ width: 30, height: 30, borderRadius: "50%", background: isLink ? 'var(--surface-3)' : INK_200, color: isLink ? BONE_100 : "var(--accent-text)", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 800, flex: "none" }}>{isLink ? 'L' : initialsOf(inv.target_email)}</div>
                    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
                      <div className="mono" style={{ fontFamily: MONO_FONT, fontSize: 11, color: INK_200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{isLink ? buildInviteUrl(inv) : `expires ${fmtDate(inv.expires_at)}`}</div>
                    </div>
                    <div style={{ fontSize: 11.5, color: BONE_200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: 14 }}>{roleLabel(inv.intended_role)}</div>
                    <div style={{ fontSize: 11.5, color: GOLD, fontWeight: 600 }}>Pending</div>
                    <button onClick={(e) => { e.stopPropagation(); setOpenMenu(null); setOpenInviteMenu(openInviteMenu === inv.id ? null : inv.id); }}
                      title="More" aria-label="More"
                      className="hub-icon-btn"><Icon name="more" size={14} /></button>
                  </div>
                  {openInviteMenu === inv.id && (
                    <div data-manage-team-dismiss-surface="true" onClick={(e) => e.stopPropagation()} style={{ position: "absolute", right: 14, top: 38, zIndex: 20, background: INK_700, border: `1px solid ${INK_500}`, borderRadius: 8, padding: 4, minWidth: 150, boxShadow: "0 12px 30px rgba(0,0,0,0.45)" }}>
                      {[
                        { label: "Copy invite link", onClick: async () => {
                          setOpenInviteMenu(null);
                          const result = await copyTextToClipboard(buildInviteUrl(inv), { surface: 'project_pending_invite_link' });
                          if (result.ok) { setError(''); setStatus('Link copied.'); }
                          else { setStatus(''); setError('Survey could not copy this invite link.'); }
                        } },
                        ...(isLink ? [] : [{ label: "Resend invite", onClick: () => { setOpenInviteMenu(null); resendInvite(inv); } }]),
                        { label: "Revoke invite", danger: true, onClick: () => { setOpenInviteMenu(null); revokeInvite(inv); } },
                      ].map(it => (
                        <button key={it.label} disabled={busy} onClick={it.onClick} style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: 0, color: it.danger ? C.dangerText : BONE_100, padding: "7px 10px", fontSize: 12, borderRadius: 4, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit" }}>{it.label}</button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Inline feedback (real backend errors / confirmations). */}
          {(error || status) && (
            <div style={{ padding: "8px 18px", borderTop: `1px solid ${INK_500}`, background: INK_800 }}>
              {error && <div style={{ color: C.dangerText, fontSize: 12 }}>{error}</div>}
              {status && !error && <div style={{ color: GOLD, fontSize: 12 }}>{status}</div>}
            </div>
          )}

          {/* Footer */}
          <div style={{ padding: "12px 16px", borderTop: `1px solid ${INK_500}`, background: INK_800, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10.5, color: INK_200, letterSpacing: 0.06, textTransform: "uppercase", fontWeight: 700 }}>
              {memberList.length} member{memberList.length === 1 ? "" : "s"}{pendingInvites.length ? ` · ${pendingInvites.length} pending` : ""}
            </span>
            <button onClick={onClose} className="hub-btn hub-btn--primary">Done</button>
          </div>
        </div>
      </div>
      {activityFor && <ActivityModal member={activityFor} onClose={() => setActivityFor(null)}/>}
      {inviteOpen && (
        <InviteModal
          project={project}
          currentUser={currentUser}
          canInvite={canInvite}
          onChanged={refresh}
          onClose={() => { setInviteOpen(false); refresh(); }}
        />
      )}
    </>
  );
}
