/* Projects: Issues and Tasks (flag `project-issues`, Drawboard Projects
   parity). Pure helpers, no React and no network, so tests/projectItems.test.mjs
   can run them. The data hook is projectItemsData.js; the screen is
   ProjectItemsPanel.jsx; the tables are migration
   20261110172000_project_items.sql. */

export const ITEM_KINDS = Object.freeze({
  issue: Object.freeze({ key: 'issue', one: 'Issue', many: 'Issues', prefix: 'ISS' }),
  task: Object.freeze({ key: 'task', one: 'Task', many: 'Tasks', prefix: 'TSK' }),
});

/* Drawboard's statuses and its three groups. Draft is where a new item
   starts. Issues and Tasks each have their own list (statusesFor): only a
   Task can be On Hold, only an Issue Approved or Rejected. `tone` picks the
   dot colour (projectItems.css). */
export const ITEM_STATUSES = Object.freeze([
  { key: 'draft', label: 'Draft', group: 'unstarted', tone: 'muted' },
  { key: 'open', label: 'Open', group: 'started', tone: 'info' },
  { key: 'pending', label: 'Pending', group: 'started', tone: 'warning' },
  { key: 'in_review', label: 'In Review', group: 'started', tone: 'review' },
  { key: 'on_hold', label: 'On Hold', group: 'started', tone: 'hold' },
  { key: 'closed', label: 'Closed', group: 'done', tone: 'done' },
  { key: 'approved', label: 'Approved', group: 'done', tone: 'success' },
  { key: 'rejected', label: 'Rejected', group: 'done', tone: 'danger' },
]);

export const STATUS_GROUPS = Object.freeze([
  { key: 'unstarted', label: 'Unstarted' },
  { key: 'started', label: 'Started' },
  { key: 'done', label: 'Done' },
]);

const KIND_STATUS_KEYS = Object.freeze({
  issue: ['draft', 'open', 'pending', 'in_review', 'closed', 'approved', 'rejected'],
  task: ['draft', 'open', 'pending', 'in_review', 'on_hold', 'closed'],
});
/** The statuses one kind of item can take, in Drawboard's order. */
export const statusesFor = (kind) => {
  const keys = KIND_STATUS_KEYS[kind] || KIND_STATUS_KEYS.issue;
  return ITEM_STATUSES.filter((s) => keys.includes(s.key));
};

const STATUS_BY_KEY = new Map(ITEM_STATUSES.map((s) => [s.key, s]));
export const statusInfo = (key) => STATUS_BY_KEY.get(key) || ITEM_STATUSES[0];
export const statusLabel = (key) => statusInfo(key).label;
export const isDone = (item) => statusInfo(item?.status).group === 'done';

export const DUE_SOON_DAYS = 7;

export function itemCode(kind, number) {
  const prefix = (ITEM_KINDS[kind] || ITEM_KINDS.issue).prefix;
  return `${prefix}-${Number(number) || 0}`;
}

/* Today as YYYY-MM-DD in the device's own time zone (due dates are plain
   dates, not moments). */
export function localDay(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayDiff(fromDay, toDay) {
  const a = Date.UTC(...fromDay.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)));
  const b = Date.UTC(...toDay.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)));
  return Math.round((b - a) / 86400000);
}

export function isOverdue(item, today) {
  if (!item?.due_date || isDone(item)) return false;
  return dayDiff(today, item.due_date) < 0;
}

export function isDueSoon(item, today) {
  if (!item?.due_date || isDone(item)) return false;
  const left = dayDiff(today, item.due_date);
  return left >= 0 && left <= DUE_SOON_DAYS;
}

/* "Nov 12" this year, "Nov 12, 2027" another year. */
export function formatDue(day, today) {
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const base = `${months[m - 1]} ${d}`;
  return today && today.slice(0, 4) === String(y) ? base : `${base}, ${y}`;
}

/* Comma separated tags, trimmed, 1 to 40 characters, no repeats (any case). */
export function parseItemTags(text) {
  const out = [];
  for (const raw of String(text || '').split(',')) {
    const tag = raw.trim().slice(0, 40).trim();
    if (tag && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out;
}

export const QUICK_FILTERS = Object.freeze([
  { key: 'created', label: 'Created by me' },
  { key: 'assigned', label: 'Assigned to me' },
  { key: 'due-soon', label: 'Due soon' },
  { key: 'overdue', label: 'Overdue' },
]);

/* The list's filters, all at once (an item must pass every one that is set):
   q          title or ID, any case, any part ("iss-1", "hinge", "12")
   quick      Set of QUICK_FILTERS keys
   groups     Set of status group keys (empty = every group)
   tags       Set of tags (an item with any of them passes)
   assignees  Set of user ids ('none' = nobody assigned)
   archived   true = only archived items, false = only live ones */
export function filterItems(items, {
  q = '', quick = new Set(), groups = new Set(), tags = new Set(), assignees = new Set(),
  archived = false, userId = null, today = localDay(),
} = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const tagKeys = new Set([...tags].map((t) => String(t).toLowerCase()));
  return (items || []).filter((item) => {
    if (Boolean(item.archived_at) !== Boolean(archived)) return false;
    if (needle) {
      const code = itemCode(item.kind, item.number).toLowerCase();
      if (!code.includes(needle) && !String(item.title || '').toLowerCase().includes(needle)) return false;
    }
    if (quick.has('created') && item.created_by !== userId) return false;
    if (quick.has('assigned') && item.assignee_id !== userId) return false;
    if (quick.has('due-soon') && !isDueSoon(item, today)) return false;
    if (quick.has('overdue') && !isOverdue(item, today)) return false;
    if (groups.size && !groups.has(statusInfo(item.status).group)) return false;
    if (tagKeys.size && !(item.tags || []).some((t) => tagKeys.has(String(t).toLowerCase()))) return false;
    if (assignees.size && !assignees.has(item.assignee_id || 'none')) return false;
    return true;
  });
}

export const ITEM_SORTS = Object.freeze([
  { key: 'number', label: 'ID' },
  { key: 'title', label: 'Summary' },
  { key: 'status', label: 'Status' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'due', label: 'Due' },
]);

const STATUS_ORDER = new Map(ITEM_STATUSES.map((s, i) => [s.key, i]));

/* Newest first by ID is the list's default. Items with no due date or no
   assignee always sort last, both ways. */
export function sortItems(items, key = 'number', dir = 'desc', { memberName = () => '' } = {}) {
  const sign = dir === 'asc' ? 1 : -1;
  const value = (item) => {
    switch (key) {
      case 'title': return String(item.title || '').toLowerCase();
      case 'status': return STATUS_ORDER.get(item.status) ?? 0;
      case 'assignee': return item.assignee_id ? String(memberName(item.assignee_id) || '').toLowerCase() : null;
      case 'due': return item.due_date || null;
      default: return Number(item.number) || 0;
    }
  };
  return [...(items || [])].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va == null && vb == null) return (Number(b.number) || 0) - (Number(a.number) || 0);
    if (va == null) return 1;
    if (vb == null) return -1;
    if (va < vb) return -sign;
    if (va > vb) return sign;
    return (Number(b.number) || 0) - (Number(a.number) || 0);
  });
}

export function allItemTags(items) {
  const seen = new Map();
  for (const item of items || []) {
    for (const tag of item.tags || []) {
      const k = tag.toLowerCase();
      if (!seen.has(k)) seen.set(k, tag);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/* "<project> - Issues Register - 2026-11-10 05-33.csv", as Drawboard names
   it (local 24-hour time, a hyphen for the colon). */
export function registerFileName(projectName, kind, now = new Date()) {
  const many = (ITEM_KINDS[kind] || ITEM_KINDS.issue).many;
  const safe = String(projectName || 'Project').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Project';
  const pad = (n) => String(n).padStart(2, '0');
  return `${safe} - ${many} Register - ${localDay(now)} ${pad(now.getHours())}-${pad(now.getMinutes())}.csv`;
}

/* Every field in double quotes, empty ones too, as Drawboard writes it. A
   cell that starts with = + - @ gets a ' first so Excel never runs it as a
   formula (Drawboard does not do this; Survey does). */
function csvCell(value) {
  const text = value == null ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/* "2026-11-10T01:08": UTC, minutes, no seconds, no Z. */
function utcMinute(iso) {
  const at = Date.parse(iso || '');
  return at ? new Date(at).toISOString().slice(0, 16) : '';
}

/* Drawboard's 14 columns, in its order. */
export const REGISTER_COLUMNS = Object.freeze([
  'ID', 'AssetLinks', 'Summary', 'Description', 'Due date', 'Created at (UTC)', 'Last updated at (UTC)',
  'Status', 'Drawings', 'Documents', 'Assigned to', 'Created by', 'Most recent comment', 'Tags',
]);

/* The register, one row per item. Survey's project files are drawings, so
   linked files go under Drawings; Documents and AssetLinks stay empty until
   Survey has those kinds of link. */
export function itemsCsv(items, {
  memberName = () => '', docName = () => '', lastComment = () => '',
} = {}) {
  const rows = [REGISTER_COLUMNS];
  for (const item of items || []) {
    rows.push([
      itemCode(item.kind, item.number),
      '',
      item.title || '',
      item.description || '',
      item.due_date || '',
      utcMinute(item.created_at),
      utcMinute(item.updated_at),
      statusLabel(item.status),
      (item.links || []).map((l) => docName(l.document_id)).filter(Boolean).join(', '),
      '',
      item.assignee_id ? memberName(item.assignee_id) || '' : '',
      item.created_by ? memberName(item.created_by) || '' : '',
      lastComment(item.id) || '',
      (item.tags || []).join(', '),
    ]);
  }
  return `\ufeff${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/* One line of the Activity tab, Drawboard's words: "changed the status from
   'Draft' to 'Open'". */
export function describeEvent(event, { memberName = () => '', kind = 'issue' } = {}) {
  const q = (v) => `'${v}'`;
  const one = (ITEM_KINDS[kind] || ITEM_KINDS.issue).one.toLowerCase();
  switch (event?.action) {
    case 'created': return `created the ${one}`;
    case 'title': return `changed the summary from ${q(event.from_value || '')} to ${q(event.to_value || '')}`;
    case 'description': return 'edited the description';
    case 'status': return `changed the status from ${q(statusLabel(event.from_value))} to ${q(statusLabel(event.to_value))}`;
    case 'assignee':
      if (!event.to_value) return 'removed the assignee';
      return `assigned it to ${memberName(event.to_value) || 'a teammate'}`;
    case 'due':
      if (!event.to_value) return 'removed the due date';
      return event.from_value
        ? `changed the due date from ${q(formatDue(event.from_value, localDay()))} to ${q(formatDue(event.to_value, localDay()))}`
        : `set the due date to ${q(formatDue(event.to_value, localDay()))}`;
    case 'tags': return event.to_value ? `changed the tags to ${q(event.to_value)}` : 'removed the tags';
    case 'links': {
      const before = Number(event.from_value) || 0;
      const after = Number(event.to_value) || 0;
      return after > before ? 'linked a document' : 'unlinked a document';
    }
    case 'archived': return `archived the ${one}`;
    case 'unarchived': return `unarchived the ${one}`;
    default: return 'made a change';
  }
}

/* Fields a duplicate keeps (Drawboard: title as-is, status, due date,
   assignee, description, links). It gets a new ID; comments and history stay
   with the original. */
export function duplicateFields(item) {
  return {
    kind: item.kind,
    status: item.status || 'draft',
    title: item.title || '',
    description: item.description || '',
    assignee_id: item.assignee_id || null,
    due_date: item.due_date || null,
    tags: [...(item.tags || [])],
    links: (item.links || []).map((l) => ({ document_id: l.document_id })),
  };
}

/* Counts for the status-group chips, over the live (not archived) items. */
export function groupCounts(items) {
  const counts = { unstarted: 0, started: 0, done: 0 };
  for (const item of items || []) {
    if (item.archived_at) continue;
    counts[statusInfo(item.status).group] += 1;
  }
  return counts;
}

/* "Just now", "5 mins ago", "3 hours ago", "Yesterday", "4 days ago", or the
   date once it is more than a week old. */
export function timeAgo(iso, now = Date.now()) {
  const at = typeof iso === 'number' ? iso : Date.parse(iso || '');
  if (!at) return '';
  const mins = Math.floor((now - at) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} ${mins === 1 ? 'min' : 'mins'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return formatDue(localDay(new Date(at)), localDay(new Date(now)));
}
