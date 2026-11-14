/* A Survey tab pinned to one project, list or drawing in a Teams channel or
   chat (Drawboard Projects lets a channel tab open a list or a drawing).
   Teams opens <site>/teams/config when someone adds the tab; the person picks
   what the tab shows and Teams saves the address built here. Plain JS, no
   Teams library, so the unit tests and the config page share it. */

export const TEAMS_CONFIG_PATH = '/teams/config';

/** What a pinned tab can open, in the order the picker shows them. */
export const PIN_LISTS = Object.freeze([
  { key: 'files', label: 'Files' },
  { key: 'issue', label: 'Issues' },
  { key: 'task', label: 'Tasks' },
  { key: 'photos', label: 'Photos' },
]);

const LIST_KEYS = new Set(PIN_LISTS.map((l) => l.key));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the choice names a real project (and, if set, a real drawing). */
export function pinChoiceValid(choice) {
  if (!choice || !UUID_RE.test(choice.projectId || '')) return false;
  if (choice.docId != null && !UUID_RE.test(choice.docId)) return false;
  return true;
}

const listOf = (choice) => (LIST_KEYS.has(choice?.list) ? choice.list : 'files');

/** The query that opens the choice: ?project=&list= or ?project=&doc=. */
export function pinQuery(choice) {
  const q = new URLSearchParams({ project: choice.projectId });
  if (choice.docId) q.set('doc', choice.docId);
  else q.set('list', listOf(choice));
  return q.toString();
}

/** The tab name Teams suggests: "Tower A", "Tower A issues" or the drawing's name. */
export function pinTabName(choice) {
  const name = String(choice?.docName || choice?.projectName || 'Survey').trim().slice(0, 100) || 'Survey';
  if (choice?.docId) return name;
  const list = listOf(choice);
  return list === 'files' ? name : `${name} ${PIN_LISTS.find((l) => l.key === list).label.toLowerCase()}`;
}

/**
 * What Teams saves for the tab (pages.config.setConfig). The tab itself opens
 * <site>/teams?…; "Go to website" opens the same thing in the browser.
 */
export function pinnedTabConfig(origin, choice) {
  if (!pinChoiceValid(choice)) throw new Error('Pick a project first');
  const site = new URL(origin).origin;
  const query = pinQuery(choice);
  return {
    entityId: choice.docId ? `survey-doc-${choice.docId}` : `survey-${choice.projectId}-${listOf(choice)}`,
    contentUrl: `${site}/teams?${query}`,
    websiteUrl: `${site}/?${query}`,
    suggestedDisplayName: pinTabName(choice),
  };
}
