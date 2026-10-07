/**
 * KAL-430 — every decision the Archive screen makes, as pure functions.
 *
 * The screen itself (ArchiveScreen.jsx) is deliberately thin JSX: filtering,
 * sorting, the expand-by-default rule, selection resolution, the label
 * formatters and the bulk-outcome copy all live here so they can be unit
 * tested without a DOM (this repo has no jsdom and no React test renderer).
 *
 * Items are the normalized Archive items from src/services/archiveContract.js.
 */

import { presenceInitials } from '../components/presenceIdentity.js';

/* Filter chips, in display order. 'all' is first and is the default because
   Archive is a small, mixed list — the user usually wants to see everything
   that is about to expire, not one type at a time. */
export const ARCHIVE_FILTERS = Object.freeze([
  { key: 'all', label: 'All' },
  { key: 'document', label: 'Documents' },
  { key: 'project', label: 'Projects' },
  { key: 'template', label: 'Templates' },
]);

/**
 * The four named sorts, mapped onto the (sortKey, sortDir) pair the ledger
 * headers actually toggle. Clicking a column header and picking a named sort
 * are two doors into the same state — keeping the mapping here is what stops
 * the two from drifting.
 */
export const ARCHIVE_SORTS = Object.freeze([
  { key: 'recent', label: 'Recently archived', sortKey: 'archived', sortDir: 'desc' },
  { key: 'oldest', label: 'Oldest archived', sortKey: 'archived', sortDir: 'asc' },
  { key: 'az', label: 'Name A–Z', sortKey: 'name', sortDir: 'asc' },
  { key: 'za', label: 'Name Z–A', sortKey: 'name', sortDir: 'desc' },
  { key: 'largest', label: 'Size', sortKey: 'size', sortDir: 'desc' },
]);

/**
 * The sort menu, in the Documents ledger's own order and wording.
 *
 * The owner asked (2026-08-07) to "filter by: file, project, most recently
 * archived, size" — which is exactly DocumentsLedger's sortOptions list
 * (File / Project / Last edited / Size) with the date field renamed to
 * Archive's equivalent. Same control, same four rows, one word changed.
 *
 * `name` is labelled "File" to match Documents even though an Archive row may
 * be a project or a template: the column it sorts is the name column, and
 * borrowing the neighbouring screen's word keeps the two menus readable as one
 * feature.
 */
export const ARCHIVE_SORT_OPTIONS = Object.freeze([
  { key: 'name', label: 'File' },
  { key: 'project', label: 'Project' },
  { key: 'archived', label: 'Most recently archived' },
  { key: 'size', label: 'Size' },
]);

/* Default sort: most recently archived first. Someone opening Archive is
   nearly always looking for the thing they just archived by mistake. */
export const DEFAULT_ARCHIVE_SORT = Object.freeze({ sortKey: 'archived', sortDir: 'desc' });

export const ARCHIVE_TYPE_LABELS = Object.freeze({
  document: 'Document',
  project: 'Project',
  template: 'Template',
});

/** Display label for the Type column. Unknown types degrade to an em dash. */
export function archiveTypeLabel(type) {
  return ARCHIVE_TYPE_LABELS[type] || '—';
}

/** The named sort matching a (sortKey, sortDir) pair, or null if it is neither. */
export function namedSortFor(sortKey, sortDir) {
  return ARCHIVE_SORTS.find((s) => s.sortKey === sortKey && s.sortDir === sortDir) || null;
}

/** The (sortKey, sortDir) pair for a named sort; falls back to the default. */
export function sortStateForNamedSort(key) {
  const found = ARCHIVE_SORTS.find((s) => s.key === key);
  if (!found) return { ...DEFAULT_ARCHIVE_SORT };
  return { sortKey: found.sortKey, sortDir: found.sortDir };
}

/**
 * Header-click behaviour, copied from the Documents ledger: clicking the
 * active column flips direction, clicking a new column adopts that column's
 * natural first direction (newest-first for dates, A–Z for names).
 */
export function nextSortState(current, key) {
  const { sortKey, sortDir } = current || DEFAULT_ARCHIVE_SORT;
  if (sortKey === key) return { sortKey, sortDir: sortDir === 'asc' ? 'desc' : 'asc' };
  /* Natural first direction, matching the Documents ledger: dates and sizes
     open biggest/newest first, names open A–Z. */
  const descFirst = key === 'archived' || key === 'days' || key === 'size';
  return { sortKey: key, sortDir: descFirst ? 'desc' : 'asc' };
}

/** Type filter. 'all' (or anything unrecognized) passes everything through. */
export function filterArchiveItems(items = [], filter = 'all') {
  if (!filter || filter === 'all') return [...items];
  return items.filter((item) => item && item.type === filter);
}

const timeOf = (iso) => Date.parse(iso || '') || 0;

/**
 * Sort a copy of the list. Name comparisons use localeCompare so accented
 * names land where a reader expects; ties fall back to name so the order is
 * stable across renders.
 */
/**
 * Whether an item has a size at all.
 *
 * Only documents carry bytes. A project reports the SUM of its archived
 * children (it is a container, and the sum is the honest answer to "how much
 * disk does restoring this bring back"). A template stores its whole structure
 * in a JSON column and owns no file, so it genuinely has no size — and 0 is not
 * the same statement as "none". `null` keeps the difference.
 */
export function archiveItemSize(item) {
  if (!item) return null;
  return typeof item.fileSize === 'number' ? item.fileSize : null;
}

/**
 * Sort a copy of the list. Name comparisons use localeCompare so accented
 * names land where a reader expects; ties fall back to name so the order is
 * stable across renders.
 */
export function sortArchiveItems(items = [], sortKey = 'archived', sortDir = 'desc') {
  const sign = sortDir === 'asc' ? 1 : -1;
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
  const arr = [...items];
  if (sortKey === 'name') {
    arr.sort((a, b) => sign * byName(a, b));
  } else if (sortKey === 'project') {
    /* A document sorts under its original project; a project sorts under its
       own name (restoring it recreates that project); a template belongs to no
       project. Items with no project sink to the bottom either way, for the
       same reason sizeless items do — "none" is not a position on the scale. */
    const projectOf = (item) => (item.type === 'project' ? item.name : item.projectName) || '';
    arr.sort((a, b) => {
      const pa = projectOf(a);
      const pb = projectOf(b);
      if (!pa !== !pb) return pa ? -1 : 1;
      return sign * pa.localeCompare(pb) || byName(a, b);
    });
  } else if (sortKey === 'size') {
    /* Sizeless items (templates, and any project whose children reported no
       bytes) always land LAST, in both directions. Treating "no size" as zero
       would rank them as the smallest thing in the list, which is a different
       claim from "this has no size". */
    arr.sort((a, b) => {
      const sa = archiveItemSize(a);
      const sb = archiveItemSize(b);
      if (sa == null && sb == null) return byName(a, b);
      if (sa == null) return 1;
      if (sb == null) return -1;
      return sign * (sa - sb) || byName(a, b);
    });
  } else if (sortKey === 'days') {
    arr.sort((a, b) => sign * ((a.daysRemaining || 0) - (b.daysRemaining || 0)) || byName(a, b));
  } else if (sortKey === 'type') {
    arr.sort((a, b) => sign * archiveTypeLabel(a.type).localeCompare(archiveTypeLabel(b.type)) || byName(a, b));
  } else {
    arr.sort((a, b) => sign * (timeOf(a.archivedAt) - timeOf(b.archivedAt)) || byName(a, b));
  }
  return arr;
}

/**
 * Name search, matching the Documents ledger's: case-insensitive substring on
 * the name, nothing fancier.
 *
 * A project ALSO matches on its children, because the thing the user is
 * hunting for is often a file that travelled into Archive inside a project. A
 * project kept only because a child matched has its children narrowed to the
 * matches, so opening it shows the hit rather than the whole group.
 */
export function searchArchiveItems(items = [], query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [...items];
  const hits = (name) => String(name || '').toLowerCase().includes(q);
  const out = [];
  for (const item of items) {
    if (!item) continue;
    if (hits(item.name)) { out.push(item); continue; }
    const matchingChildren = (item.children || []).filter((child) => hits(child.name));
    if (matchingChildren.length) {
      out.push({ ...item, children: matchingChildren, childCount: matchingChildren.length });
    }
  }
  return out;
}

/**
 * True when this project is only in the list because a CHILD matched the
 * search. The screen forces those open, so the row that justified the match is
 * actually visible instead of hidden behind a collapsed chevron.
 */
export function matchedOnChildOnly(item, query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q || !item || item.type !== 'project') return false;
  return !String(item.name || '').toLowerCase().includes(q);
}

/** Search, then filter, then sort — the one list the screen renders and selects over. */
export function visibleArchiveItems(items = [], { filter = 'all', sortKey = 'archived', sortDir = 'desc', search = '' } = {}) {
  return sortArchiveItems(
    filterArchiveItems(searchArchiveItems(items, search), filter),
    sortKey,
    sortDir,
  );
}

/**
 * Project rows start COLLAPSED (owner call, 2026-08-04). Archive is a scan-and-
 * rescue list: opening every group by default buries the top-level rows the
 * user is actually choosing between under their children. We therefore track
 * the EXPANDED ids — an empty set means everything is closed, and because the
 * set is never rebuilt from the item list, whatever the user opens stays open
 * across sorts and filter changes.
 */
export function defaultExpandedIds() {
  return new Set();
}

export function isRowExpanded(expandedIds, id) {
  return Boolean(expandedIds && expandedIds.has(id));
}

/** Returns a NEW set so React sees a changed reference. */
export function toggleExpanded(expandedIds, id) {
  const next = new Set(expandedIds || []);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/* ------------------------------------------------------------------------
   Preview-pane disclosure — a SEPARATE state from the ledger's
   ------------------------------------------------------------------------

   Owner call 2026-08-07: the ledger tree and the preview tree must not move
   together. They answer different questions, so they get opposite defaults:

     ledger  — collapsed by default. It is a scan-and-rescue list, and open
               groups bury the top-level rows the user is choosing between.
     preview — EXPANDED by default. You selected this one thing in order to
               look inside it; making you click again to see the contents is
               the click that should not exist.

   Opposite defaults need opposite storage. The ledger tracks EXPANDED ids
   (empty = all closed); the preview tracks COLLAPSED ids (empty = all open).
   Two independent sets, so toggling one cannot touch the other.

   Ids here are scoped by the previewed item (e.g. `<templateId>:<moduleId>`)
   so a positional legacy id cannot collide across two items. Nothing is reset
   when the selection changes: a node the user deliberately closed stays closed
   when they come back to it. */
export function defaultPreviewCollapsedIds() {
  return new Set();
}

export function isPreviewNodeOpen(collapsedIds, id) {
  return !(collapsedIds && collapsedIds.has(id));
}

/** Returns a NEW set so React sees a changed reference. */
export function togglePreviewNode(collapsedIds, id) {
  const next = new Set(collapsedIds || []);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Only top-level items are selectable. A project's children are descriptive —
 * restoring or deleting a child on its own would split a group that the
 * database treats as one unit, so they are never in the selection.
 */
export function selectableIds(items = []) {
  return items.filter(Boolean).map((item) => item.id);
}

export function toggleSelection(selectedIds, id) {
  const next = new Set(selectedIds || []);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** True when every currently visible row is selected (and there is at least one). */
export function isAllSelected(selectedIds, visibleItems = []) {
  if (!visibleItems.length) return false;
  return visibleItems.every((item) => selectedIds && selectedIds.has(item.id));
}

/**
 * The select-all toggle operates over the CURRENTLY FILTERED list, matching
 * the Documents screen: "All" selects what you can see, "None" clears it.
 */
export function nextSelectAll(selectedIds, visibleItems = []) {
  if (isAllSelected(selectedIds, visibleItems)) return new Set();
  return new Set(selectableIds(visibleItems));
}

/**
 * Resolve ids back to the normalized items the callbacks receive, in the
 * order they appear on screen. Children are excluded by construction: only
 * top-level items are ever passed in.
 */
export function resolveSelection(visibleItems = [], selectedIds) {
  if (!selectedIds || !selectedIds.size) return [];
  return visibleItems.filter((item) => selectedIds.has(item.id));
}

/**
 * Resolve the item shown in Archive's preview pane.
 *
 * Selection remains deliberately top-level because restore/delete operate on
 * a project as one unit. Preview is less restrictive: an expanded project's
 * document is still a document, so it can be inspected without becoming an
 * independently actionable Archive item.
 */
export function resolveArchivePreviewItem(visibleItems = [], previewId) {
  if (!previewId) return null;
  for (const item of visibleItems) {
    if (item?.id === previewId) return item;
    const child = (item?.children || []).find((candidate) => candidate?.id === previewId);
    if (child) return { ...child, projectName: child.projectName || item.name || null };
  }
  return null;
}

/** Drop ids that no longer exist (e.g. after a restore removes rows). */
export function pruneSelection(selectedIds, items = []) {
  const live = new Set(selectableIds(items));
  const next = new Set();
  for (const id of selectedIds || []) if (live.has(id)) next.add(id);
  return next;
}

/**
 * Days-remaining copy. `0` reads as "Today" rather than "0 days" because the
 * row is being purged today, not in zero days — the retention countdown is
 * the whole reason a user comes to this screen, so it has to read plainly.
 */
export function daysRemainingLabel(days) {
  const n = Math.max(0, Math.round(Number(days) || 0));
  if (n === 0) return 'Today';
  if (n === 1) return '1 day';
  return `${n} days`;
}

/**
 * Countdown copy for the preview pane. Inside the final day "1 day" is too
 * coarse to act on — the user needs to know whether they have twenty hours or
 * twenty minutes — so the last day counts down in hours, then minutes.
 * The list column keeps the coarser day label; only the preview goes finer.
 */
export function timeRemainingLabel(expiresAt, now = Date.now()) {
  const ms = Date.parse(expiresAt || '') || 0;
  if (!ms) return '—';
  const nowMs = now instanceof Date ? now.getTime() : now;
  const delta = ms - nowMs;
  if (delta <= 0) return 'Expired';
  const hours = delta / 3600000;
  if (hours >= 24) return daysRemainingLabel(Math.ceil(hours / 24));
  const wholeHours = Math.floor(hours);
  if (wholeHours >= 1) return `${wholeHours} ${wholeHours === 1 ? 'hour' : 'hours'}`;
  const minutes = Math.max(1, Math.floor(delta / 60000));
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

/** File size for the preview pane, matching the Documents ledger's units. */
export function fileSizeLabel(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/* ------------------------------------------------------------------------
   Preview-pane team glyphs
   ------------------------------------------------------------------------ */

/* Five overlapping avatars is what the preview column fits without the stack
   crowding the name beside it. */
export const TEAM_AVATAR_SLOTS = 5;

/* Whose face you see when there is not room for everyone. Owners can act on
   the item, editors changed it, viewers only looked — so that is the order the
   slots fill in, and the people who drop off the end are the ones whose
   absence tells you least. */
const ROLE_RANK = { owner: 0, editor: 1, viewer: 2 };
const roleRank = (role) => {
  const rank = ROLE_RANK[String(role || '').toLowerCase()];
  return rank == null ? ROLE_RANK.viewer : rank;
};

/**
 * Split collaborators into the avatars to draw and the overflow count.
 *
 * Sorting is stable within a role, so people keep their position between
 * renders. When more people exist than there are slots, the LAST slot becomes
 * the "+N" glyph rather than another face — five faces plus a count would be
 * six things wide, which is what the five-slot budget exists to prevent.
 */
export function teamAvatarSlots(collaborators = [], slots = TEAM_AVATAR_SLOTS) {
  const people = (collaborators || []).filter(Boolean);
  const ordered = people
    .map((person, index) => ({ person, index }))
    .sort((a, b) => (roleRank(a.person.role) - roleRank(b.person.role)) || (a.index - b.index))
    .map((entry) => entry.person);

  if (ordered.length <= slots) return { shown: ordered, overflow: 0 };
  return { shown: ordered.slice(0, slots - 1), overflow: ordered.length - (slots - 1) };
}

/** Two-letter initials for an avatar glyph: the one app-wide rule
 *  (presenceIdentity.js), the same as the Documents ledger and the viewer. */
export function collaboratorInitials(person) {
  const source = (person && (person.name || person.email)) || '';
  return String(source).trim() ? presenceInitials(source) : '—';
}

/** What a collaborator's face colour is keyed on (utils/userColors.js): their
 *  user id, so they wear the same pastel here as everywhere else; the email
 *  when an invite has no account yet. */
export function collaboratorColorId(person) {
  return (person && (person.user_id || person.userId || person.email)) || null;
}

/** Short archived-on date, matching the Documents ledger's date formatting. */
export function archivedDateLabel(iso) {
  const ms = Date.parse(iso || '') || 0;
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const pluralItems = (n) => `${n} ${n === 1 ? 'item' : 'items'}`;

/* Name at most three failures inline; beyond that the toast turns into a
   wall of text and stops being readable. */
function nameList(items = [], max = 3) {
  const names = items.map((entry) => (entry && entry.name) || 'Untitled');
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

const ACTION_COPY = Object.freeze({
  restore: { done: 'Restored', failed: 'could not be restored', failedLead: 'Could not restore' },
  delete: { done: 'Deleted', failed: 'could not be deleted', failedLead: 'Could not delete' },
});

/**
 * Normalize whatever a callback resolved with into { succeeded, failed }.
 * A plain resolve (or undefined) means every item worked — that is the common
 * case and callers should not have to build a result object for it.
 */
export function normalizeBulkResult(result, items = []) {
  if (result && Array.isArray(result.succeeded)) {
    const failed = Array.isArray(result.failed) ? result.failed : [];
    return {
      succeeded: result.succeeded,
      failed: failed.map((entry) => (entry && entry.item ? entry.item : entry)).filter(Boolean),
    };
  }
  return { succeeded: [...items], failed: [] };
}

/**
 * The toast copy. A partial failure must name BOTH sides — "Restored 2 items.
 * 1 could not be restored: Site plan." — because a silent partial success is
 * how a user loses track of what is still in Archive.
 */
export function buildBulkOutcomeMessage(action, { succeeded = [], failed = [] } = {}) {
  const copy = ACTION_COPY[action] || ACTION_COPY.restore;
  if (!succeeded.length && !failed.length) return null;
  if (!failed.length) {
    return { message: `${copy.done} ${pluralItems(succeeded.length)}.`, type: 'success' };
  }
  if (!succeeded.length) {
    return { message: `${copy.failedLead} ${pluralItems(failed.length)}: ${nameList(failed)}.`, type: 'error' };
  }
  return {
    message: `${copy.done} ${pluralItems(succeeded.length)}. ${failed.length} ${copy.failed}: ${nameList(failed)}.`,
    type: 'error',
  };
}

/** A rejection (or a thrown callback) means nothing landed. */
export function buildBulkFailureMessage(action, items = []) {
  return buildBulkOutcomeMessage(action, { succeeded: [], failed: items });
}
