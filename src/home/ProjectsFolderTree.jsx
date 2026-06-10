/* Survey Hub — Projects tab.
   Faithful port of the Claude Design prototype (survey-hub/projects-new.jsx,
   Projects_FolderTree): a Finder-style tree — a left list of every project,
   a right panel showing the open project's files plus a team.

   The markup, styling, spacing, columns, select-mode toolbars and per-row
   menus mirror the mockup element for element. Only the data is swapped.

   Teammate data: the hub feeds a `members` directory of
   { id, name, role, color, online }. Each project carries members:[memberId]
   and each document carries owner:memberId — so the left avatar stacks, the
   team panel and the "Last edited by" column render the true prototype
   behavior. All fall back gracefully when member data is absent.

   Interaction model: every button and menu is wired to LOCAL React state —
   there is no backend. New Project / Duplicate / Delete mutate a local copy
   of the project list; file menu actions (Copy/Paste/Share/Details), Add
   files, select-mode toolbars and drag-reorder all visibly change state.
   The per-project "more" menu and the file-row "more" menu are rendered as
   fixed-position popups via createPortal to document.body, anchored to the
   trigger button's bounding rect — so no parent's overflow:hidden/auto can
   clip them or force a scrollbar. Because the portal renders OUTSIDE the
   `.survey-hub` root, those popups use literal hex colors, not CSS vars.
*/
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { HubShell, Icon, Avatar, AvatarStack, Search } from './HubShell';
import ManageTeamModal from './ManageTeamModal';
import { MoveCopyModal } from './BulkModals';
import DragRearrangeHandle from '../reorder/DragRearrangeHandle';
import { SortableRearrangeList, SortableRearrangeRow } from '../reorder/SortableRearrangeList';
import { pickByIds } from './selectionById';

/* Literal palette — used by the portal popups, which render outside the
   `.survey-hub` root and therefore cannot inherit its CSS variables. */
const HEX = {
  card: '#181c24',   // --ink-700  popup surface
  deep: '#12151c',   // --ink-800
  rule: '#2a3140',   // --ink-500  borders
  ink: '#f4f1ea',    // --bone-100 primary text
  muted: '#8d96a6',  // --ink-200  secondary text
  gold: '#d8a84e',   // --gold     accent
  danger: '#cf6f6f', // destructive action
};

/* Inline pin icon — HubShell's Icon set has no `pin` glyph, so a small
   self-contained SVG is used for the "Pin project" menu item and the
   pinned-row grabber replacement. Stroke inherits the caller's color. */
const PinIcon = ({ size = 12, color = 'currentColor' }) => (
  <svg
    viewBox="0 0 24 24" width={size} height={size}
    style={{ fill: 'none', stroke: color, strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }}
  >
    <path d="M12 17v5" />
    <path d="M9 10.76V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v5.76l2 3.24H7z" />
  </svg>
);

const editedMs = (d) => Date.parse(d?.updated_at || d?.created_at || 0) || 0;
const shortWhen = (d) => {
  const ms = editedMs(d);
  if (!ms) return '—';
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return '1d ago';
  if (days < 30) return days + 'd ago';
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/* Two-letter initials from a display name — "Isaiah Calvo" -> "IC". Avatar
   glyphs render this so the circle shows real initials, never a raw user id. */
const initialsOf = (name) => (name || '')
  .trim().split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase() || '—';

let LOCAL_ID = 1;
const nextLocalId = () => `local-${Date.now()}-${LOCAL_ID++}`;

/* Fixed-position popup menu, portalled to <body>.
   Anchored to `anchorRect` (a getBoundingClientRect() snapshot of the trigger
   button) so it floats cleanly over the page — immune to any ancestor's
   overflow clipping. `align` decides which corner of the anchor it hangs from. */
function PopupMenu({ anchorRect, onClose, items, align = 'right', minWidth = 160 }) {
  const ref = useRef(null);

  useEffect(() => {
    const onDocDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    // Defer attach so the click that opened the menu doesn't immediately close it.
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onDocDown, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDocDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  if (!anchorRect) return null;

  // Hang below the trigger; flip up if it would run off the bottom.
  const estHeight = items.length * 34 + 8;
  let top = anchorRect.bottom + 4;
  if (top + estHeight > window.innerHeight - 8) {
    top = Math.max(8, anchorRect.top - estHeight - 4);
  }
  let left = align === 'right'
    ? anchorRect.right - minWidth
    : anchorRect.left;
  left = Math.max(8, Math.min(left, window.innerWidth - minWidth - 8));

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{
        position: 'fixed', top, left, zIndex: 4000,
        background: HEX.card, border: `1px solid ${HEX.rule}`, borderRadius: 8,
        padding: 4, minWidth, boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
      }}
    >
      {items.map((it) => (
        <button
          key={it.label}
          role="menuitem"
          disabled={it.disabled}
          onClick={() => { if (it.disabled) return; onClose(); it.onClick && it.onClick(); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
            background: 'transparent', border: 0,
            color: it.disabled ? HEX.muted : (it.danger ? HEX.danger : HEX.ink),
            padding: '7px 10px', fontSize: 12, borderRadius: 4,
            cursor: it.disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => { if (!it.disabled) e.currentTarget.style.background = HEX.rule; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          {it.iconNode
            ? it.iconNode
            : (it.icon && <Icon name={it.icon} size={12} color={it.danger ? HEX.danger : HEX.muted} />)}
          {it.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

export default function ProjectsFolderTree({
  projects = [],
  documents = [],
  members = [],
  user = null,
  templatesLocked = false,
  onNav,
  onOpenDocument,
  onCreateProject,
  onUpload,
  onDeleteProjects,
  onDeleteDocuments,
  onLockDocument,
  onShare,
  onShareDocument,
}) {
  const [search, setSearch] = useState('');

  // Local, mutable copy of the project list. Seeded from the `projects` prop
  // and re-synced when the prop changes; New Project / Duplicate / Delete /
  // rename / reorder all mutate THIS list so the UI visibly responds with no
  // backend. `localProjects` is the single source of truth for rendering.
  const [localProjects, setLocalProjects] = useState(projects);
  useEffect(() => { setLocalProjects(projects); }, [projects]);

  // Local, mutable copy of documents — Add files / file duplicate / file
  // delete / file reorder mutate this so file rows visibly change.
  const [localDocs, setLocalDocs] = useState(documents);
  useEffect(() => { setLocalDocs(documents); }, [documents]);

  const [openId, setOpenId] = useState(projects[0]?.id ?? null);
  const [jobsEdit, setJobsEdit] = useState(false);
  const [selProj, setSelProj] = useState(() => new Set());
  const [fileSelect, setFileSelect] = useState(false);
  const [selFiles, setSelFiles] = useState(() => new Set());

  // Pasteboard for the file-row Copy/Paste menu — Copy stows a document here,
  // Paste clones it into the open project.
  const [clipboard, setClipboard] = useState(null);

  // Move/Copy picker — opened by the file select-mode "Move/Copy" button.
  // Holds the document ids of the files to move or copy. Ids (never indices)
  // so the picks survive a list reorder/rebuild while the modal is open.
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveIds, setMoveIds] = useState([]);

  // Open-menu state: each holds { id, rect } so the portalled PopupMenu knows
  // what to anchor to. `null` when closed.
  const [teamMenu, setTeamMenu] = useState(null); // { id, rect }
  const [fileMenu, setFileMenu] = useState(null); // { id, rect }

  // Manage Project modal — controlled entirely by local state. Opened by the
  // header "Manage Team" button and the per-project menu's "Manage project".
  const [teamModalProject, setTeamModalProject] = useState(null);

  // Pinned-project ids. A pinned project sorts to the TOP of the left list
  // and shows a pin icon in place of its drag grabber. Local-only state.
  const [pinnedIds, setPinnedIds] = useState(() => new Set());
  const togglePin = useCallback((id) => setPinnedIds((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  }), []);

  // Hidden <input type="file"> for the real OS file picker. Add files /
  // Upload files programmatically .click() this; the picked File objects are
  // mapped into the open project's document list. `pendingPickProject` holds
  // which project the picked files should land in.
  const fileInputRef = useRef(null);
  const pendingPickProject = useRef(null);

  // Drag-reorder bookkeeping.
  const [draggingProjectId, setDraggingProjectId] = useState(null);
  const [dragOverProjectId, setDragOverProjectId] = useState(null);
  const [draggingFileId, setDraggingFileId] = useState(null);
  const [dragOverFileId, setDragOverFileId] = useState(null);

  // Selection is keyed by document id (never array index) so a reorder or
  // re-derive of `openFiles` between selecting and acting can't retarget the
  // bulk actions. Actions resolve ids → docs at action time via pickByIds.
  const toggleFileSel = (id) => setSelFiles((prev) => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const toggleProjSel = (id) => setSelProj((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const selCount = selProj.size;

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return localProjects.filter((p) => !q || (p.name || '').toLowerCase().includes(q));
  }, [localProjects, search]);

  const filtered = useMemo(() => (
    // Pinned projects float to the TOP; relative order within each group
    // (pinned / unpinned) is preserved via a stable sort.
    filteredProjects
      .map((p, i) => ({ p, i }))
      .sort((a, b) => {
        const ap = pinnedIds.has(a.p.id) ? 0 : 1;
        const bp = pinnedIds.has(b.p.id) ? 0 : 1;
        return ap - bp || a.i - b.i;
      })
      .map((x) => x.p)
  ), [filteredProjects, pinnedIds]);

  useEffect(() => {
    if (filtered.length && !filtered.some((p) => p.id === openId)) setOpenId(filtered[0].id);
  }, [filtered, openId]);

  const open = filtered.find((p) => p.id === openId) || filtered[0] || null;
  const openFiles = useMemo(
    () => (open ? localDocs.filter((d) => d.project_id === open.id) : []),
    [localDocs, open],
  );

  // Member directory lookup — resolves a memberId to its { name, role, color,
  // online } record so avatars/team render the true owner + collaborators.
  //
  // Every project has at least one real member: its owner, the signed-in user.
  // There is no teammates table yet, so the directory is seeded from the
  // current user (as Owner). Any real collaborator records passed by the host
  // are merged on top. No mock people are ever invented here.
  const ownerMember = useMemo(() => (
    user?.id != null
      ? {
          id: user.id,
          name: user.name || user.email?.split('@')[0] || 'You',
          email: user.email || '',
          role: 'Owner',
          // Literal gold (not a CSS var): the Manage Team modal renders
          // outside the `.survey-hub` root where CSS vars are not in scope.
          color: '#d8a84e',
          online: true,
        }
      : null
  ), [user]);

  const memberById = useMemo(() => {
    const map = new Map();
    if (ownerMember) map.set(ownerMember.id, ownerMember);
    members.forEach((m) => { if (m && m.id != null) map.set(m.id, m); });
    return map;
  }, [members, ownerMember]);
  const lookupMember = (id) => memberById.get(id) || null;

  // Team member-ids for a project — owner first, then any real collaborator
  // ids carried on the project row, deduped. A project's owner is the row's
  // `user_id` (or `members[0]` for a freshly created local project); it falls
  // back to the signed-in user so a project is never owner-less / empty.
  const projectTeam = useCallback((proj) => {
    if (!proj) return [];
    const projMembers = Array.isArray(proj.members) ? proj.members : [];
    const ownerId = proj.user_id ?? projMembers[0] ?? user?.id ?? null;
    const ids = [];
    if (ownerId != null) ids.push(ownerId);
    projMembers.forEach((id) => { if (id != null && !ids.includes(id)) ids.push(id); });
    return ids;
  }, [user?.id]);

  // Real team-member records for the Manage Team modal — the project's team
  // resolved against the directory. No invented people: today this is just the
  // owner. Memoized so the modal keeps a stable list while it's open.
  const teamModalMembers = useMemo(() => {
    if (!teamModalProject) return [];
    const added = teamModalProject.created_at
      ? new Date(teamModalProject.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : '';
    return projectTeam(teamModalProject).map((id) => {
      const m = memberById.get(id) || null;
      const name = m?.name || 'Teammate';
      return {
        id,
        name,
        initials: m ? initialsOf(m.name) : '—',
        email: m?.email || '',
        role: m?.role || 'Member',
        color: m?.color || '#d8a84e',
        added,
      };
    });
  }, [teamModalProject, memberById, projectTeam]);

  /* ---- Project-list mutations (local state) ---------------------------- */

  const handleNewProject = useCallback(() => {
    // Defer to the host flow if provided, otherwise create a local project so
    // the button is never a dead no-op.
    if (onCreateProject) { onCreateProject(); return; }
    const id = nextLocalId();
    const proj = {
      id, name: `Untitled Project ${localProjects.length + 1}`,
      members: user?.id != null ? [user.id] : [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setLocalProjects((prev) => [proj, ...prev]);
    setOpenId(id);
  }, [onCreateProject, localProjects.length, user]);

  const duplicateProjects = useCallback((ids) => {
    setLocalProjects((prev) => {
      const out = [...prev];
      ids.forEach((id) => {
        const src = prev.find((p) => p.id === id);
        if (!src) return;
        out.push({ ...src, id: nextLocalId(), name: `${src.name} (copy)`, updated_at: new Date().toISOString() });
      });
      return out;
    });
  }, []);

  const deleteProjects = useCallback(async (ids) => {
    const set = new Set(ids);
    const selectedProjects = localProjects.filter((p) => set.has(p.id));
    if (onDeleteProjects && selectedProjects.length > 0) {
      const didDelete = await onDeleteProjects(selectedProjects);
      if (!didDelete) return;
    }
    setLocalProjects((prev) => prev.filter((p) => !set.has(p.id)));
    setLocalDocs((prev) => prev.filter((d) => !set.has(d.project_id)));
    setSelProj(new Set());
  }, [localProjects, onDeleteProjects]);

  const renameProject = useCallback((id, name) => {
    setLocalProjects((prev) => prev.map((p) => (
      p.id === id ? { ...p, name, updated_at: new Date().toISOString() } : p
    )));
  }, []);

  const reorderProjects = useCallback((fromId, toId) => {
    if (fromId == null || toId == null || fromId === toId) return;
    setLocalProjects((prev) => {
      // `filtered` may be a search subset — reorder by the actual project ids.
      const out = [...prev];
      const fi = out.findIndex((p) => p.id === fromId);
      const ti = out.findIndex((p) => p.id === toId);
      if (fi < 0 || ti < 0) return prev;
      const [moved] = out.splice(fi, 1);
      out.splice(ti, 0, moved);
      return out;
    });
  }, []);

  /* ---- Document mutations (local state) -------------------------------- */

  // Add files — opens a real OS file picker (a hidden <input type="file">).
  // `forProject` is the project the picked files should land in; it's stashed
  // on a ref so the input's onChange knows the destination.
  const addFiles = useCallback((forProject) => {
    const target = forProject || open;
    if (!target) return;
    // Real upload path: hand the destination project id to the host so the
    // file is uploaded and saved INTO that project, surviving tab switches
    // and reloads. `open: false` — a file added to a project is just saved
    // into it, not opened in the viewer. Falls back to the local OS picker
    // only when no host handler is wired (e.g. the standalone dev preview).
    if (onUpload) { onUpload(target.id, { open: false }); return; }
    pendingPickProject.current = target.id;
    if (fileInputRef.current) {
      fileInputRef.current.value = ''; // allow re-picking the same file
      fileInputRef.current.click();
    }
  }, [open, onUpload]);

  // Receives the real File objects chosen in the OS picker and maps each into
  // the document shape, attaching them to the pending project.
  const handleFilesPicked = useCallback((fileList) => {
    const projId = pendingPickProject.current;
    const files = Array.from(fileList || []);
    if (projId == null || files.length === 0) return;
    const proj = localProjects.find((p) => p.id === projId);
    const now = new Date().toISOString();
    const docs = files.map((file) => ({
      id: nextLocalId(),
      name: file.name,
      file_size: file.size,
      project_id: projId,
      owner: user?.id ?? (proj?.members?.[0] ?? null),
      created_at: now,
      updated_at: now,
    }));
    setLocalDocs((prev) => [...prev, ...docs]);
  }, [localProjects, user]);

  const duplicateFiles = useCallback((docIds) => {
    if (!open) return;
    const clones = pickByIds(openFiles, docIds)
      .map((f) => ({ ...f, id: nextLocalId(), name: `${f.name} (copy)`, updated_at: new Date().toISOString() }));
    if (clones.length) setLocalDocs((prev) => [...prev, ...clones]);
  }, [open, openFiles]);

  const deleteFiles = useCallback((docIds) => {
    const targets = pickByIds(openFiles, docIds);
    if (targets.length === 0) return;
    // Real delete: hand the documents to the host so they are removed from
    // Supabase and STAY deleted across tab switches and reloads. The host
    // refreshes the document list, which re-syncs this view. Falls back to a
    // local-only removal when no host handler is wired (dev preview).
    if (onDeleteDocuments) {
      onDeleteDocuments(targets);
      setSelFiles(new Set());
      return;
    }
    const ids = new Set(targets.map((d) => d.id).filter((x) => x != null));
    setLocalDocs((prev) => prev.filter((d) => !ids.has(d.id)));
    setSelFiles(new Set());
  }, [openFiles, onDeleteDocuments]);

  const reorderFiles = useCallback((fromId, toId) => {
    if (fromId == null || toId == null || fromId === toId || !open) return;
    setLocalDocs((prev) => {
      // Split docs into this project's slice (in display order) and the rest,
      // reorder the slice, then stitch back together.
      const slice = [];
      const rest = [];
      prev.forEach((d) => { (d.project_id === open.id ? slice : rest).push(d); });
      const from = slice.findIndex((d) => d.id === fromId);
      const to = slice.findIndex((d) => d.id === toId);
      if (from < 0 || to < 0) return prev;
      const [moved] = slice.splice(from, 1);
      slice.splice(to, 0, moved);
      return [...rest, ...slice];
    });
  }, [open]);

  // Move or copy the given document ids to a destination project. 'move'
  // re-parents the originals; 'copy' clones them into the destination and
  // leaves the originals in place. Ids are resolved against the OPEN
  // project's current files — a stale id (doc deleted/moved meanwhile) is a
  // silent no-op, never a wrong target.
  const moveCopyFiles = useCallback((docIds, destId, mode) => {
    if (!open || destId == null) return;
    const ids = new Set(pickByIds(openFiles, docIds).map((d) => d.id));
    if (ids.size === 0) return;
    setLocalDocs((prev) => {
      if (mode === 'copy') {
        const clones = prev
          .filter((d) => ids.has(d.id))
          .map((d) => ({
            ...d, id: nextLocalId(), project_id: destId,
            updated_at: new Date().toISOString(),
          }));
        return [...prev, ...clones];
      }
      return prev.map((d) => (
        ids.has(d.id)
          ? { ...d, project_id: destId, updated_at: new Date().toISOString() }
          : d
      ));
    });
    setSelFiles(new Set());
  }, [open, openFiles]);

  const copyFile = useCallback((f) => { if (f) setClipboard(f); }, []);
  const pasteFile = useCallback(() => {
    if (!clipboard || !open) return;
    setLocalDocs((prev) => [
      ...prev,
      { ...clipboard, id: nextLocalId(), project_id: open.id, name: `${clipboard.name} (copy)`, updated_at: new Date().toISOString() },
    ]);
  }, [clipboard, open]);

  /* ---- Render ---------------------------------------------------------- */

  const subtitle = (
    <span><b>{filtered.length}</b> projects · expand any to see its files and team</span>
  );
  const actions = <Search placeholder="Search Projects..." value={search} onChange={setSearch} />;

  return (
    <HubShell
      tab="projects"
      onNav={onNav}
      title="Projects"
      subtitle={subtitle}
      actions={actions}
      userName={user?.name || user?.email?.split('@')[0] || 'You'}
      templatesLocked={templatesLocked}
    >
      <div style={{ padding: '0 8px 8px 8px', display: 'grid', gridTemplateColumns: '260px 1fr', gap: 8, flex: 1, minHeight: 0 }}>
        {/* LEFT — tree */}
        <div className="card" style={{ padding: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '4px 6px 6px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              className="btn primary"
              style={{ padding: '4px 8px', fontSize: 11, gap: 4, whiteSpace: 'nowrap', alignSelf: 'flex-start' }}
              onClick={handleNewProject}
            >
              <Icon name="plus" size={11} />New Project
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'nowrap', height: 22, overflow: 'hidden' }}>
              <button
                onClick={() => { const next = !jobsEdit; setJobsEdit(next); if (!next) setSelProj(new Set()); }}
                style={{ background: 'transparent', border: 0, color: 'var(--gold)', borderRadius: 2, padding: '2px 5px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', fontWeight: 600, lineHeight: 1 }}
              >
                {jobsEdit ? 'Done' : 'Select'}
              </button>
              {jobsEdit && (
                <>
                  {(() => {
                    const allSel = selCount === filtered.length && filtered.length > 0;
                    return (
                      <button
                        onClick={() => setSelProj(allSel ? new Set() : new Set(filtered.map((p) => p.id)))}
                        style={{ background: 'transparent', border: '1px solid var(--ink-500)', color: 'var(--bone-100)', borderRadius: 2, padding: '2px 5px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                      >{allSel ? 'None' : 'All'}</button>
                    );
                  })()}
                  {/* Duplicate — clones each selected project into the local list. */}
                  <button
                    disabled={!selCount}
                    onClick={() => { duplicateProjects([...selProj]); setSelProj(new Set()); }}
                    style={{ background: 'transparent', border: '1px solid var(--ink-500)', color: selCount ? 'var(--bone-100)' : 'var(--ink-300)', borderRadius: 2, padding: '2px 5px', fontSize: 10, cursor: selCount ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                  >Duplicate</button>
                  {/* Share — opens the share flow for the first selected project. */}
                  <button
                    disabled={!selCount}
                    onClick={() => { const first = filtered.find((p) => selProj.has(p.id)); if (first) onShare && onShare(first); }}
                    style={{ background: 'transparent', border: '1px solid var(--ink-500)', color: selCount ? 'var(--bone-100)' : 'var(--ink-300)', borderRadius: 2, padding: '2px 5px', fontSize: 10, cursor: selCount ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center' }}
                    title="Share"
                  ><Icon name="share" size={11} /></button>
                  {/* Delete — removes each selected project and lets the host persist it when wired. */}
                  <button
                    disabled={!selCount}
                    onClick={() => { void deleteProjects([...selProj]); }}
                    style={{ background: 'transparent', border: '1px solid var(--ink-500)', color: selCount ? '#cf6f6f' : 'var(--ink-300)', borderRadius: 2, padding: '2px 5px', fontSize: 10, cursor: selCount ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center' }}
                    title="Delete"
                  ><Icon name="trash" size={11} /></button>
                </>
              )}
            </div>
          </div>
          <div className="slim-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 4 }}>
            {filtered.length === 0 && (
              <div className="meta" style={{ fontSize: 11.5, padding: '14px 8px' }}>
                {localProjects.length === 0 ? 'No projects yet — create one to group your documents.' : 'No projects match your search.'}
              </div>
            )}
            <SortableRearrangeList ids={filtered.map((p) => p.id)} onReorder={reorderProjects}>
            {filtered.map((p) => {
              const isOpen = open && p.id === open.id;
              const isSel = selProj.has(p.id);
              const isPinned = pinnedIds.has(p.id);
              const projMembers = projectTeam(p);
              return (
                <SortableRearrangeRow
                  key={p.id}
                  id={p.id}
                >
                  {({ attributes, listeners, isDragging }) => (
                  <div
                    data-drag-rearrange-row
                    onClick={() => { if (jobsEdit) toggleProjSel(p.id); else setOpenId(p.id); }}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '28px 1fr auto',
                      gap: 8, alignItems: 'center',
                      padding: '8px 8px', borderRadius: 6,
                      background: dragOverProjectId === p.id && draggingProjectId !== p.id
                        ? 'rgba(216,168,78,0.10)'
                        : jobsEdit ? (isSel ? 'var(--ink-600)' : 'transparent') : (isOpen ? 'var(--ink-600)' : 'transparent'),
                      cursor: isDragging ? 'grabbing' : 'pointer',
                      borderLeft: !jobsEdit && isOpen ? '2px solid var(--gold)' : '2px solid transparent',
                      height: 50, boxSizing: 'border-box',
                      opacity: isDragging ? 0.82 : 1,
                      transition: isDragging ? 'none' : 'background 0.15s ease, opacity 0.15s ease',
                    }}
                  >
                    {/* Drag handle / pin marker. Only the handle starts
                        reorder, leaving the rest of the row free for opening
                        or select-mode selection. When the project is pinned,
                        the grabber is replaced by a gold pin icon. */}
                    {isPinned ? (
                      <span title="Pinned" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                        <PinIcon size={12} color="var(--gold)" />
                      </span>
                    ) : (
                      <DragRearrangeHandle
                        {...attributes}
                        {...listeners}
                        isDragging={isDragging}
                      />
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{p.name}</div>
                      {/* Owner-avatar stack (first 3 team members) + member
                          count. Every project shows at least the owner glyph —
                          ids are resolved to real initials, never shown raw. */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                        <AvatarStack
                          members={projMembers.slice(0, 3).map((id) => initialsOf(lookupMember(id)?.name))}
                          size={14}
                        />
                        <span className="mono meta" style={{ fontSize: 9.5 }}>{projMembers.length}</span>
                      </div>
                    </div>
                    {jobsEdit ? (
                      <span
                        onClick={(e) => { e.stopPropagation(); toggleProjSel(p.id); }}
                        style={{ width: 14, height: 14, border: `1.4px solid ${isSel ? 'var(--gold)' : 'var(--ink-300)'}`, background: isSel ? 'var(--gold)' : 'transparent', borderRadius: 2, padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 4 }}
                      >
                        {isSel && <span style={{ color: '#15110a', fontSize: 10, lineHeight: 1 }}>✓</span>}
                      </span>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          // Toggle the portalled popup; snapshot the trigger's
                          // rect so the menu anchors to it.
                          const rect = e.currentTarget.getBoundingClientRect();
                          setFileMenu(null);
                          setTeamMenu((cur) => (cur && cur.id === p.id ? null : { id: p.id, rect }));
                        }}
                        style={{ background: 'transparent', border: 0, color: 'var(--ink-200)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '2px 4px', borderRadius: 4 }}
                        title="More"
                      >⋯</button>
                    )}
                  </div>
                  )}
                </SortableRearrangeRow>
              );
            })}
            </SortableRearrangeList>
          </div>
        </div>

        {/* RIGHT — open project */}
        <div className="card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {open && (
            <>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--ink-500)', display: 'flex', alignItems: 'center', gap: 14 }}>
                <span style={{ width: 4, height: 36, background: 'var(--gold)', borderRadius: 2, flex: 'none' }}></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Inline rename field — commits the new name to local state
                      on blur / Enter so the tree and header stay in sync. */}
                  <input
                    key={open.id}
                    defaultValue={open.name}
                    title="Click to rename"
                    onDoubleClick={(e) => e.currentTarget.select()}
                    style={{
                      background: 'transparent', color: 'var(--bone-100)',
                      border: 0, borderBottom: '1px dashed transparent',
                      padding: '2px 0', fontSize: 22, fontWeight: 700, letterSpacing: '-0.015em',
                      outline: 'none', width: '100%', cursor: 'text', fontFamily: 'inherit',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderBottomColor = 'var(--ink-500)'; }}
                    onMouseLeave={(e) => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.borderBottomColor = 'transparent'; }}
                    onFocus={(e) => { e.currentTarget.style.borderBottom = '1px solid var(--gold)'; }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderBottom = '1px dashed transparent';
                      const name = e.currentTarget.value.trim();
                      if (name && name !== open.name) renameProject(open.id, name);
                      else e.currentTarget.value = open.name;
                    }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8, flex: 'none' }}>
                  {/* Add files — opens the OS file picker; picked PDFs are
                      added to this project's document list. */}
                  <button className="btn" onClick={() => addFiles(open)}><Icon name="upload" size={12} />Add files</button>
                  {/* Manage Team — opens the Manage Team modal (NOT the share
                      link modal) for the currently open project. */}
                  <button className="btn" onClick={() => setTeamModalProject(open)}><Icon name="users" size={12} />Manage Team</button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 148px', gap: 0, flex: 1, overflow: 'hidden' }}>
                {/* Files */}
                <div className="slim-scroll" style={{ padding: '10px 14px', overflow: 'auto', position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 22, marginBottom: 4, overflow: 'hidden', flexWrap: 'nowrap', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 10.5, letterSpacing: 0.06, textTransform: 'uppercase', color: 'var(--ink-200)', fontWeight: 700 }}>Files</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 'none' }}>
                      {fileSelect && (() => {
                        // Effective selection is DERIVED from the current rows
                        // — never the raw id set, which may hold stale ids of
                        // docs that were removed/moved since being checked.
                        const selectedFiles = openFiles.filter((f) => selFiles.has(f.id));
                        const c = selectedFiles.length;
                        const allSel = c === openFiles.length && openFiles.length > 0;
                        const baseBtn = { background: 'transparent', border: '1px solid var(--ink-500)', borderRadius: 2, padding: '1px 7px', fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', height: 18, lineHeight: 1, boxSizing: 'border-box' };
                        return (
                          <>
                            <button
                              onClick={() => setSelFiles(allSel ? new Set() : new Set(openFiles.map((f) => f.id)))}
                              style={{ ...baseBtn, color: 'var(--bone-100)' }}
                            >{allSel ? 'None' : 'All'}</button>
                            {/* Duplicate — clones each selected file in place. */}
                            <button
                              disabled={!c}
                              onClick={() => { duplicateFiles(selectedFiles.map((f) => f.id)); setSelFiles(new Set()); }}
                              style={{ ...baseBtn, color: c ? 'var(--bone-100)' : 'var(--ink-300)', cursor: c ? 'pointer' : 'not-allowed' }}
                            >Duplicate</button>
                            {/* Move/Copy — opens the Move/Copy picker so the
                                user chooses a destination project and moves or
                                copies the selected files there. */}
                            <button
                              disabled={!c}
                              onClick={() => {
                                if (!c) return;
                                setMoveIds(selectedFiles.map((f) => f.id));
                                setMoveOpen(true);
                              }}
                              style={{ ...baseBtn, color: c ? 'var(--bone-100)' : 'var(--ink-300)', cursor: c ? 'pointer' : 'not-allowed' }}
                            >Move/Copy</button>
                            {/* Share — opens the share flow for this project. */}
                            <button
                              disabled={!c}
                              onClick={() => onShare && onShare(open)}
                              style={{ ...baseBtn, color: c ? 'var(--bone-100)' : 'var(--ink-300)', cursor: c ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center' }}
                              title="Share"
                            ><Icon name="share" size={11} /></button>
                            {/* Delete — removes each selected file locally. */}
                            <button
                              disabled={!c}
                              onClick={() => deleteFiles(selectedFiles.map((f) => f.id))}
                              style={{ ...baseBtn, color: c ? '#cf6f6f' : 'var(--ink-300)', cursor: c ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center' }}
                              title="Delete"
                            ><Icon name="trash" size={11} /></button>
                          </>
                        );
                      })()}
                      <button
                        onClick={() => { const next = !fileSelect; setFileSelect(next); if (!next) setSelFiles(new Set()); }}
                        style={{ background: 'transparent', border: 0, color: 'var(--gold)', borderRadius: 2, padding: '2px 5px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', fontWeight: 600, lineHeight: 1 }}
                      >
                        {fileSelect ? 'Done' : 'Select'}
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 90px 90px 28px', gap: 12, padding: '0 10px 6px', fontSize: 10, color: 'var(--ink-200)', letterSpacing: 0.06, textTransform: 'uppercase' }}>
                    <span></span><span>Name</span><span>Last edited by</span><span>Edited</span><span></span>
                  </div>
                  {openFiles.length === 0 ? (
                    <div className="meta" style={{ fontSize: 11.5, padding: '12px 10px' }}>No files in this project yet.</div>
                  ) : (
                    <SortableRearrangeList ids={openFiles.map((f) => f.id)} onReorder={reorderFiles}>
                    <div style={{ display: 'grid', gap: 1 }}>
                      {openFiles.map((f, i) => {
                        const isChecked = selFiles.has(f.id);
                        // "Last edited by" owner — the document's own user id
                        // when present, else the project owner. Resolved to a
                        // real member so the avatar shows true initials.
                        const ownerId = f.user_id ?? f.owner ?? projectTeam(open)[0] ?? null;
                        const owner = lookupMember(ownerId);
                        const ownerInitials = owner ? initialsOf(owner.name) : '—';
                        const ownerFirst = owner?.name?.split(' ')[0] || '—';
                        return (
                          <SortableRearrangeRow
                            key={f.id}
                            id={f.id}
                          >
                            {({ attributes, listeners, isDragging }) => (
                          <div
                            data-drag-rearrange-row
                            onClick={() => { if (fileSelect) { toggleFileSel(f.id); return; } onOpenDocument && onOpenDocument(f); }}
                            style={{
                              background: dragOverFileId === f.id && draggingFileId !== f.id
                                ? 'rgba(216,168,78,0.10)'
                                : fileSelect && isChecked ? 'rgba(216,168,78,0.10)' : (i % 2 ? 'transparent' : 'rgba(255,255,255,0.02)'),
                              borderRadius: 6,
                              display: 'grid', gridTemplateColumns: '24px 1fr 90px 90px 28px',
                              gap: 12, alignItems: 'center', padding: '8px 10px', fontSize: 12,
                              height: 42, boxSizing: 'border-box',
                              cursor: isDragging ? 'grabbing' : 'pointer',
                              opacity: isDragging ? 0.82 : 1,
                              transition: isDragging ? 'none' : 'background 0.15s ease, opacity 0.15s ease',
                            }}
                          >
                            <DragRearrangeHandle
                              {...attributes}
                              {...listeners}
                              isDragging={isDragging}
                              style={{ width: 24, height: 24 }}
                            />
                            <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                            {/* "Last edited by" — file's owner resolved against
                                the member directory: avatar + first name. */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                              <Avatar initials={ownerInitials} size={18} color={owner?.color} />
                              <span className="meta" style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ownerFirst}</span>
                            </div>
                            <span className="mono meta" style={{ fontSize: 11 }}>{shortWhen(f)}</span>
                            {fileSelect ? (
                              <span
                                onClick={(e) => { e.stopPropagation(); toggleFileSel(f.id); }}
                                style={{ width: 14, height: 14, border: `1.4px solid ${isChecked ? 'var(--gold)' : 'var(--ink-300)'}`, background: isChecked ? 'var(--gold)' : 'transparent', borderRadius: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', justifySelf: 'center' }}
                              >
                                {isChecked && <span style={{ color: '#15110a', fontSize: 10, lineHeight: 1 }}>✓</span>}
                              </span>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // Toggle the portalled file menu, anchored to
                                  // this trigger button's rect.
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setTeamMenu(null);
                                  setFileMenu((cur) => (cur && cur.id === f.id ? null : { id: f.id, rect }));
                                }}
                                style={{ background: 'transparent', border: 0, color: 'var(--ink-200)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 6px', borderRadius: 4 }}
                                title="More"
                              >⋯</button>
                            )}
                          </div>
                            )}
                          </SortableRearrangeRow>
                        );
                      })}
                    </div>
                    </SortableRearrangeList>
                  )}
                </div>

                {/* Team — project members resolved against the member
                    directory: avatar + name + role + online status dot. */}
                <div className="slim-scroll" style={{ borderLeft: '1px solid var(--ink-500)', padding: '12px 12px', background: 'var(--ink-800)', overflow: 'auto' }}>
                  <div className="section-label" style={{ marginBottom: 10 }}>Team</div>
                  {(() => {
                    // The team is always non-empty: a project owns at least
                    // its owner (the signed-in user). Real collaborators, when
                    // a teammates feature exists, append after the owner.
                    const team = projectTeam(open);
                    if (team.length === 0) {
                      return (
                        <div className="meta" style={{ fontSize: 10.5, lineHeight: 1.5 }}>
                          Sign in to see this project's owner.
                        </div>
                      );
                    }
                    return (
                      <div style={{ display: 'grid', gap: 8 }}>
                        {team.map((m) => {
                          const mem = lookupMember(m);
                          const memName = mem?.name || 'Teammate';
                          return (
                            <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <Avatar initials={mem ? initialsOf(mem.name) : '—'} size={22} color={mem?.color} />
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{memName}</div>
                                <div className="meta" style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: mem?.online ? 'var(--green)' : 'var(--ink-300)', flex: 'none' }}></span>
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{mem?.role || 'Member'}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </>
          )}
          {!open && (
            <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--ink-200)', fontSize: 13 }}>
              No projects yet — create one to group your documents.
            </div>
          )}
        </div>
      </div>

      {/* Per-project "more" menu — portalled to <body>, fixed-positioned from
          the trigger rect, so no ancestor overflow can clip it. */}
      {teamMenu && (() => {
        const proj = filtered.find((p) => p.id === teamMenu.id);
        if (!proj) return null;
        const projPinned = pinnedIds.has(proj.id);
        return (
          <PopupMenu
            anchorRect={teamMenu.rect}
            onClose={() => setTeamMenu(null)}
            minWidth={184}
            items={[
              // "Add member" opens the invite/share popup — same flow as
              // "Get link to project". Only "Manage project" opens the modal.
              { icon: 'users', label: 'Add member', onClick: () => onShare && onShare(proj) },
              { icon: 'arrow-r', label: 'Get link to project', onClick: () => onShare && onShare(proj) },
              { icon: 'upload', label: 'Upload files', onClick: () => { setOpenId(proj.id); addFiles(proj); } },
              {
                // Pin / unpin — toggles local pinned state; the row floats to
                // the top of the list and shows a pin icon when pinned.
                iconNode: <PinIcon size={12} color={projPinned ? HEX.gold : HEX.muted} />,
                label: projPinned ? 'Unpin project' : 'Pin project',
                onClick: () => togglePin(proj.id),
              },
              { icon: 'more', label: 'Manage project', onClick: () => setTeamModalProject(proj) },
            ]}
          />
        );
      })()}

      {/* File-row "more" menu — also portalled + fixed-positioned. Resolved
          by document id at render time: if the doc vanished (deleted, moved,
          list rebuilt) while the menu was open, it renders nothing rather
          than retargeting a different row. */}
      {fileMenu && (() => {
        const f = openFiles.find((d) => d.id === fileMenu.id);
        if (!f) return null;
        const locked = f.locked_at != null;
        const canLock = user?.id && f.user_id === user.id;
        return (
          <PopupMenu
            anchorRect={fileMenu.rect}
            onClose={() => setFileMenu(null)}
            minWidth={168}
            items={[
              { label: 'Copy', onClick: () => copyFile(f) },
              { label: 'Paste', disabled: !clipboard, onClick: () => pasteFile() },
              { label: 'Delete', danger: true, onClick: () => deleteFiles([fileMenu.id]) },
              { label: 'Share', onClick: () => onShareDocument ? onShareDocument([f]) : onShare && onShare(open) },
              {
                label: locked ? 'Unlock Document' : 'Lock Document',
                disabled: !canLock,
                onClick: () => onLockDocument && onLockDocument(f),
              },
            ]}
          />
        );
      })()}

      {/* Manage Team modal — open state driven entirely by local React state.
          This is the team-management surface, distinct from the share modal. */}
      <ManageTeamModal
        open={!!teamModalProject}
        onClose={() => setTeamModalProject(null)}
        project={teamModalProject}
        members={teamModalMembers}
      />

      {/* Hidden OS file picker — Add files / Upload files programmatically
          .click() this. Picked File objects are mapped into local docs. */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="application/pdf"
        style={{ display: 'none' }}
        onChange={(e) => { handleFilesPicked(e.target.files); e.target.value = ''; }}
      />

      {/* Move/Copy picker — opened by the file select-mode "Move/Copy" button.
          On confirm it moves or copies the chosen files into the destination
          project, mutating local document state. */}
      <MoveCopyModal
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        projects={localProjects}
        count={pickByIds(openFiles, moveIds).length}
        onConfirm={(destId, mode) => { moveCopyFiles(moveIds, destId, mode); }}
      />
    </HubShell>
  );
}
