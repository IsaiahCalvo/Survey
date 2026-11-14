/* A link to one issue or task (?project=&item=&kind=), from the "assigned to
   you" email (Nightly 'item-assign-email'). SurveyHub reads it once signed in
   and shows Projects; the project list picks it up when that project is
   listed and opens the item. Kept tiny so the hub pulls only this.
   A Survey tab pinned in Teams (teams/teamsPin.js) uses the same path with
   no item: ?project=&list= opens a list, ?project=&doc= opens a drawing. */

export const ITEM_LINK_EVENT = 'survey:open-project-item';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LISTS = new Set(['files', 'issue', 'task', 'photos', 'activity']);

/**
 * { projectId, itemId, kind, list, docId } from a URL, or null. An item link
 * opens the item on its list (kind); a project link opens `list` (Files when
 * unknown) or, with doc, that drawing.
 */
export function readItemLink(href) {
  let url;
  try { url = new URL(href); } catch { return null; }
  const projectId = url.searchParams.get('project');
  if (!UUID_RE.test(projectId || '')) return null;
  const itemId = url.searchParams.get('item');
  if (itemId != null) {
    if (!UUID_RE.test(itemId)) return null;
    const kind = url.searchParams.get('kind') === 'task' ? 'task' : 'issue';
    return { projectId, itemId, kind, list: kind, docId: null };
  }
  const docId = url.searchParams.get('doc');
  if (docId != null && !UUID_RE.test(docId)) return null;
  const list = url.searchParams.get('list');
  return { projectId, itemId: null, kind: null, list: LISTS.has(list) ? list : 'files', docId: docId || null };
}

/** The same URL without the item link, for history.replaceState. */
export function withoutItemLink(href) {
  const url = new URL(href);
  for (const key of ['project', 'item', 'kind', 'list', 'doc']) url.searchParams.delete(key);
  return `${url.pathname}${url.search}${url.hash}`;
}

let pending = null;

export function requestItemLink(link) {
  pending = link ? { ...link } : null;
  try {
    window.dispatchEvent(new CustomEvent(ITEM_LINK_EVENT, { detail: pending }));
  } catch {
    // No DOM events here (tests).
  }
}

/** The waiting link, taken once, when its project is one of `projectIds`. */
export function takePendingItemLink(projectIds) {
  if (!pending) return null;
  const ids = projectIds instanceof Set ? projectIds : new Set(projectIds || []);
  if (!ids.has(pending.projectId)) return null;
  const link = pending;
  pending = null;
  return link;
}
