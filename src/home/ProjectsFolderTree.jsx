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

   Interaction model: the component keeps an optimistic local mirror for
   responsiveness, while host callbacks persist project/document mutations.
   Standalone preview mode falls back to local-only behavior.
   The per-project "more" menu and the file-row "more" menu are rendered as
   fixed-position popups via createPortal to document.body, anchored to the
   trigger button's bounding rect — so no parent's overflow:hidden/auto can
   clip them or force a scrollbar. Because the portal renders OUTSIDE the
   `.survey-hub` root, those popups use literal hex colors, not CSS vars.
*/
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { mergeProjectDocumentOrder, orderDocumentsByProject } from './projectDocumentOrder.js';
import { HubShell, Icon, Avatar, AvatarStack, Search, EmptyState } from './HubShell';
import ManageTeamModal from './ManageTeamModal';
import { listProjectCollaboratorsForProjects } from '../services/projectInviteService';
import { MoveCopyModal } from './BulkModals';
import DragRearrangeHandle from '../reorder/DragRearrangeHandle';
import { SortableRearrangeList, SortableRearrangeRow } from '../reorder/SortableRearrangeList';
import { pickByIds } from './selectionById';
import useMobileEdgeSwipeBack from './useMobileEdgeSwipeBack';
import DismissBarrier from '../components/DismissBarrier';

/* Literal palette — used by the portal popups, which render outside the
   `.survey-hub` root and therefore cannot inherit its CSS variables. */
const HEX = {
  card: 'var(--surface-2)',   // --ink-700  popup surface
  deep: 'var(--surface-1)',   // --ink-800
  rule: 'var(--border)',   // --ink-500  borders
  ink: 'var(--text-1)',    // --bone-100 primary text
  muted: 'var(--text-3)',  // --ink-200  secondary text
  gold: 'var(--accent)',   // --gold     accent
  danger: 'var(--danger)', // destructive action
};

/* Inline pin icon — HubShell's Icon set has no `pin` glyph, so a small
   self-contained SVG is used for the "Pin project" menu item and the
   pinned-row grabber replacement. Stroke inherits the caller's color.
   Stroke weight is the house 1.5 (owner ruling 2026-09-16: one stroke
   weight for every chrome glyph; guarded by chromeInlineIconStyleStroke). */
const PinIcon = ({ size = 12, color = 'currentColor' }) => (
  <svg
    viewBox="0 0 24 24" width={size} height={size}
    style={{ fill: 'none', stroke: color, strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}
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

/* Project rows use the same team summary on desktop and mobile. Keeping this
   shared prevents mobile from substituting file or activity metadata. */
const ProjectTeamSummary = ({ memberIds, lookupMember }) => (
  <div
    className="project-team-summary"
    aria-label={`${memberIds.length} team ${memberIds.length === 1 ? 'member' : 'members'}`}
    style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, marginTop: 3 }}
  >
    <AvatarStack
      members={memberIds.slice(0, 3).map((id) => initialsOf(lookupMember(id)?.name))}
      size={14}
    />
    <span className="mono meta" style={{ fontSize: 9.5 }}>{memberIds.length}</span>
  </div>
);

let LOCAL_ID = 1;
const nextLocalId = () => `local-${Date.now()}-${LOCAL_ID++}`;
const orderByStoredIds = (rows, storedIds = []) => {
  if (!Array.isArray(storedIds) || storedIds.length === 0) return rows;
  const rank = new Map(storedIds.map((id, index) => [id, index]));
  return [...rows].sort((a, b) => {
    const aRank = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
    const bRank = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
    return aRank - bRank;
  });
};
/* Fixed-position popup menu, portalled to <body>.
   Anchored to `anchorRect` (a getBoundingClientRect() snapshot of the trigger
   button) so it floats cleanly over the page — immune to any ancestor's
   overflow clipping. `align` decides which corner of the anchor it hangs from. */
function PopupMenu({ anchorRect, onClose, items, align = 'right', minWidth = 160 }) {
  const ref = useRef(null);

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
    <>
      <DismissBarrier insideRefs={[ref]} onDismiss={onClose} />
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
      </div>
    </>,
    document.body,
  );
}

export default function ProjectsFolderTree({
  projects = [],
  documents = [],
  members = [],
  user = null,
  templatesLocked = false,
  initialMobileOpen = false,
  onNav,
  onOpenDocument,
  onCreateProject,
  onRenameProject,
  onUpload,
  onDeleteProjects,
  onDuplicateProjects,
  onDuplicateDocuments,
  onMoveCopyDocuments,
  projectPreferences = {},
  onProjectPreferencesChange,
  onDeleteDocuments,
  onLockDocument,
  onShare,
  onShareDocument,
}) {
  const [search, setSearch] = useState('');
  const [fileSearch, setFileSearch] = useState('');

  // Optimistic project mirror, reconciled from durable host data and the
  // user's persisted display order.
  const [localProjects, setLocalProjects] = useState(projects);
  useEffect(() => {
    setLocalProjects(orderByStoredIds(projects, projectPreferences.projectOrder));
  }, [projects, projectPreferences.projectOrder]);

  // Optimistic document mirror, reconciled from durable host data/order.
  const [localDocs, setLocalDocs] = useState(documents);
  useEffect(() => {
    setLocalDocs(orderDocumentsByProject(documents, projectPreferences.documentOrderByProject));
  }, [documents, projectPreferences.documentOrderByProject]);

  const [openId, setOpenId] = useState(projects[0]?.id ?? null);
  const [mobileProjectLayout, setMobileProjectLayout] = useState('drill');
  const [mobileDrillOpenId, setMobileDrillOpenId] = useState(() => (
    initialMobileOpen ? (projects[0]?.id ?? null) : null
  ));
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
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

  // Project ordering/pins are user preferences (persisted by the host).
  const [pinnedIds, setPinnedIds] = useState(() => new Set(projectPreferences.pinnedIds || []));
  useEffect(() => setPinnedIds(new Set(projectPreferences.pinnedIds || [])), [projectPreferences.pinnedIds]);
  const togglePin = useCallback((id) => {
    const next = new Set(pinnedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setPinnedIds(next);
    onProjectPreferencesChange?.({ pinnedIds: [...next] });
  }, [pinnedIds, onProjectPreferencesChange]);

  // Hidden <input type="file"> for the real OS file picker. Add files /
  // Upload files programmatically .click() this; the picked File objects are
  // mapped into the open project's document list. `pendingPickProject` holds
  // which project the picked files should land in.
  const fileInputRef = useRef(null);
  const pendingPickProject = useRef(null);

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

  useEffect(() => {
    if (mobileDrillOpenId && !filtered.some((p) => p.id === mobileDrillOpenId)) {
      setMobileDrillOpenId(null);
    }
  }, [filtered, mobileDrillOpenId]);

  const open = filtered.find((p) => p.id === openId) || filtered[0] || null;
  const openFiles = useMemo(
    () => (open ? localDocs.filter((d) => d.project_id === open.id) : []),
    [localDocs, open],
  );
  const mobileDrillProject = mobileDrillOpenId
    ? filtered.find((p) => p.id === mobileDrillOpenId) || null
    : null;
  const mobileSwipeSurfaceRef = useRef(null);
  const closeMobileProject = useCallback(() => {
    setMobileDrillOpenId(null);
    setFileMenu(null);
    setFileSelect(false);
    setFileSearch('');
    setSelFiles(new Set());
  }, []);
  const captureMobileProjectList = useMobileEdgeSwipeBack({
    enabled: Boolean(mobileDrillProject) && !teamModalProject,
    onBack: closeMobileProject,
    surfaceRef: mobileSwipeSurfaceRef,
  });
  const mobileDrillAllFiles = useMemo(
    () => (mobileDrillProject ? localDocs.filter((d) => d.project_id === mobileDrillProject.id) : []),
    [localDocs, mobileDrillProject],
  );
  const mobileDrillFiles = useMemo(() => {
    const q = fileSearch.trim().toLowerCase();
    if (!q) return mobileDrillAllFiles;
    return mobileDrillAllFiles.filter((d) => (d.name || '').toLowerCase().includes(q));
  }, [mobileDrillAllFiles, fileSearch]);
  const recentFiles = useMemo(
    () => [...localDocs].sort((a, b) => editedMs(b) - editedMs(a)).slice(0, 6),
    [localDocs],
  );
  const projectFileCount = useCallback(
    (projectId) => localDocs.filter((d) => d.project_id === projectId).length,
    [localDocs],
  );
  const projectLastEditedLabel = useCallback((projectId) => {
    const ms = localDocs
      .filter((d) => d.project_id === projectId)
      .reduce((max, d) => Math.max(max, editedMs(d)), 0);
    return ms ? shortWhen({ updated_at: new Date(ms).toISOString() }) : 'No files';
  }, [localDocs]);
  const projectById = useMemo(() => {
    const map = new Map();
    localProjects.forEach((p) => { if (p?.id != null) map.set(p.id, p); });
    return map;
  }, [localProjects]);
  const projectNameForFile = useCallback(
    (file) => projectById.get(file?.project_id)?.name || 'No project',
    [projectById],
  );

  // Real collaborators — one bulk query against `project_collaborators`
  // (viewer-gated SELECT via RLS) for every uuid-backed project in the list.
  // Local-only projects (numeric ids from nextLocalId) are skipped so the
  // uuid column never sees a bad cast. Failure degrades to owner-only teams.
  const [collabByProject, setCollabByProject] = useState(() => new Map());
  useEffect(() => {
    let cancelled = false;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ids = localProjects.map((p) => p.id).filter((id) => typeof id === 'string' && UUID_RE.test(id));
    if (!ids.length) { setCollabByProject(new Map()); return undefined; }
    (async () => {
      const { data } = await listProjectCollaboratorsForProjects(ids);
      if (cancelled) return;
      const map = new Map();
      (data || []).forEach((row) => {
        if (!map.has(row.project_id)) map.set(row.project_id, []);
        map.get(row.project_id).push(row);
      });
      setCollabByProject(map);
    })();
    return () => { cancelled = true; };
  }, [localProjects]);

  // Member directory lookup — resolves a memberId to its { name, role, color,
  // online } record so avatars/team render the true owner + collaborators.
  //
  // Every project has at least one real member: its owner, the signed-in user.
  // The directory is seeded from the current user (as Owner), any host-passed
  // records, and the real `project_collaborators` rows fetched above. No mock
  // people are ever invented here.
  const ownerMember = useMemo(() => (
    user?.id != null
      ? {
          id: user.id,
          name: user.name || user.email?.split('@')[0] || 'You',
          email: user.email || '',
          role: 'Owner',
          // Literal gold (not a CSS var): the Manage Team modal renders
          // outside the `.survey-hub` root where CSS vars are not in scope.
          color: 'var(--accent)',
          online: true,
        }
      : null
  ), [user]);

  // Deterministic avatar colors for real collaborators (owner keeps gold).
  const COLLAB_COLORS = ['#5fbf83', '#7aa2f7', '#b48ead', '#8fbcbb', '#cf9f6f'];
  const collabColor = (seed) => {
    const s = String(seed || '');
    let h = 0;
    for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return COLLAB_COLORS[h % COLLAB_COLORS.length];
  };

  const memberById = useMemo(() => {
    const map = new Map();
    if (ownerMember) map.set(ownerMember.id, ownerMember);
    members.forEach((m) => { if (m && m.id != null) map.set(m.id, m); });
    // Real collaborator rows → directory records (name from the stored email
    // prefix; role capitalized). Owner/host records take precedence.
    collabByProject.forEach((rows) => {
      rows.forEach((r) => {
        if (r?.user_id == null || map.has(r.user_id)) return;
        const name = (r.email || '').split('@')[0] || 'Teammate';
        const role = String(r.role || 'viewer');
        map.set(r.user_id, {
          id: r.user_id,
          name,
          email: r.email || '',
          role: role.charAt(0).toUpperCase() + role.slice(1),
          color: collabColor(r.user_id),
          online: false,
        });
      });
    });
    return map;
  }, [members, ownerMember, collabByProject]);
  const lookupMember = (id) => memberById.get(id) || null;

  // Team member-ids for a project — owner first, then real collaborator rows
  // from `project_collaborators`, then any ids carried on the project row,
  // deduped. A project's owner is the row's `user_id` (or `members[0]` for a
  // freshly created local project); it falls back to the signed-in user so a
  // project is never owner-less / empty.
  const projectTeam = useCallback((proj) => {
    if (!proj) return [];
    const projMembers = Array.isArray(proj.members) ? proj.members : [];
    const rawOwnerId = proj.user_id ?? null;
    const ownerId = rawOwnerId != null && memberById.has(rawOwnerId)
      ? rawOwnerId
      : (projMembers[0] ?? user?.id ?? rawOwnerId ?? null);
    const ids = [];
    if (ownerId != null) ids.push(ownerId);
    (collabByProject.get(proj.id) || []).forEach((r) => {
      if (r?.user_id != null && !ids.includes(r.user_id)) ids.push(r.user_id);
    });
    projMembers.forEach((id) => { if (id != null && !ids.includes(id)) ids.push(id); });
    return ids;
  }, [user?.id, memberById, collabByProject]);

  // Seed member records for the Manage Team modal — owner first, resolved
  // against the directory. The modal fetches its own live collaborator +
  // pending-invite rows; this seed mainly supplies the creator row (which is
  // implicit owner and not a `project_collaborators` row). Memoized so the
  // modal keeps a stable list while it's open.
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
        color: m?.color || 'var(--accent)',
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

  const duplicateProjects = useCallback(async (ids) => {
    const targets = pickByIds(localProjects, ids);
    if (onDuplicateProjects && targets.length > 0) {
      await onDuplicateProjects(targets);
      setSelProj(new Set());
      return;
    }
    setLocalProjects((prev) => {
      const out = [...prev];
      ids.forEach((id) => {
        const src = prev.find((p) => p.id === id);
        if (!src) return;
        out.push({ ...src, id: nextLocalId(), name: `${src.name} (copy)`, updated_at: new Date().toISOString() });
      });
      return out;
    });
  }, [localProjects, onDuplicateProjects]);

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
    const project = localProjects.find((item) => item.id === id);
    setLocalProjects((prev) => prev.map((p) => (
      p.id === id ? { ...p, name, updated_at: new Date().toISOString() } : p
    )));
    if (project && onRenameProject) void onRenameProject(project, name);
  }, [localProjects, onRenameProject]);

  /* Renaming a project is an EDIT, so it offers the same Cancel / Save pair
     Templates does, in the same place — the header's subtitle row (owner,
     2026-09-22). Before this, the name field committed silently on blur: there
     was no way to back out of a half-typed name and nothing told you the name
     had already changed. `nameDraft` holds the pending text for one project;
     while it differs from the saved name the pair appears. Enter saves, Escape
     cancels, and the pair is the only other way out — blur no longer commits,
     because a Save button that does not have to be pressed is a lie.
     Everything else on this screen (reordering files, team membership,
     preferences) still saves the moment you do it, so none of those raise the
     pair. */
  const [nameDraft, setNameDraft] = useState(null); // { id, value } | null
  const draftProject = nameDraft ? (projectById.get(nameDraft.id) || null) : null;
  const nameDirty = !!(draftProject && nameDraft.value.trim() && nameDraft.value.trim() !== draftProject.name);
  const editProjectName = useCallback((id, value) => setNameDraft({ id, value }), []);
  const cancelProjectName = useCallback(() => setNameDraft(null), []);
  const saveProjectName = useCallback(() => {
    setNameDraft((draft) => {
      if (!draft) return null;
      const name = draft.value.trim();
      const project = projectById.get(draft.id);
      if (project && name && name !== project.name) renameProject(draft.id, name);
      return null;
    });
  }, [projectById, renameProject]);
  // A draft belongs to one project. Once that project is no longer the one on
  // screen (desktop panel or phone drill-down), the draft is dropped rather
  // than carried across to another project's name.
  const draftOwnerIds = `${open?.id ?? ''}|${mobileDrillProject?.id ?? ''}`;
  useEffect(() => {
    setNameDraft((draft) => (draft && !draftOwnerIds.split('|').includes(String(draft.id)) ? null : draft));
  }, [draftOwnerIds]);
  const projectNameField = (project) => ({
    value: nameDraft && nameDraft.id === project.id ? nameDraft.value : project.name,
    onChange: (e) => editProjectName(project.id, e.target.value),
    onKeyDown: (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveProjectName(); e.currentTarget.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelProjectName(); e.currentTarget.blur(); }
    },
  });
  const projectSaveRow = (className) => (nameDirty ? (
    <span className={className}>
      <button type="button" className="hub-btn" onClick={cancelProjectName}>Cancel</button>
      <button type="button" className="hub-btn hub-btn--primary" onClick={saveProjectName}>Save</button>
    </span>
  ) : null);

  const reorderProjects = useCallback((fromId, toId) => {
    if (fromId == null || toId == null || fromId === toId) return;
    const out = [...localProjects];
    const fi = out.findIndex((p) => p.id === fromId);
    const ti = out.findIndex((p) => p.id === toId);
    if (fi < 0 || ti < 0) return;
    const [moved] = out.splice(fi, 1);
    out.splice(ti, 0, moved);
    setLocalProjects(out);
    onProjectPreferencesChange?.({ projectOrder: out.map((project) => project.id) });
  }, [localProjects, onProjectPreferencesChange]);

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

  const duplicateFiles = useCallback(async (docIds) => {
    if (!open) return;
    const targets = pickByIds(openFiles, docIds);
    if (onDuplicateDocuments && targets.length > 0) {
      await onDuplicateDocuments(targets, open.id);
      setSelFiles(new Set());
      return;
    }
    const clones = targets.map((file) => {
      const cloneId = nextLocalId();
      return { ...file, id: cloneId, name: `${file.name} (copy)`, updated_at: new Date().toISOString() };
    });
    if (clones.length) setLocalDocs((prev) => [...prev, ...clones]);
  }, [open, openFiles, onDuplicateDocuments]);

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
    const slice = localDocs.filter((document) => document.project_id === open.id);
    const rest = localDocs.filter((document) => document.project_id !== open.id);
    const from = slice.findIndex((document) => document.id === fromId);
    const to = slice.findIndex((document) => document.id === toId);
    if (from < 0 || to < 0) return;
    const [moved] = slice.splice(from, 1);
    slice.splice(to, 0, moved);
    setLocalDocs([...rest, ...slice]);
    onProjectPreferencesChange?.((currentPreferences) => (
      mergeProjectDocumentOrder(
        currentPreferences,
        open.id,
        slice.map((document) => document.id),
      )
    ));
  }, [localDocs, open, onProjectPreferencesChange]);

  // Move or copy the given document ids to a destination project. 'move'
  // re-parents the originals; 'copy' clones them into the destination and
  // leaves the originals in place. Ids are resolved against the OPEN
  // project's current files — a stale id (doc deleted/moved meanwhile) is a
  // silent no-op, never a wrong target.
  const moveCopyFiles = useCallback(async (docIds, destId, mode) => {
    if (!open || destId == null) return;
    const targets = pickByIds(openFiles, docIds);
    const ids = new Set(targets.map((d) => d.id));
    if (ids.size === 0) return;
    if (onMoveCopyDocuments) {
      await onMoveCopyDocuments(targets, destId, mode);
      setSelFiles(new Set());
      return;
    }
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
  }, [open, openFiles, onMoveCopyDocuments]);

  const copyFile = useCallback((f) => { if (f) setClipboard(f); }, []);
  const pasteFile = useCallback(async () => {
    if (!clipboard || !open) return;
    if (onDuplicateDocuments) {
      await onDuplicateDocuments([clipboard], open.id);
      return;
    }
    setLocalDocs((prev) => [
      ...prev,
      { ...clipboard, id: nextLocalId(), project_id: open.id, name: `${clipboard.name} (copy)`, updated_at: new Date().toISOString() },
    ]);
  }, [clipboard, open, onDuplicateDocuments]);

  /* ---- Render ---------------------------------------------------------- */

  const actions = (
    <>
      <div className="projects-mobile-search-actions hub-mobile-search-actions">
        {mobileDrillProject ? (
          <button
            type="button"
            className="projects-mobile-back-button"
            onClick={closeMobileProject}
          >
            <span className="projects-mobile-back-icon"><Icon name="arrow-r" size={13} /></span>Projects
          </button>
        ) : null}
        <Search
          placeholder={mobileDrillProject ? 'Search files...' : 'Search projects...'}
          width="100%"
          value={mobileDrillProject ? fileSearch : search}
          onChange={mobileDrillProject ? setFileSearch : setSearch}
        />
        {/* Cancel / Save take the gold action's place at the right end of this
            row while a project name is being edited — the same slot "New
            project" holds otherwise. */}
        {projectSaveRow('hub-mobile-save-row')}
        {!mobileDrillProject ? (
          <button className="btn primary projects-mobile-create-button hub-mobile-primary-action" onClick={handleNewProject}>
            <Icon name="plus" size={12} />New project
          </button>
        ) : null}
      </div>
      <div className="projects-desktop-search">
        <Search placeholder="Search projects..." value={search} onChange={setSearch} />
      </div>
    </>
  );
  const mobileProjectActions = (
    <div className="projects-mobile-select-row mobile-header-select-row">
      <button
        data-testid="project-select-toggle"
        className="mobile-header-select-button hub-btn hub-btn--tertiary"
        onClick={() => { const next = !jobsEdit; setJobsEdit(next); if (!next) setSelProj(new Set()); }}
      >
        {jobsEdit ? 'Done' : 'Select'}
      </button>
      {jobsEdit && (() => {
        const allSel = selCount === filtered.length && filtered.length > 0;
        return (
          <span className="documents-select-actions projects-mobile-select-actions mobile-header-select-actions">
            <button
              onClick={() => setSelProj(allSel ? new Set() : new Set(filtered.map((p) => p.id)))}
              className="hub-btn hub-btn--bare"
            >{allSel ? 'None' : 'All'}</button>
            <button
              disabled={!selCount}
              onClick={() => { duplicateProjects([...selProj]); setSelProj(new Set()); }}
              className="hub-btn hub-btn--bare"
            >Duplicate</button>
            <button
              disabled={!selCount}
              onClick={() => { const first = filtered.find((p) => selProj.has(p.id)); if (first) onShare && onShare(first); }}
              className="hub-btn hub-btn--icon"
              title="Share" aria-label="Share"
            ><Icon name="share" size={12} /></button>
            <button
              data-testid="delete-selected-projects"
              disabled={!selCount}
              onClick={() => { void deleteProjects([...selProj]); }}
              className="hub-btn hub-btn--icon is-danger"
              title="Delete" aria-label="Delete"
            ><Icon name="trash" size={12} /></button>
          </span>
        );
      })()}
    </div>
  );
  const mobileFileSelectRow = mobileDrillProject ? (
    <div className="projects-mobile-select-row mobile-header-select-row">
      <button
        className="mobile-header-select-button hub-btn hub-btn--tertiary"
        onClick={() => { const next = !fileSelect; setFileSelect(next); if (!next) setSelFiles(new Set()); }}
      >
        {fileSelect ? 'Done' : 'Select'}
      </button>
      {fileSelect && (() => {
        const selectedFiles = mobileDrillFiles.filter((f) => selFiles.has(f.id));
        const c = selectedFiles.length;
        const allSel = c === mobileDrillFiles.length && mobileDrillFiles.length > 0;
        return (
          <span className="documents-select-actions projects-mobile-select-actions mobile-header-select-actions">
            <button
              onClick={() => setSelFiles(allSel ? new Set() : new Set(mobileDrillFiles.map((f) => f.id)))}
              className="hub-btn hub-btn--bare"
            >{allSel ? 'None' : 'All'}</button>
            <button
              disabled={!c}
              onClick={() => { duplicateFiles(selectedFiles.map((f) => f.id)); setSelFiles(new Set()); }}
              className="hub-btn hub-btn--bare"
            >Duplicate</button>
            <button
              disabled={!c}
              onClick={() => {
                if (!c) return;
                setMoveIds(selectedFiles.map((f) => f.id));
                setMoveOpen(true);
              }}
              className="hub-btn hub-btn--bare"
            >Move/Copy</button>
            <button
              disabled={!c}
              onClick={() => onShare && onShare(mobileDrillProject)}
              className="hub-btn hub-btn--icon"
              title="Share" aria-label="Share"
            ><Icon name="share" size={12} /></button>
            <button
              disabled={!c}
              onClick={() => deleteFiles(selectedFiles.map((f) => f.id))}
              className="hub-btn hub-btn--icon is-danger"
              title="Delete" aria-label="Delete"
            ><Icon name="trash" size={12} /></button>
          </span>
        );
      })()}
    </div>
  ) : null;
  const mobileFileActions = open ? (
    <div className="projects-mobile-action-row two">
      <button className="btn" onClick={() => addFiles(open)}><Icon name="upload" size={12} />Add files</button>
      <button className="btn" onClick={() => setTeamModalProject(open)}><Icon name="users" size={12} />Team</button>
    </div>
  ) : null;
  const mobileHeaderSelectRow = mobileDrillProject ? mobileFileSelectRow : mobileProjectActions;
  const subtitle = (
    <>
      {/* The count first, then Cancel / Save when a project name is being
          edited — the same order and the same 8px gap as Templates. */}
      <span className="projects-desktop-summary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span><b>{filtered.length}</b> projects · expand any to see its files and team</span>
        {projectSaveRow('hub-desktop-save-row')}
      </span>
      <span className="projects-mobile-summary" style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10 }}>
        <span className="projects-mobile-count">
          <b>{mobileDrillProject ? mobileDrillFiles.length : filtered.length}</b> {mobileDrillProject ? 'files' : 'projects'}
        </span>
        {mobileHeaderSelectRow}
      </span>
    </>
  );
  const renderMobileFileRow = (f, keyPrefix = 'mobile-file', dragHandle = null) => {
    const isChecked = selFiles.has(f.id);
    const ownerId = f.user_id ?? f.owner ?? projectTeam(projectById.get(f.project_id))[0] ?? null;
    const owner = lookupMember(ownerId);
    /* Selected in the panel is a --surface-3 step and a gold left edge, the same
       cue the desktop file ledger uses. The check box on its own was the only
       mark a picked row carried. */
    return (
      <div
        key={`${keyPrefix}-${f.id}`}
        data-document-id={f.id}
        className={`projects-mobile-file-row ${dragHandle ? 'reorderable' : ''}${fileSelect && isChecked ? ' is-selected' : ''}`}
        onClick={() => { if (fileSelect) { toggleFileSel(f.id); return; } onOpenDocument && onOpenDocument(f); }}
      >
        {dragHandle}
        <span className="projects-mobile-file-icon"><Icon name="doc" size={15} /></span>
        <div className="projects-mobile-file-copy">
          <div>{f.name}</div>
          <span>{[projectNameForFile(f), owner?.name?.split(' ')[0], shortWhen(f)].filter(Boolean).join(' · ')}</span>
        </div>
        {fileSelect ? (
          <span
            onClick={(e) => { e.stopPropagation(); toggleFileSel(f.id); }}
            className={`projects-mobile-check ${isChecked ? 'checked' : ''}`}
          >
            {isChecked ? <Icon name="check" size={11} color="var(--accent-text)" /> : null}
          </span>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              setTeamMenu(null);
              setFileMenu((cur) => (cur && cur.id === f.id ? null : { id: f.id, rect }));
            }}
            className="hub-icon-btn"
            title="More" aria-label="More"
          ><Icon name="more" size={14} /></button>
        )}
      </div>
    );
  };

  return (
    <HubShell
      tab="projects"
      onNav={onNav}
      title="Projects"
      subtitle={subtitle}
      actions={actions}
      userName={user?.name || user?.email?.split('@')[0] || 'You'}
      templatesLocked={templatesLocked}
      mobileSwipeSurfaceRef={mobileSwipeSurfaceRef}
    >
      <div className="projects-tab-body" style={{ padding: '0 8px 8px 8px', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <div className="projects-desktop-layout" style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 8, height: '100%', minHeight: 0 }}>
        {/* LEFT — tree */}
        <div className="card" style={{ padding: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '4px 6px 6px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              className="btn primary"
              style={{ alignSelf: 'flex-start' }}
              onClick={handleNewProject}
            >
              <Icon name="plus" size={11} />New project
            </button>
            <div className="hub-select-actions" style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'nowrap', height: 22, overflow: 'hidden' }}>
              <button
                data-testid="project-select-toggle"
                onClick={() => { const next = !jobsEdit; setJobsEdit(next); if (!next) setSelProj(new Set()); }}
                className="hub-btn hub-btn--tertiary"
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
                        className="hub-btn hub-btn--bare"
                      >{allSel ? 'None' : 'All'}</button>
                    );
                  })()}
                  {/* Duplicate — clones each selected project into the local list. */}
                  <button
                    disabled={!selCount}
                    onClick={() => { duplicateProjects([...selProj]); setSelProj(new Set()); }}
                    className="hub-btn hub-btn--bare"
                  >Duplicate</button>
                  {/* Share — opens the share flow for the first selected project. */}
                  <button
                    disabled={!selCount}
                    onClick={() => { const first = filtered.find((p) => selProj.has(p.id)); if (first) onShare && onShare(first); }}
                    className="hub-btn hub-btn--icon"
                    title="Share" aria-label="Share"
                  ><Icon name="share" size={11} /></button>
                  {/* Delete — removes each selected project and lets the host persist it when wired. */}
                  <button
                    data-testid="delete-selected-projects"
                    disabled={!selCount}
                    onClick={() => { void deleteProjects([...selProj]); }}
                    className="hub-btn hub-btn--icon is-danger"
                    title="Delete" aria-label="Delete"
                  ><Icon name="trash" size={11} /></button>
                </>
              )}
            </div>
          </div>
          <div className="slim-scroll hub-side-list" style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 4 }}>
            {filtered.length === 0 && (
              <div className="meta" style={{ fontSize: 11.5, padding: '14px 8px' }}>
                {localProjects.length === 0 ? 'No projects yet.' : 'No projects match your search.'}
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
                    data-project-id={p.id}
                    onClick={() => { if (jobsEdit) toggleProjSel(p.id); else setOpenId(p.id); }}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '28px 1fr auto',
                      gap: 8, alignItems: 'center',
                      padding: '8px 8px', borderRadius: 6,
                      background: jobsEdit ? (isSel ? 'var(--ink-600)' : 'transparent') : (isOpen ? 'var(--ink-600)' : 'transparent'),
                      cursor: isDragging ? 'grabbing' : 'pointer',
                      borderLeft: !jobsEdit && isOpen ? '2px solid var(--gold)' : '2px solid transparent',
                      height: 50, boxSizing: 'border-box',
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
                      <ProjectTeamSummary memberIds={projMembers} lookupMember={lookupMember} />
                    </div>
                    {jobsEdit ? (
                      /* UX 2026-09-22: an unchecked box is only its edge, so the
                         edge takes --border (3.60:1 on this card). It used to be
                         --ink-300 (= --text-disabled, 2.54:1), which fails
                         contrast on purpose and made an empty box read as a
                         disabled one. All four checkboxes in this file changed;
                         checked stays gold and 1.4px is unchanged. */
                      <span
                        onClick={(e) => { e.stopPropagation(); toggleProjSel(p.id); }}
                        style={{ width: 14, height: 14, border: `1.4px solid ${isSel ? 'var(--gold)' : 'var(--border-strong)'}`, background: isSel ? 'var(--gold)' : 'transparent', borderRadius: 2, padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 4 }}
                      >
                        {isSel && <Icon name="check" size={10} color="var(--accent-text)" />}
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
                        className="hub-icon-btn"
                        title="More"
                      ><Icon name="more" size={14} /></button>
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
                  {/* Inline rename field. Typing raises Cancel / Save in the
                      header's subtitle row; Enter saves, Escape backs out. */}
                  <input
                    key={open.id}
                    {...projectNameField(open)}
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
                    onBlur={(e) => { e.currentTarget.style.borderBottom = '1px dashed transparent'; }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8, flex: 'none' }}>
                  {/* Add files — opens the OS file picker; picked PDFs are
                      added to this project's document list. */}
                  <button className="btn" onClick={() => addFiles(open)}><Icon name="upload" size={12} />Add files</button>
                  {/* Manage Team — opens the Manage Team modal (NOT the share
                      link modal) for the currently open project. */}
                  <button className="btn" onClick={() => setTeamModalProject(open)}><Icon name="users" size={12} />Manage team</button>
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
                        return (
                          <>
                            <button
                              onClick={() => setSelFiles(allSel ? new Set() : new Set(openFiles.map((f) => f.id)))}
                              className="hub-btn hub-btn--bare"
                            >{allSel ? 'None' : 'All'}</button>
                            {/* Duplicate — clones each selected file in place. */}
                            <button
                              disabled={!c}
                              onClick={() => { duplicateFiles(selectedFiles.map((f) => f.id)); setSelFiles(new Set()); }}
                              className="hub-btn hub-btn--bare"
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
                              className="hub-btn hub-btn--bare"
                            >Move/Copy</button>
                            {/* Share — opens the share flow for this project. */}
                            <button
                              disabled={!c}
                              onClick={() => onShare && onShare(open)}
                              className="hub-btn hub-btn--icon"
                              title="Share"
                            ><Icon name="share" size={11} /></button>
                            {/* Delete — removes each selected file locally. */}
                            <button
                              disabled={!c}
                              onClick={() => deleteFiles(selectedFiles.map((f) => f.id))}
                              className="hub-btn hub-btn--icon is-danger"
                              title="Delete"
                            ><Icon name="trash" size={11} /></button>
                          </>
                        );
                      })()}
                      <button
                        onClick={() => { const next = !fileSelect; setFileSelect(next); if (!next) setSelFiles(new Set()); }}
                        className="hub-btn hub-btn--tertiary"
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
                            data-document-id={f.id}
                            onClick={() => { if (fileSelect) { toggleFileSel(f.id); return; } onOpenDocument && onOpenDocument(f); }}
                            style={{
                              // UX 2026-09-17 (owner ruling): a ticked row lifts a
                              // surface step, never a warm gold wash.
                              // UX 2026-09-22: the 2% zebra stripe KEEPS its wash on
                              // purpose. The obvious token swap is --surface-3, but
                              // --ink-600 (the ticked look, left) already IS
                              // --surface-3, so a striped row would be painted the
                              // selected colour. Fixing this needs a new banding
                              // token, which is a palette decision, not a rename.
                              background: fileSelect && isChecked ? 'var(--ink-600)' : (i % 2 ? 'transparent' : 'rgba(255,255,255,0.02)'),
                              borderRadius: 6,
                              display: 'grid', gridTemplateColumns: '24px 1fr 90px 90px 28px',
                              gap: 12, alignItems: 'center', padding: '8px 10px', fontSize: 12,
                              height: 42, boxSizing: 'border-box',
                              cursor: isDragging ? 'grabbing' : 'pointer',
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
                                style={{ width: 14, height: 14, border: `1.4px solid ${isChecked ? 'var(--gold)' : 'var(--border-strong)'}`, background: isChecked ? 'var(--gold)' : 'transparent', borderRadius: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', justifySelf: 'center' }}
                              >
                                {isChecked && <Icon name="check" size={10} color="var(--accent-text)" />}
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
                                className="hub-icon-btn"
                                title="More"
                              ><Icon name="more" size={14} /></button>
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
                                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: mem?.online ? 'var(--success)' : 'var(--text-disabled)', flex: 'none' }}></span>
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
            <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
              {localProjects.length === 0 ? (
                <EmptyState
                  icon="folder"
                  line="No projects yet"
                  description="Create a project to group related documents."
                  actionLabel="New project"
                  onAction={handleNewProject}
                />
              ) : (
                <div style={{ color: 'var(--ink-200)', fontSize: 13 }}>No projects match your search.</div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="projects-mobile-layout slim-scroll">
        {filtered.length === 0 && (
          localProjects.length === 0 ? (
            <EmptyState icon="folder" line="No projects yet" description="Create a project to group related documents." actionLabel="New project" onAction={handleNewProject} />
          ) : (
            <div className="meta" style={{ fontSize: 12, padding: '14px 4px' }}>No projects match your search.</div>
          )
        )}
        {mobileProjectLayout === 'drill' && filtered.length > 0 && (
          <div className="projects-mobile-browser projects-mobile-drill-view">
            {mobileDrillProject ? (
              <>
                <div className="projects-mobile-drill-header project-tools">
                  <div>
                    <input
                      key={`mobile-project-name-${mobileDrillProject.id}`}
                      className="projects-mobile-title-input"
                      {...projectNameField(mobileDrillProject)}
                      title="Tap to rename"
                    />
                    <span>{mobileDrillAllFiles.length} files · {projectLastEditedLabel(mobileDrillProject.id)}</span>
                  </div>
                  <button className="btn" onClick={() => addFiles(mobileDrillProject)}><Icon name="upload" size={12} />Add files</button>
                  <button className="btn" aria-label="Manage team" onClick={() => setTeamModalProject(mobileDrillProject)}><Icon name="users" size={12} />Team</button>
                </div>
                <div className="projects-mobile-file-list">
                  {mobileDrillFiles.length === 0 ? (
                    <div className="projects-mobile-empty-card">
                      <Icon name="doc" size={18} />
                      <span>{mobileDrillAllFiles.length === 0 ? 'No files in this project yet.' : 'No files match your search.'}</span>
                      {mobileDrillAllFiles.length === 0 ? (
                        <button type="button" onClick={() => addFiles(mobileDrillProject)}>Add files</button>
                      ) : null}
                    </div>
                  ) : (
                    <SortableRearrangeList ids={mobileDrillFiles.map((f) => f.id)} onReorder={reorderFiles}>
                      {mobileDrillFiles.map((f) => (
                        <SortableRearrangeRow key={`drill-file-${f.id}`} id={f.id}>
                          {({ attributes, listeners, isDragging }) => renderMobileFileRow(
                            f,
                            'drill-file',
                            <DragRearrangeHandle
                              {...attributes}
                              {...listeners}
                              isDragging={isDragging}
                              style={{ width: 24, height: 24 }}
                            />,
                          )}
                        </SortableRearrangeRow>
                      ))}
                    </SortableRearrangeList>
                  )}
                </div>
              </>
            ) : (
              <>
                <SortableRearrangeList ids={filtered.map((p) => p.id)} onReorder={reorderProjects}>
                  {filtered.map((p) => {
                    const isSel = selProj.has(p.id);
                    const isPinned = pinnedIds.has(p.id);
                    const projMembers = projectTeam(p);
                    return (
                      <SortableRearrangeRow key={`drill-folder-${p.id}`} id={p.id}>
                        {({ attributes, listeners, isDragging }) => (
                          <div
                            data-drag-rearrange-row
                            data-project-id={p.id}
                            role="button"
                            tabIndex={0}
                            /* Selected takes the panel's cue — a --surface-3
                               step and a 2px gold left edge — so a picked
                               project reads from across the room, not only from
                               its 17px check box. */
                            className={`projects-mobile-folder-row drill reorderable${jobsEdit && isSel ? ' is-selected' : ''}`}
                            onClick={() => {
                              if (jobsEdit) {
                                toggleProjSel(p.id);
                                return;
                              }
                              captureMobileProjectList();
                              setOpenId(p.id);
                              setMobileDrillOpenId(p.id);
                              setFileSearch('');
                              setFileSelect(false);
                              setSelFiles(new Set());
                            }}
                            onKeyDown={(e) => {
                              if (e.key !== 'Enter' && e.key !== ' ') return;
                              e.preventDefault();
                              e.currentTarget.click();
                            }}
                          >
                            {isPinned ? (
                              <span title="Pinned" className="projects-mobile-drag-slot">
                                <PinIcon size={12} color="var(--gold)" />
                              </span>
                            ) : (
                              <DragRearrangeHandle
                                {...attributes}
                                {...listeners}
                                isDragging={isDragging}
                                style={{ width: 24, height: 24 }}
                              />
                            )}
                            <span className="projects-mobile-folder-copy">
                              <strong>{p.name}</strong>
                              <ProjectTeamSummary memberIds={projMembers} lookupMember={lookupMember} />
                            </span>
                            {jobsEdit ? (
                              <span className={`projects-mobile-check ${isSel ? 'checked' : ''}`}>{isSel ? <Icon name="check" size={11} color="var(--accent-text)" /> : null}</span>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setFileMenu(null);
                                  setTeamMenu((cur) => (cur && cur.id === p.id ? null : { id: p.id, rect }));
                                }}
                                className="hub-icon-btn"
                                title="More"
                              ><Icon name="more" size={14} /></button>
                            )}
                          </div>
                        )}
                      </SortableRearrangeRow>
                    );
                  })}
                </SortableRearrangeList>
              </>
            )}
          </div>
        )}

        {mobileProjectLayout === 'rail' && filtered.length > 0 && open && (
          <div className="projects-mobile-browser projects-mobile-rail-view">
            <div className="projects-mobile-rail-toolbar">
              <button type="button" onClick={() => setMobileRailOpen(true)}>
                <Icon name="folder" size={14} />Projects
              </button>
              <div>
                <strong>{open.name}</strong>
                <span>{openFiles.length} files · {projectLastEditedLabel(open.id)}</span>
              </div>
            </div>
            {mobileFileActions}
            <div className="projects-mobile-file-list">
              {openFiles.length === 0 ? (
                <div className="meta" style={{ fontSize: 12, padding: '8px 2px' }}>No files in this project yet.</div>
              ) : openFiles.map((f) => renderMobileFileRow(f, 'rail-file'))}
            </div>
            {mobileRailOpen && (
              <div className="projects-mobile-rail-layer">
                <button
                  type="button"
                  aria-label="Close projects"
                  className="projects-mobile-rail-scrim"
                  onClick={() => setMobileRailOpen(false)}
                />
                <div className="projects-mobile-rail-panel">
                  <div className="projects-mobile-browser-label">Projects</div>
                  {mobileProjectActions}
                  <div className="projects-mobile-rail-list">
                    {filtered.map((p) => {
                      const isOpen = open && p.id === open.id;
                      const isSel = selProj.has(p.id);
                      return (
                        <button
                          key={`rail-folder-${p.id}`}
                          type="button"
                          className={isOpen ? 'active' : ''}
                          onClick={() => {
                            if (jobsEdit) {
                              toggleProjSel(p.id);
                              return;
                            }
                            setOpenId(p.id);
                            setMobileRailOpen(false);
                          }}
                        >
                          <span>{p.name}</span>
                          <small>{projectFileCount(p.id)} files</small>
                          {jobsEdit && <i className={`projects-mobile-check ${isSel ? 'checked' : ''}`}>{isSel ? <Icon name="check" size={11} color="var(--accent-text)" /> : null}</i>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {mobileProjectLayout === 'teams' && (
          <div className="projects-mobile-browser projects-mobile-teams-view">
            <div className="projects-mobile-browser-label">Places</div>
            {filtered.map((p) => {
              const isOpen = open && p.id === open.id;
              const isSel = selProj.has(p.id);
              return (
                <div key={`teams-folder-${p.id}`} className={`projects-mobile-folder-section ${isOpen ? 'active' : ''}`}>
                  <button
                    type="button"
                    className="projects-mobile-folder-row"
                    onClick={() => { if (jobsEdit) toggleProjSel(p.id); else setOpenId(p.id); }}
                  >
                    <span className="projects-mobile-folder-glyph"><Icon name="folder" size={17} /></span>
                    <span className="projects-mobile-folder-copy">
                      <strong>{p.name}</strong>
                      <small>{projectFileCount(p.id)} files · {projectLastEditedLabel(p.id)}</small>
                    </span>
                    {jobsEdit ? (
                      <span className={`projects-mobile-check ${isSel ? 'checked' : ''}`}>{isSel ? <Icon name="check" size={11} color="var(--accent-text)" /> : null}</span>
                    ) : (
                      <span className="projects-mobile-disclosure">{isOpen ? 'Open' : 'View'}</span>
                    )}
                  </button>
                  {isOpen && (
                    <div className="projects-mobile-folder-files">
                      <div className="projects-mobile-browser-label">Files</div>
                      {openFiles.length === 0 ? (
                        <div className="meta" style={{ fontSize: 12, padding: '8px 2px' }}>No files in this project yet.</div>
                      ) : openFiles.map((f) => renderMobileFileRow(f, 'teams-file'))}
                      {mobileFileActions}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {mobileProjectLayout === 'drive' && (
          <div className="projects-mobile-browser projects-mobile-drive-view">
            <div className="projects-mobile-browser-label">Folders</div>
            <div className="projects-mobile-folder-grid">
              {filtered.map((p) => (
                <button
                  key={`drive-folder-${p.id}`}
                  type="button"
                  className={open && p.id === open.id ? 'active' : ''}
                  onClick={() => setOpenId(p.id)}
                >
                  <span className="projects-mobile-folder-glyph"><Icon name="folder" size={18} /></span>
                  <strong>{p.name}</strong>
                  <small>{projectFileCount(p.id)} files</small>
                </button>
              ))}
            </div>
            {open && (
              <>
                <div className="projects-mobile-browser-row-heading">
                  <span>Files in {open.name}</span>
                  <button type="button" onClick={() => addFiles(open)}>Add</button>
                </div>
                <div className="projects-mobile-file-list">
                  {openFiles.length === 0 ? (
                    <div className="meta" style={{ fontSize: 12, padding: '8px 2px' }}>No files in this project yet.</div>
                  ) : openFiles.map((f) => renderMobileFileRow(f, 'drive-file'))}
                </div>
              </>
            )}
          </div>
        )}

        {mobileProjectLayout === 'browse' && (
          <div className="projects-mobile-browser projects-mobile-browse-view">
            <div className="projects-mobile-path-card">
              <div className="projects-mobile-browser-label">Browse</div>
              <div className="projects-mobile-path">Projects / {open?.name || 'Select a folder'}</div>
            </div>
            {filtered.map((p) => (
              <button
                key={`browse-folder-${p.id}`}
                type="button"
                className={`projects-mobile-folder-row ${open && p.id === open.id ? 'active' : ''}`}
                onClick={() => setOpenId(p.id)}
              >
                <span className="projects-mobile-folder-glyph"><Icon name="folder" size={17} /></span>
                <span className="projects-mobile-folder-copy">
                  <strong>{p.name}</strong>
                  <small>{projectFileCount(p.id)} files · {projectTeam(p).length} members</small>
                </span>
                <span className="projects-mobile-chevron">›</span>
              </button>
            ))}
            {open && (
              <div className="projects-mobile-folder-files raised">
                <div className="projects-mobile-browser-row-heading">
                  <span>{open.name}</span>
                  <button type="button" onClick={() => setTeamModalProject(open)}>Team</button>
                </div>
                {openFiles.map((f) => renderMobileFileRow(f, 'browse-file'))}
                {openFiles.length === 0 ? <div className="meta" style={{ fontSize: 12, padding: '8px 2px' }}>No files in this project yet.</div> : null}
              </div>
            )}
          </div>
        )}

        {mobileProjectLayout === 'grid' && (
          <div className="projects-mobile-browser projects-mobile-grid-view">
            <div className="projects-mobile-browser-label">Folders</div>
            <div className="projects-mobile-tile-grid">
              {filtered.map((p) => (
                <button
                  key={`grid-folder-${p.id}`}
                  type="button"
                  className={open && p.id === open.id ? 'active folder' : 'folder'}
                  onClick={() => setOpenId(p.id)}
                >
                  <span className="projects-mobile-folder-art"><Icon name="folder" size={30} /></span>
                  <strong>{p.name}</strong>
                  <small>{projectFileCount(p.id)} files</small>
                </button>
              ))}
            </div>
            {open && openFiles.length > 0 && (
              <>
                <div className="projects-mobile-browser-label">Files in {open.name}</div>
                <div className="projects-mobile-tile-grid files">
                  {openFiles.map((f) => (
                    <button key={`grid-file-${f.id}`} type="button" onClick={() => onOpenDocument && onOpenDocument(f)}>
                      <span className="projects-mobile-file-thumb"><Icon name="doc" size={20} /></span>
                      <strong>{f.name}</strong>
                      <small>{shortWhen(f)}</small>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {mobileProjectLayout === 'recent' && (
          <div className="projects-mobile-browser projects-mobile-recent-view">
            <div className="projects-mobile-browser-row-heading">
              <span>Recent files</span>
            </div>
            <div className="projects-mobile-file-list">
              {(recentFiles.length ? recentFiles : openFiles).map((f) => renderMobileFileRow(f, 'recent-file'))}
            </div>
            <div className="projects-mobile-browser-label">Project folders</div>
            {filtered.map((p) => (
              <button
                key={`recent-folder-${p.id}`}
                type="button"
                className={`projects-mobile-folder-row ${open && p.id === open.id ? 'active' : ''}`}
                onClick={() => setOpenId(p.id)}
              >
                <span className="projects-mobile-folder-glyph"><Icon name="folder" size={17} /></span>
                <span className="projects-mobile-folder-copy">
                  <strong>{p.name}</strong>
                  <small>{projectFileCount(p.id)} files · {projectLastEditedLabel(p.id)}</small>
                </span>
              </button>
            ))}
          </div>
        )}
        {mobileProjectLayout === 'cards' && filtered.map((p) => {
          const isOpen = open && p.id === open.id;
          const isSel = selProj.has(p.id);
          const projMembers = projectTeam(p);
          return (
            <div
              key={`mobile-project-${p.id}`}
              className={`mobile-project-card${jobsEdit && isSel ? ' is-selected' : ''}${isOpen ? ' is-open' : ''}`}
              onClick={() => { if (jobsEdit) toggleProjSel(p.id); else setOpenId(p.id); }}
            >
              <div style={{ minWidth: 0 }}>
                <div className="mobile-card-title">{p.name}</div>
                <div className="mobile-card-meta" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <AvatarStack
                    members={projMembers.slice(0, 3).map((id) => initialsOf(lookupMember(id)?.name))}
                    size={14}
                  />
                  <span>{projectFileCount(p.id)} files · {projectLastEditedLabel(p.id)}</span>
                </div>
              </div>
              {jobsEdit ? (
                <span
                  onClick={(e) => { e.stopPropagation(); toggleProjSel(p.id); }}
                  style={{ width: 16, height: 16, border: `1.4px solid ${isSel ? 'var(--gold)' : 'var(--border-strong)'}`, background: isSel ? 'var(--gold)' : 'transparent', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  {isSel && <Icon name="check" size={10} color="var(--accent-text)" />}
                </span>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    setFileMenu(null);
                    setTeamMenu((cur) => (cur && cur.id === p.id ? null : { id: p.id, rect }));
                  }}
                  className="hub-icon-btn"
                  title="More"
                ><Icon name="more" size={14} /></button>
              )}
            </div>
          );
        })}

        {mobileProjectLayout === 'compact' && (
          <div className="projects-mobile-compact-list">
            {filtered.map((p) => {
              const isOpen = open && p.id === open.id;
              const projMembers = projectTeam(p);
              return (
                <button
                  key={`mobile-project-compact-${p.id}`}
                  type="button"
                  className={isOpen ? 'active' : ''}
                  onClick={() => setOpenId(p.id)}
                >
                  <span className="projects-mobile-compact-title">{p.name}</span>
                  <span>{projectFileCount(p.id)} files</span>
                  <AvatarStack members={projMembers.slice(0, 3).map((id) => initialsOf(lookupMember(id)?.name))} size={14} />
                </button>
              );
            })}
          </div>
        )}

        {mobileProjectLayout === 'focus' && open && (
          <div className="projects-mobile-focus-card">
            <div className="projects-mobile-focus-kicker">Current project</div>
            <input
              key={`mobile-focus-${open.id}`}
              defaultValue={open.name}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              onBlur={(e) => {
                const name = e.currentTarget.value.trim();
                if (name && name !== open.name) renameProject(open.id, name);
                else e.currentTarget.value = open.name;
              }}
            />
            <div className="projects-mobile-focus-stats">
              <span>{openFiles.length} files</span>
              <span>{projectTeam(open).length} members</span>
              <span>{projectLastEditedLabel(open.id)}</span>
            </div>
            {mobileFileActions}
          </div>
        )}

        {mobileProjectLayout === 'files' && (
          <div className="projects-mobile-project-strip">
            {filtered.map((p) => (
              <button
                key={`mobile-project-strip-${p.id}`}
                className={open && p.id === open.id ? 'active' : ''}
                type="button"
                onClick={() => setOpenId(p.id)}
              >
                <span>{p.name}</span>
                <small>{projectFileCount(p.id)}</small>
              </button>
            ))}
          </div>
        )}

        {mobileProjectLayout === 'team' && (
          <div className="projects-mobile-team-board">
            {filtered.map((p) => {
              const team = projectTeam(p);
              return (
                <button
                  key={`mobile-team-board-${p.id}`}
                  type="button"
                  className={open && p.id === open.id ? 'active' : ''}
                  onClick={() => setOpenId(p.id)}
                >
                  <span className="projects-mobile-team-name">{p.name}</span>
                  <AvatarStack members={team.slice(0, 4).map((id) => initialsOf(lookupMember(id)?.name))} size={16} />
                  <span>{team.length} members · {projectFileCount(p.id)} files</span>
                </button>
              );
            })}
          </div>
        )}

        {open && ['cards', 'focus', 'files'].includes(mobileProjectLayout) && (
          <div className="mobile-project-detail">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ width: 4, height: 32, background: 'var(--gold)', borderRadius: 2, flex: 'none' }}></span>
              <input
                key={`mobile-${open.id}`}
                {...projectNameField(open)}
                title="Click to rename"
                style={{
                  background: 'transparent',
                  color: 'var(--bone-100)',
                  border: 0,
                  borderBottom: '1px solid var(--ink-500)',
                  padding: '3px 0',
                  fontSize: 18,
                  fontWeight: 700,
                  outline: 'none',
                  width: '100%',
                  fontFamily: 'inherit',
                }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
              <button className="btn" style={{ justifyContent: 'center' }} onClick={() => addFiles(open)}><Icon name="upload" size={12} />Add files</button>
              <button className="btn" style={{ justifyContent: 'center' }} onClick={() => setTeamModalProject(open)}><Icon name="users" size={12} />Team</button>
            </div>

            <div className="mobile-section-title" style={{ marginBottom: 8 }}>Files</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {openFiles.length === 0 ? (
                <div className="meta" style={{ fontSize: 12, padding: '4px 0 10px' }}>No files in this project yet.</div>
              ) : openFiles.map((f) => {
                const isChecked = selFiles.has(f.id);
                const ownerId = f.user_id ?? f.owner ?? projectTeam(open)[0] ?? null;
                const owner = lookupMember(ownerId);
                return (
                  <div
                    key={`mobile-file-${f.id}`}
                    onClick={() => { if (fileSelect) { toggleFileSel(f.id); return; } onOpenDocument && onOpenDocument(f); }}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 28px',
                      gap: 8,
                      alignItems: 'center',
                      border: '1px solid var(--ink-500)',
                      borderRadius: 7,
                      padding: '9px 10px',
                      // UX 2026-09-17 (owner ruling): the same surface step, not a wash.
                      background: fileSelect && isChecked ? 'var(--ink-600)' : 'var(--ink-800)',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div className="mobile-card-title" style={{ fontSize: 12.5 }}>{f.name}</div>
                      <div className="mobile-card-meta">
                        {[owner?.name?.split(' ')[0], shortWhen(f)].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    {fileSelect ? (
                      <span
                        onClick={(e) => { e.stopPropagation(); toggleFileSel(f.id); }}
                        style={{ width: 16, height: 16, border: `1.4px solid ${isChecked ? 'var(--gold)' : 'var(--border-strong)'}`, background: isChecked ? 'var(--gold)' : 'transparent', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', justifySelf: 'center' }}
                      >
                        {isChecked && <Icon name="check" size={10} color="var(--accent-text)" />}
                      </span>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          setTeamMenu(null);
                          setFileMenu((cur) => (cur && cur.id === f.id ? null : { id: f.id, rect }));
                        }}
                        className="hub-icon-btn"
                        title="More"
                      ><Icon name="more" size={14} /></button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mobile-section-title" style={{ margin: '16px 0 8px' }}>Team</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {projectTeam(open).map((m) => {
                const mem = lookupMember(m);
                const memName = mem?.name || 'Teammate';
                return (
                  <div key={`mobile-team-${m}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Avatar initials={mem ? initialsOf(mem.name) : '—'} size={22} color={mem?.color} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{memName}</div>
                      <div className="meta" style={{ fontSize: 10.5 }}>{mem?.role || 'Member'}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {open && mobileProjectLayout === 'compact' && (
          <div className="mobile-project-detail compact">
            <div className="mobile-section-title" style={{ marginBottom: 8 }}>{open.name}</div>
            {mobileFileActions}
            <div className="projects-mobile-file-mini-list">
              {openFiles.length === 0 ? (
                <div className="meta" style={{ fontSize: 12, padding: '4px 0' }}>No files in this project yet.</div>
              ) : openFiles.slice(0, 5).map((f) => (
                <button key={`compact-file-${f.id}`} type="button" onClick={() => onOpenDocument && onOpenDocument(f)}>
                  <span>{f.name}</span>
                  <small>{shortWhen(f)}</small>
                </button>
              ))}
            </div>
          </div>
        )}
        {open && mobileProjectLayout === 'team' && (
          <div className="mobile-project-detail compact">
            <div className="mobile-section-title" style={{ marginBottom: 8 }}>{open.name} team</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {projectTeam(open).map((m) => {
                const mem = lookupMember(m);
                const memName = mem?.name || 'Teammate';
                return (
                  <div key={`team-layout-${m}`} className="projects-mobile-member-row">
                    <Avatar initials={mem ? initialsOf(mem.name) : '—'} size={24} color={mem?.color} />
                    <div>
                      <div>{memName}</div>
                      <span>{mem?.role || 'Member'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {mobileFileActions}
          </div>
        )}
        {mobileProjectLayout === 'files' && (
          <div className="mobile-project-detail compact">
            <div className="mobile-section-title" style={{ marginBottom: 8 }}>Recent files</div>
            <div className="projects-mobile-file-mini-list">
              {(openFiles.length ? openFiles : recentFiles).map((f) => (
                <button key={`files-layout-${f.id}`} type="button" onClick={() => onOpenDocument && onOpenDocument(f)}>
                  <span>{f.name}</span>
                  <small>{shortWhen(f)}</small>
                </button>
              ))}
            </div>
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
                label: locked ? 'Unlock document' : 'Lock document',
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
        onConfirm={(destId, mode) => moveCopyFiles(moveIds, destId, mode)}
      />
    </HubShell>
  );
}
