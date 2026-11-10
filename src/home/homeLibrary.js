/* Home list extras copied from Drawboard PDF's Home (trial 2026-11-09,
   /mnt/project-files/drawboard-trial/pdf-pro/r2-a-home-integrations-share.md):
   personal tags, Shared by me / Shared with me, Last opened and Created
   columns, more sorts and four list sizes. Pure helpers only, so they test
   in node (tests/homeLibrary.test.mjs); the data lives in homeLibraryData.js
   and the screens in HomeLibraryBits.jsx. Each part has its own Nightly flag:
   home-tags, home-shared-views, home-columns. */

export const TAG_MAX_LENGTH = 40;

/* Drawboard's tag field: "Separate tags with commas". Spaces round each tag
   go; empty pieces and repeats (any case) go; a tag longer than 40 letters
   is cut. Case is kept as typed, like Drawboard. */
export function parseTagInput(text) {
  const out = [];
  const seen = new Set();
  for (const piece of String(text || '').split(',')) {
    const tag = piece.replace(/\s+/g, ' ').trim().slice(0, TAG_MAX_LENGTH).trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

/* The Tags list in the side bar: each tag once with how many of the listed
   documents carry it, a to z. `tagsByDoc` is Map(docId -> string[]). */
export function tagCounts(tagsByDoc, docIds) {
  const counts = new Map();
  const names = new Map();
  for (const id of docIds || []) {
    for (const tag of tagsByDoc?.get(id) || []) {
      const key = tag.toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!names.has(key)) names.set(key, tag);
    }
  }
  return [...counts.keys()]
    .map((key) => ({ tag: names.get(key), count: counts.get(key) }))
    .sort((a, b) => byName(a.tag, b.tag));
}

/* Every tag you have used, a to z: the toggle chips in the Add tag popover. */
export function allTags(tagsByDoc) {
  return tagCounts(tagsByDoc, tagsByDoc ? [...tagsByDoc.keys()] : []).map((row) => row.tag);
}

export function hasTag(tags, tag) {
  const key = String(tag || '').toLowerCase();
  return (tags || []).some((t) => t.toLowerCase() === key);
}

/* Which documents a Home view shows.
   all            every document in the list
   shared-by-me   mine, and someone else can reach it (my_shared_document_ids)
   shared-with-me someone else's, shared with me
   A tag filter (Drawboard's Tags list) narrows any view. */
export const HOME_VIEWS = ['all', 'shared-by-me', 'shared-with-me'];

export function isSharedWithMe(raw, userId) {
  return Boolean(userId && raw?.user_id && raw.user_id !== userId);
}

export function inHomeView(raw, { view = 'all', userId = null, sharedByMeIds = null } = {}) {
  if (view === 'shared-with-me') return isSharedWithMe(raw, userId);
  if (view === 'shared-by-me') {
    return Boolean(raw?.id && userId && raw.user_id === userId && sharedByMeIds?.has(raw.id));
  }
  return true;
}

export function homeViewCounts(raws, { userId = null, sharedByMeIds = null } = {}) {
  const counts = { all: 0, 'shared-by-me': 0, 'shared-with-me': 0 };
  for (const raw of raws || []) {
    counts.all += 1;
    if (inHomeView(raw, { view: 'shared-by-me', userId, sharedByMeIds })) counts['shared-by-me'] += 1;
    if (inHomeView(raw, { view: 'shared-with-me', userId })) counts['shared-with-me'] += 1;
  }
  return counts;
}

/* Search matches the name, or (with tags on) any of the document's tags,
   like Drawboard's "Keyword and tag search". */
export function matchesHomeSearch(name, tags, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  if (String(name || '').toLowerCase().includes(q)) return true;
  return (tags || []).some((tag) => tag.toLowerCase().includes(q));
}

/* Sorts. Drawboard has Name, Location, Author, Last opened, Created, Last
   modified, Last modified by me and Page count; Survey keeps its Project
   and Size and leaves Author out (a shared document's owner name is not in
   the list). A key's
   first click goes newest / biggest first for dates and numbers, a to z for
   words (Drawboard's arrows do the same). Never-opened documents sit after
   every opened one in either direction. */
export const HOME_SORTS = [
  ['name', 'File'],
  ['project', 'Project'],
  ['opened', 'Last opened'],
  ['created', 'Created'],
  ['edited', 'Last edited'],
  ['pages', 'Pages'],
  ['size', 'Size'],
];
const FIRST_DESC = new Set(['opened', 'created', 'edited', 'pages', 'size']);
export const firstSortDir = (key) => (FIRST_DESC.has(key) ? 'desc' : 'asc');

export function sortHomeRows(rows, key, dir) {
  const sign = dir === 'asc' ? 1 : -1;
  const list = [...(rows || [])];
  const num = (field) => (a, b) => {
    const x = a[field] || 0;
    const y = b[field] || 0;
    if (!x && !y) return byName(a.name || '', b.name || '');
    if (!x) return 1;
    if (!y) return -1;
    return sign * (x - y) || byName(a.name || '', b.name || '');
  };
  const word = (field) => (a, b) => sign * byName(String(a[field] || ''), String(b[field] || ''));
  const compare = {
    name: word('name'),
    project: word('project'),
    opened: num('openedMs'),
    created: num('createdMs'),
    edited: num('editedMs'),
    pages: num('pages'),
    size: num('sizeBytes'),
  }[key];
  return compare ? list.sort(compare) : list;
}

/* "3 mins ago" (Drawboard's Last opened). Under a minute: "Just now"; then
   minutes, hours, "Yesterday", days up to a week, then the date. */
export function relativeTime(ms, now = Date.now()) {
  const t = Number(ms) || 0;
  if (!t) return '';
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min${min === 1 ? '' : 's'} ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/* List sizes (Drawboard's view menu: Large list, Medium list, Compact list,
   Tiles). Medium is Survey's list as it always was. */
export const LIST_DENSITIES = [
  ['large', 'Large list'],
  ['medium', 'Medium list'],
  ['compact', 'Compact list'],
  ['tiles', 'Tiles'],
];
export const DENSITY_ROW = {
  large: { thumb: 46, pad: 18, height: 76 },
  medium: { thumb: 30, pad: 12, height: 50 },
  compact: { thumb: 18, pad: 6, height: 32 },
};

/* The list's columns for the room it has. With the extras on, Survey's
   fixed class templates give way to this: columns drop one at a time as the
   list narrows (Size, Created, Project, Last edited, Tags), so the name keeps
   at least 160 px and the row's More button stays on screen. */
const COLUMN_WIDTH = { project: 120, opened: 108, created: 104, edited: 110, size: 72, tags: 156 };
const DROP_ORDER = ['size', 'created', 'project', 'edited', 'tags', 'opened'];
const FIXED = 32 + 54 + 36;
const NAME_MIN = 160;

export function homeLedgerColumns({ width = 0, opened = false, created = false, tags = false, thumb = 54 } = {}) {
  const keys = ['project'];
  if (opened) keys.push('opened');
  if (created) keys.push('created');
  keys.push('edited', 'size');
  if (tags) keys.push('tags');
  const shown = new Set(keys);
  const need = () => FIXED - 54 + thumb + NAME_MIN + [...shown].reduce((sum, key) => sum + COLUMN_WIDTH[key], 0);
  if (width > 0) {
    for (const key of DROP_ORDER) {
      if (need() <= width) break;
      shown.delete(key);
    }
  }
  const visible = keys.filter((key) => shown.has(key));
  const template = ['32px', `${thumb + 24}px`, `minmax(${NAME_MIN}px, 2fr)`, ...visible.map((key) => `${COLUMN_WIDTH[key]}px`), '36px'].join(' ');
  return { keys: visible, template };
}

export const HOME_VIEW_KEY = 'survey.home.listView';

export function readListView(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(HOME_VIEW_KEY) || 'null');
    const density = LIST_DENSITIES.some(([key]) => key === parsed?.density) ? parsed.density : 'medium';
    return { density };
  } catch {
    return { density: 'medium' };
  }
}

export function writeListView(storage, view) {
  try { storage?.setItem(HOME_VIEW_KEY, JSON.stringify({ density: view.density })); } catch { /* private mode */ }
}
