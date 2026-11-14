/* Projects: Photos tab (flag `project-photos`, Drawboard Projects parity
   AE-32..39, IS-15..17 in drawboard-trial/deep/projects-parity-spec.md).
   Pure helpers, no React and no network, so tests/projectPhotos.test.mjs can
   run them. The data hook is projectPhotosData.js; the screens are
   ProjectPhotosPanel.jsx and PhotoMarkupEditor.jsx; the tables are migration
   20261114120000_project_photos.sql. */

export const PROJECT_PHOTOS_BUCKET = 'project-photos';
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => UUID_RE.test(String(v || ''));

const EXT_FOR_MIME = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' });
export const photoMimeAllowed = (mime) => Object.prototype.hasOwnProperty.call(EXT_FOR_MIME, mime);

/** The original: <project>/<photo>.<ext>. The server checks the same shape. */
export function photoPath(projectId, photoId, mime) {
  const ext = EXT_FOR_MIME[mime];
  if (!ext || !isUuid(projectId) || !isUuid(photoId)) return null;
  return `${String(projectId).toLowerCase()}/${String(photoId).toLowerCase()}.${ext}`;
}

/** A marked copy: <project>/<photo>-m<n>.png. n goes up each save so an old
   signed URL (or a cached image) never shows a newer markup by mistake. */
export function markedPhotoPath(projectId, photoId, previousMarkedPath) {
  if (!isUuid(projectId) || !isUuid(photoId)) return null;
  const m = /-m(\d{1,6})\.(png|jpg)$/.exec(String(previousMarkedPath || ''));
  const next = m ? (Number(m[1]) % 999999) + 1 : 1;
  return `${String(projectId).toLowerCase()}/${String(photoId).toLowerCase()}-m${next}.png`;
}

/** What to show: the marked copy when there is one, else the original. */
export const shownPath = (photo) => photo?.marked_path || photo?.path || null;

/* Drawboard's grouping: Day / Week / Month. Weeks start on Monday (ISO). */
export const GROUPINGS = Object.freeze([
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
]);

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));

function mondayOf(d) {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const back = (out.getDay() + 6) % 7; // Monday = 0
  out.setDate(out.getDate() - back);
  return out;
}

/** Group key and heading for one moment, in the device's own time zone. */
export function groupOf(createdAt, grouping = 'day', now = new Date()) {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return { key: 'unknown', label: 'Unknown date' };
  const sameYear = d.getFullYear() === now.getFullYear();
  if (grouping === 'month') {
    return { key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` };
  }
  if (grouping === 'week') {
    const start = mondayOf(d);
    const end = new Date(start); end.setDate(end.getDate() + 6);
    const startLabel = `${SHORT_MONTHS[start.getMonth()]} ${start.getDate()}`;
    const endLabel = start.getMonth() === end.getMonth() ? `${end.getDate()}` : `${SHORT_MONTHS[end.getMonth()]} ${end.getDate()}`;
    const year = sameYear && end.getFullYear() === now.getFullYear() ? '' : `, ${end.getFullYear()}`;
    return { key: `w${dayKey(start)}`, label: `Week of ${startLabel} – ${endLabel}${year}` };
  }
  const today = dayKey(now);
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const k = dayKey(d);
  if (k === today) return { key: k, label: 'Today' };
  if (k === dayKey(yesterday)) return { key: k, label: 'Yesterday' };
  return { key: k, label: `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}${sameYear ? '' : `, ${d.getFullYear()}`}` };
}

/** Newest group first, newest photo first inside a group. */
export function groupPhotos(photos, grouping = 'day', now = new Date()) {
  const sorted = [...(photos || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const groups = [];
  const byKey = new Map();
  for (const p of sorted) {
    const g = groupOf(p.created_at, grouping, now);
    let entry = byKey.get(g.key);
    if (!entry) { entry = { ...g, photos: [] }; byKey.set(g.key, entry); groups.push(entry); }
    entry.photos.push(p);
  }
  return groups;
}

/* Filter card, as Drawboard's: three switches, an uploader list and a time
   window. "Linked" and "Not linked" together cancel out (show all). */
export const WITHIN_OPTIONS = Object.freeze([
  { key: 'all', label: 'All time' },
  { key: 'day', label: 'Last day' },
  { key: 'week', label: 'Last full week' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'range', label: 'Date range' },
]);

export const EMPTY_FILTER = Object.freeze({
  mine: false, linked: false, unlinked: false, uploaders: [], within: 'all', from: '', to: '',
});

export const filterIsEmpty = (f) => !f || (!f.mine && !f.linked && !f.unlinked && !(f.uploaders || []).length && (f.within || 'all') === 'all');

/** [startMs, endMs) for a time window, or null for all time. */
export function withinRange(filter, now = new Date()) {
  const within = filter?.within || 'all';
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (within === 'day') return [now.getTime() - 86400000, Infinity];
  if (within === '30d') return [now.getTime() - 30 * 86400000, Infinity];
  if (within === 'week') {
    // The last FULL Monday-to-Sunday week before this one.
    const thisMonday = mondayOf(midnight);
    const start = new Date(thisMonday); start.setDate(start.getDate() - 7);
    return [start.getTime(), thisMonday.getTime()];
  }
  if (within === 'range') {
    const parse = (s) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
      return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
    };
    const from = parse(filter.from);
    const to = parse(filter.to);
    if (!from && !to) return null;
    const end = to ? new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1) : null;
    return [from ? from.getTime() : -Infinity, end ? end.getTime() : Infinity];
  }
  return null;
}

/** linkCounts: Map photo id -> number of linked items. */
export function filterPhotos(photos, filter, { userId, linkCounts = new Map(), now = new Date() } = {}) {
  if (filterIsEmpty(filter)) return [...(photos || [])];
  const range = withinRange(filter, now);
  const uploaders = new Set(filter.uploaders || []);
  const onlyLinked = filter.linked && !filter.unlinked;
  const onlyUnlinked = filter.unlinked && !filter.linked;
  return (photos || []).filter((p) => {
    if (filter.mine && p.uploaded_by !== userId) return false;
    if (uploaders.size && !uploaders.has(p.uploaded_by)) return false;
    const links = linkCounts.get(p.id) || 0;
    if (onlyLinked && !links) return false;
    if (onlyUnlinked && links) return false;
    if (range) {
      const t = new Date(p.created_at).getTime();
      if (!(t >= range[0] && t < range[1])) return false;
    }
    return true;
  });
}

/** "11/10/2026 at 1:10 AM" in the device's own zone, like Drawboard's card. */
export function uploadedOn(createdAt) {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const hour = ((h + 11) % 12) + 1;
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} at ${hour}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Download name: "<Project> photo 2026-11-10 0110 (1).jpg"-style, safe. */
export function photoFileName(projectName, photo, index = 0) {
  const d = new Date(photo?.created_at);
  const stamp = Number.isNaN(d.getTime()) ? 'photo' : `${dayKey(d)} ${pad(d.getHours())}${pad(d.getMinutes())}`;
  const base = String(projectName || 'Project').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Project';
  const path = shownPath(photo) || '';
  const ext = (/\.([a-z]+)$/.exec(path) || [null, 'jpg'])[1];
  return `${base} photo ${stamp}${index ? ` (${index + 1})` : ''}.${ext}`;
}

/* Markup editor model (PhotoMarkupEditor.jsx). Coordinates are in IMAGE
   pixels so a mark lands on the same spot at any zoom; widths are Drawboard's
   2 / 4 / 8, scaled to the photo so a thin line still reads on a 4000 px
   picture. */
export const MARKUP_TOOLS = Object.freeze(['pen', 'text', 'arrow', 'select']);
export const MARKUP_WIDTHS = Object.freeze([2, 4, 8]);
export const MARKUP_COLOURS = Object.freeze([
  { key: 'red', label: 'Red', value: '#e5202e' },
  { key: 'blue', label: 'Blue', value: '#1565d8' },
  { key: 'black', label: 'Black', value: '#1a1a1a' },
]);

/** A width step in image pixels: base widths are for a 1000 px long edge. */
export const strokeScale = (imgW, imgH) => Math.max(1, Math.max(Number(imgW) || 0, Number(imgH) || 0) / 1000);

/** Arrow head points for a shaft from (x1,y1) to (x2,y2). */
export function arrowHead(x1, y1, x2, y2, width) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const head = Math.max(10, width * 4);
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const bx = x2 - ux * head;
  const by = y2 - uy * head;
  const half = head * 0.55;
  return [[x2, y2], [bx - uy * half, by + ux * half], [bx + uy * half, by - ux * half]];
}

/** Bounding box of one mark in image pixels (for Select and hit tests). */
export function markBounds(mark) {
  if (!mark) return null;
  if (mark.kind === 'text') {
    const size = mark.size || 24;
    const lines = String(mark.text || '').split('\n');
    const w = Math.max(...lines.map((l) => l.length), 1) * size * 0.58;
    return { x: mark.x, y: mark.y, w, h: lines.length * size * 1.25 };
  }
  const pts = mark.kind === 'arrow' ? [[mark.x1, mark.y1], [mark.x2, mark.y2]] : (mark.points || []);
  if (!pts.length) return null;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const pad2 = (mark.width || 4) * 2;
  return { x: minX - pad2, y: minY - pad2, w: maxX - minX + pad2 * 2, h: maxY - minY + pad2 * 2 };
}

/** Topmost mark under a point, or -1. */
export function hitMark(marks, x, y) {
  for (let i = (marks || []).length - 1; i >= 0; i -= 1) {
    const b = markBounds(marks[i]);
    if (b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return i;
  }
  return -1;
}

/** Move one mark by dx, dy (image pixels). */
export function moveMark(mark, dx, dy) {
  if (mark.kind === 'text') return { ...mark, x: mark.x + dx, y: mark.y + dy };
  if (mark.kind === 'arrow') return { ...mark, x1: mark.x1 + dx, y1: mark.y1 + dy, x2: mark.x2 + dx, y2: mark.y2 + dy };
  return { ...mark, points: (mark.points || []).map(([x, y]) => [x + dx, y + dy]) };
}

/** The dashed box round a picked mark in the editor. */
export const PICK_OUTLINE = '#1565d8';
