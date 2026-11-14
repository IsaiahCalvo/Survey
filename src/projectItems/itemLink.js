/* A link to one issue or task (?project=&item=&kind=), from the "assigned to
   you" email (Nightly 'item-assign-email'). SurveyHub reads it once signed in
   and shows Projects; the project list picks it up when that project is
   listed and opens the item. Kept tiny so the hub pulls only this. */

export const ITEM_LINK_EVENT = 'survey:open-project-item';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** { projectId, itemId, kind } from a URL, or null. */
export function readItemLink(href) {
  let url;
  try { url = new URL(href); } catch { return null; }
  const projectId = url.searchParams.get('project');
  const itemId = url.searchParams.get('item');
  if (!UUID_RE.test(projectId || '') || !UUID_RE.test(itemId || '')) return null;
  return { projectId, itemId, kind: url.searchParams.get('kind') === 'task' ? 'task' : 'issue' };
}

/** The same URL without the item link, for history.replaceState. */
export function withoutItemLink(href) {
  const url = new URL(href);
  for (const key of ['project', 'item', 'kind']) url.searchParams.delete(key);
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
