/* Survey Hub — Manage Team modal + Invite / Activity sub-modals.
   Faithful 1:1 port of the Claude Design prototype (survey-hub/manage-team.jsx —
   ManageTeam, InviteModal, ActivityModal).

   Colors are literal hex (the hub palette) because this overlay renders
   outside the `.survey-hub` root, where the CSS variables are not in scope.
   Palette mapping from survey-hub/styles.css:
     --ink-800 #12151c  --ink-700 #181c24  --ink-500 #2a3140
     --ink-400 #3a4252  --ink-300 #5a6473  --ink-200 #8d96a6
     --bone-100 #f4f1ea --bone-200 #e8e2d4 --gold #d8a84e
*/
import React from 'react';
import { Icon } from './HubShell';

/* Hub palette — literal hex, see header note. */
const INK_800 = '#12151c';
const INK_700 = '#181c24';
const INK_500 = '#2a3140';
const INK_300 = '#5a6473';
const INK_200 = '#8d96a6';
const BONE_100 = '#f4f1ea';
const BONE_200 = '#e8e2d4';
const GOLD = '#d8a84e';

const ROLES = ["Owner", "Editor", "Viewer"];
const ROLE_ORDER = { Owner: 0, Editor: 1, Viewer: 2 };

/* Two-letter initials from a display name — used for the avatar glyph so the
   circle shows real initials, never a raw user id. */
const initialsOf = (name) => (name || '')
  .trim().split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase() || '—';

const MONO_FONT = '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace';

const timeToMinutes = (t) => {
  const m = /^(\d+):(\d+)\s*(AM|PM)$/i.exec(t || ""); if (!m) return 0;
  let h = parseInt(m[1]); const min = parseInt(m[2]); const pm = /PM/i.test(m[3]);
  if (h === 12) h = 0; if (pm) h += 12;
  return h * 60 + min;
};
const editedMs = (ev) => (Date.parse(ev.date) || 0) + timeToMinutes(ev.time) * 60 * 1000;

/* ============ Activity sub-modal ============ */
const ActivityModal = ({ member, onClose }) => {
  const [sortKey, setSortKey] = React.useState("edited");
  const [sortDir, setSortDir] = React.useState("desc");
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
      <div onClick={(e) => e.stopPropagation()} style={{ width: 520, background: INK_700, border: `1px solid ${INK_500}`, borderRadius: 10, boxShadow: "0 24px 60px rgba(0,0,0,0.55)", color: BONE_100, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 18px 14px", borderBottom: `1px solid ${INK_500}`, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 3, height: 30, background: member.color, borderRadius: 2, flex: "none", marginRight: 10 }}></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10.5, letterSpacing: 0.14, textTransform: "uppercase", color: INK_200, fontWeight: 700 }}>Activity</div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.015, marginTop: 4 }}>{member.name} · activity</div>
          </div>
          <button onClick={onClose} title="Close" style={{ background: "transparent", border: `1px solid ${INK_500}`, color: INK_200, width: 24, height: 24, borderRadius: 6, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, display: "grid", placeItems: "center", fontFamily: "inherit", flex: "none" }}>×</button>
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
          <button onClick={onClose} style={{ background: GOLD, color: "#15110a", border: 0, borderRadius: 6, padding: "5px 14px", height: 28, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Done</button>
        </div>
      </div>
    </div>
  );
};

/* ============ Invite User sub-modal ============ */
const InviteModal = ({ project, onClose }) => {
  const [emails, setEmails] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const [linkRole, setLinkRole] = React.useState("Viewer");
  const [emailRole, setEmailRole] = React.useState("Editor");
  const url = `survey.hub/p/${(project.code || "p").toLowerCase()}/invite?role=${linkRole.toLowerCase()}`;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(13,15,20,0.55)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 130, fontFamily: "\"Helvetica Neue\", Helvetica, Arial, sans-serif" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 440, background: INK_700, border: `1px solid ${INK_500}`, borderRadius: 10, boxShadow: "0 24px 60px rgba(0,0,0,0.55)", color: BONE_100, overflow: "hidden" }}>
        <div style={{ padding: "16px 18px 14px", borderBottom: `1px solid ${INK_500}`, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 3, height: 30, background: project.color, borderRadius: 2, flex: "none", marginRight: 10 }}></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10.5, letterSpacing: 0.14, textTransform: "uppercase", color: INK_200, fontWeight: 700 }}>Invite User</div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.015, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{project.name}</div>
          </div>
          <button onClick={onClose} title="Close" style={{ background: "transparent", border: `1px solid ${INK_500}`, color: INK_200, width: 24, height: 24, borderRadius: 6, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, display: "grid", placeItems: "center", fontFamily: "inherit", flex: "none" }}>×</button>
        </div>
        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <div style={{ fontSize: 10.5, letterSpacing: 0.14, textTransform: "uppercase", color: INK_200, fontWeight: 700, marginBottom: 8 }}>Share link</div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 96px 82px", gap: 6 }}>
              <div className="mono" style={{ fontFamily: MONO_FONT, flex: 1, minWidth: 0, background: INK_800, border: `1px solid ${INK_500}`, borderRadius: 6, padding: "0 11px", height: 30, display: "flex", alignItems: "center", fontSize: 11.5, color: BONE_200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{url}</div>
              <select value={linkRole} onChange={(e) => setLinkRole(e.target.value)} style={{ height: 30, background: INK_700, color: BONE_100, border: `1px solid ${INK_500}`, borderRadius: 6, padding: "0 8px", fontSize: 11.5, fontFamily: "inherit" }}>
                <option>Viewer</option>
                <option>Editor</option>
                <option>Owner</option>
              </select>
              <button onClick={() => { navigator.clipboard && navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); }} style={{ flex: "none", height: 30, whiteSpace: "nowrap", background: INK_700, color: BONE_100, border: `1px solid ${INK_500}`, borderRadius: 6, padding: "0 11px", fontSize: 11.5, cursor: "pointer", fontFamily: "inherit", boxSizing: "border-box" }}>{copied ? "Copied" : "Copy link"}</button>
            </div>
            <div style={{ fontSize: 11, color: INK_200, marginTop: 8, lineHeight: 1.4 }}>Anyone with this link can request {linkRole} access. Free users enter as Viewer until upgrade.</div>
          </div>
          <div>
            <div style={{ fontSize: 10.5, letterSpacing: 0.14, textTransform: "uppercase", color: INK_200, fontWeight: 700, marginBottom: 8 }}>Invite by email</div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 96px", gap: 6 }}>
              <textarea value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="name@example.com, name@example.com" rows={3} style={{ width: "100%", background: INK_800, border: `1px solid ${INK_500}`, borderRadius: 6, padding: "9px 11px", fontSize: 12.5, fontFamily: "inherit", color: BONE_100, resize: "vertical", outline: "none", minHeight: 72, lineHeight: 1.45, boxSizing: "border-box" }}/>
              <select value={emailRole} onChange={(e) => setEmailRole(e.target.value)} style={{ height: 30, alignSelf: "start", background: INK_700, color: BONE_100, border: `1px solid ${INK_500}`, borderRadius: 6, padding: "0 8px", fontSize: 11.5, fontFamily: "inherit" }}>
                <option>Viewer</option>
                <option>Editor</option>
                <option>Owner</option>
              </select>
            </div>
            <div style={{ fontSize: 11, color: INK_200, marginTop: 8, lineHeight: 1.4 }}>Separate addresses with commas. Invitees will get an email with a link to join.</div>
          </div>
        </div>
        <div style={{ padding: "12px 16px", borderTop: `1px solid ${INK_500}`, background: INK_800, display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
          <button onClick={onClose} style={{ background: "transparent", border: 0, color: INK_200, padding: "6px 10px", fontSize: 12, cursor: "pointer", fontFamily: "inherit", borderRadius: 6 }}>Cancel</button>
          <button disabled={!emails.trim()} onClick={() => onClose()} style={{ opacity: emails.trim() ? 1 : 0.45, cursor: emails.trim() ? "pointer" : "not-allowed", background: GOLD, color: "#15110a", border: 0, borderRadius: 6, padding: "5px 14px", height: 28, fontSize: 11.5, fontWeight: 600, fontFamily: "inherit" }}>Send {emailRole} invite</button>
        </div>
      </div>
    </div>
  );
};

/* ============ Manage Team modal ============ */
export default function ManageTeamModal({ open, onClose, project, members }) {
  // The team list is the project's real team — no invented teammates. Today
  // that is just the owner; a real teammates feature will add more later.
  const [memberList, setMembers] = React.useState(() => (Array.isArray(members) ? members : []));
  const [editMode, setEditMode] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState(() => new Set());
  const [openMenu, setOpenMenu] = React.useState(null);
  const [openRoleSel, setOpenRoleSel] = React.useState(null);
  const [bulkRoleOpen, setBulkRoleOpen] = React.useState(false);
  const [activityFor, setActivityFor] = React.useState(null);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [sortKey, setSortKey] = React.useState("default");
  const [sortDir, setSortDir] = React.useState("asc");

  React.useEffect(() => {
    const onDoc = () => { setOpenMenu(null); setOpenRoleSel(null); setBulkRoleOpen(false); };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  // Re-sync the list when the project (and so its real team) changes.
  React.useEffect(() => {
    setMembers(Array.isArray(members) ? members : []);
  }, [members]);

  if (!open) return null;

  const sortedMembers = () => {
    const arr = memberList.slice();
    if (sortKey === "default") {
      arr.sort((a, b) => {
        const r = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
        if (r !== 0) return r;
        return Date.parse(a.added) - Date.parse(b.added);
      });
      return arr;
    }
    const sign = sortDir === "asc" ? 1 : -1;
    if (sortKey === "name") arr.sort((a, b) => sign * a.name.localeCompare(b.name));
    else if (sortKey === "role") arr.sort((a, b) => sign * (ROLE_ORDER[a.role] - ROLE_ORDER[b.role]) || Date.parse(a.added) - Date.parse(b.added));
    else if (sortKey === "added") arr.sort((a, b) => sign * (Date.parse(a.added) - Date.parse(b.added)));
    return arr;
  };
  const onSort = (k) => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir(k === "added" ? "desc" : "asc"); }
  };
  const arrow = (k) => sortKey === k ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const setRole = (id, role) => setMembers(prev => prev.map(m => m.id === id ? { ...m, role } : m));
  const removeMember = (id) => setMembers(prev => prev.filter(m => m.id !== id));
  const removeSelected = () => { setMembers(prev => prev.filter(m => !selectedIds.has(m.id))); setSelectedIds(new Set()); };
  const setRoleBulk = (role) => { setMembers(prev => prev.map(m => selectedIds.has(m.id) ? { ...m, role } : m)); setBulkRoleOpen(false); };
  const toggleEdit = () => { const next = !editMode; setEditMode(next); setOpenMenu(null); if (!next) { setSelectedIds(new Set()); setBulkRoleOpen(false); } };
  const toggleSel = (id) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const sm = sortedMembers();
  const allSel = sm.length > 0 && sm.every(m => selectedIds.has(m.id));
  const someSel = selectedIds.size > 0;

  const ICON_BTN = (path, title, onClick, color, disabled) => (
    <button title={title} onClick={(e) => { if (disabled) return; e.stopPropagation(); onClick(); }}
      style={{ width: 28, height: 28, borderRadius: 6, padding: 0, background: "transparent", border: `1px solid ${INK_500}`, color: disabled ? INK_300 : color, display: "grid", placeItems: "center", cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit", flex: "none" }}>
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{path}</svg>
    </button>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(13,15,20,0.55)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110, fontFamily: "\"Helvetica Neue\", Helvetica, Arial, sans-serif" }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: 560, background: INK_700, border: `1px solid ${INK_500}`, borderRadius: 10, boxShadow: "0 24px 60px rgba(0,0,0,0.55)", color: BONE_100, overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "84vh" }}>
          {/* Header */}
          <div style={{ padding: "16px 18px 14px", borderBottom: `1px solid ${INK_500}`, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 3, height: 30, background: project.color, borderRadius: 2, flex: "none", marginRight: 10 }}></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10.5, letterSpacing: 0.14, textTransform: "uppercase", color: INK_200, fontWeight: 700 }}>Manage Team</div>
              <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.015, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{project.name}</div>
            </div>
            <button onClick={() => setInviteOpen(true)} style={{ flex: "none", background: GOLD, color: "#15110a", border: 0, borderRadius: 6, padding: "5px 11px", height: 28, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon name="plus" size={11}/>Invite
            </button>
          </div>

          {/* Toolbar */}
          <div style={{ padding: "10px 18px", borderBottom: `1px solid ${INK_500}`, display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap" }}>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: INK_800, border: `1px solid ${INK_500}`, borderRadius: 6, padding: "0 10px", height: 28, fontSize: 12, color: INK_200, minWidth: 0 }}>
              <Icon name="search" size={13} color={INK_200}/>
              <input placeholder="Find a teammate…" style={{ background: "transparent", border: 0, outline: 0, color: BONE_100, font: "inherit", fontSize: 12, flex: 1, width: "100%", minWidth: 0 }}/>
            </div>
            {editMode && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 4, flex: "none" }}>
                <button onClick={(e) => { e.stopPropagation(); if (allSel) setSelectedIds(new Set()); else setSelectedIds(new Set(sm.map(m => m.id))); }}
                  style={{ padding: "0 8px", height: 28, fontSize: 11.5, background: INK_700, color: BONE_100, border: `1px solid ${INK_500}`, borderRadius: 6, cursor: "pointer", fontFamily: "inherit", boxSizing: "border-box" }}>{allSel ? "None" : "All"}</button>
                <div style={{ position: "relative", display: "inline-flex" }}>
                  {ICON_BTN(
                    <><circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0"/><path d="m17 12 5 0M22 8l-5 8"/></>,
                    "Change role",
                    () => setBulkRoleOpen(o => !o),
                    BONE_100,
                    !someSel
                  )}
                  {bulkRoleOpen && someSel && (
                    <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 200, background: INK_700, border: `1px solid ${INK_500}`, borderRadius: 6, padding: 4, minWidth: 130, boxShadow: "0 12px 30px rgba(0,0,0,0.5)" }}>
                      {ROLES.map(r => (
                        <button key={r} onClick={() => setRoleBulk(r)} style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: 0, color: BONE_100, padding: "6px 10px", fontSize: 12, borderRadius: 4, cursor: "pointer", fontFamily: "inherit" }}>{r}</button>
                      ))}
                    </div>
                  )}
                </div>
                {ICON_BTN(
                  <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>,
                  "Copy email" + (someSel ? "s" : ""),
                  () => { const emails = memberList.filter(m => selectedIds.has(m.id)).map(m => m.email).join(", "); if (navigator.clipboard) navigator.clipboard.writeText(emails); },
                  BONE_100,
                  !someSel
                )}
                {ICON_BTN(
                  <><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M10 11v6M14 11v6"/></>,
                  "Remove from team",
                  removeSelected,
                  "#cf6f6f",
                  !someSel
                )}
              </div>
            )}
            <button onClick={toggleEdit} className="btn link" style={{ flex: "none", background: "transparent", border: 0, color: GOLD, fontWeight: 600, fontSize: 11.5, padding: "4px 8px", cursor: "pointer", fontFamily: "inherit", height: "auto" }}>{editMode ? "Done" : "Edit"}</button>
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
            {sm.map(m => {
              const checked = selectedIds.has(m.id);
              return (
                <div key={m.id} style={{ position: "relative" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "30px 1fr 1fr 1fr 24px", gap: 14, alignItems: "center", padding: "8px 10px", borderRadius: 6, height: 50, boxSizing: "border-box" }}>
                    <div style={{ width: 30, height: 30, borderRadius: "50%", background: m.color, color: "#15110a", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 800, flex: "none" }}>{m.initials || initialsOf(m.name)}</div>
                    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</div>
                      <div className="mono" style={{ fontFamily: MONO_FONT, fontSize: 11, color: INK_200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.email}</div>
                    </div>
                    {editMode ? (
                      <div style={{ position: "relative", minWidth: 0 }}>
                        <button onClick={(e) => { e.stopPropagation(); setOpenRoleSel(openRoleSel === m.id ? null : m.id); }}
                          style={{ background: "transparent", border: 0, padding: "0 14px 0 0", color: BONE_200, font: "inherit", fontFamily: "inherit", fontSize: 11.5, height: 24, lineHeight: "24px", textAlign: "left", cursor: "pointer", width: "max-content", maxWidth: "100%", whiteSpace: "nowrap", backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='%238d96a6' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/></svg>\")", backgroundRepeat: "no-repeat", backgroundPosition: "right center" }}>{m.role}</button>
                        {openRoleSel === m.id && (
                          <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", left: 0, top: "calc(100% + 4px)", zIndex: 50, background: INK_700, border: `1px solid ${INK_500}`, borderRadius: 6, padding: 4, minWidth: 110, boxShadow: "0 12px 30px rgba(0,0,0,0.5)" }}>
                            {ROLES.map(r => (
                              <button key={r} onClick={() => { setRole(m.id, r); setOpenRoleSel(null); }} style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: 0, color: r === m.role ? GOLD : BONE_100, padding: "6px 10px", fontSize: 12, borderRadius: 4, cursor: "pointer", fontFamily: "inherit" }}>{r}</button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11.5, color: BONE_200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: 14 }}>{m.role}</div>
                    )}
                    <div className="mono" style={{ fontFamily: MONO_FONT, fontSize: 11.5, color: INK_200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.added}</div>
                    {editMode ? (
                      <span onClick={(e) => { e.stopPropagation(); toggleSel(m.id); }}
                        style={{ width: 18, height: 18, border: `1.4px solid ${checked ? GOLD : INK_500}`, background: checked ? GOLD : "transparent", borderRadius: 3, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", justifySelf: "center" }}>
                        {checked && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#15110a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4.5 4.5L20 6"/></svg>}
                      </span>
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === m.id ? null : m.id); }}
                        title="More"
                        style={{ width: 24, height: 24, borderRadius: 6, padding: 0, background: "transparent", border: 0, color: INK_200, cursor: "pointer", fontSize: 16, lineHeight: 1, fontFamily: "inherit" }}>⋯</button>
                    )}
                  </div>
                  {!editMode && openMenu === m.id && (
                    <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", right: 14, top: 38, zIndex: 20, background: INK_700, border: `1px solid ${INK_500}`, borderRadius: 8, padding: 4, minWidth: 150, boxShadow: "0 12px 30px rgba(0,0,0,0.45)" }}>
                      {[
                        { label: "Invite User", onClick: () => { setOpenMenu(null); setInviteOpen(true); } },
                        { label: "Change role", onClick: () => { setOpenMenu(null); setEditMode(true); setOpenRoleSel(m.id); } },
                        { label: "View activity", onClick: () => { setOpenMenu(null); setActivityFor(m); } },
                        { label: "Copy email", onClick: () => { setOpenMenu(null); if (navigator.clipboard) navigator.clipboard.writeText(m.email); } },
                        { label: "Remove from team", danger: true, onClick: () => { setOpenMenu(null); removeMember(m.id); } },
                      ].map(it => (
                        <button key={it.label} onClick={it.onClick} style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: 0, color: it.danger ? "#cf6f6f" : BONE_100, padding: "7px 10px", fontSize: 12, borderRadius: 4, cursor: "pointer", fontFamily: "inherit" }}>{it.label}</button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div style={{ padding: "12px 16px", borderTop: `1px solid ${INK_500}`, background: INK_800, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10.5, color: INK_200, letterSpacing: 0.06, textTransform: "uppercase", fontWeight: 700 }}>{memberList.length} member{memberList.length === 1 ? "" : "s"}</span>
            <button onClick={onClose} style={{ background: GOLD, color: "#15110a", border: 0, borderRadius: 6, padding: "5px 14px", height: 28, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Done</button>
          </div>
        </div>
      </div>
      {activityFor && <ActivityModal member={activityFor} onClose={() => setActivityFor(null)}/>}
      {inviteOpen && <InviteModal project={project} onClose={() => setInviteOpen(false)}/>}
    </>
  );
}
