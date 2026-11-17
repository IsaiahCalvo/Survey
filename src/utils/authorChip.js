// Nightly 'author-chip' (Drawboard Projects parity SS-03 / SS-04): the picked
// marks' quick bar names who made them ("You · Nov 15", or "3 people"), and
// the chip opens a small table of the pick by author, with each mark's date
// and layer. Pure.
import { getAnnotationAuthorId } from '../lib/collab/permissionScope.js';
import { normalizeLayerState, resolveLayerId } from './layers.js';
import { authorLabel, markCreatedAt } from './markupList.js';

function shortDate(iso, locale) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * The pick grouped by author: [{ authorId, label, marks: [{ date, layer }] }],
 * the viewer's own group first, then by name. Each group's marks are newest first.
 */
export function authorGroups(objects, { viewerId = null, peopleById = null, layerState = null, locale } = {}) {
  const state = layerState ? normalizeLayerState(layerState) : null;
  const names = new Map((state?.layers || []).map((layer) => [layer.id, layer.name]));
  const groups = new Map();
  for (const object of objects || []) {
    if (!object) continue;
    const authorId = getAnnotationAuthorId(object) || '';
    if (!groups.has(authorId)) {
      groups.set(authorId, { authorId, label: authorLabel(authorId || null, { viewerId, peopleById }), marks: [] });
    }
    const created = markCreatedAt(object);
    groups.get(authorId).marks.push({
      at: created ? new Date(created).getTime() || 0 : 0,
      date: shortDate(created, locale),
      layer: state ? (names.get(resolveLayerId(object, state)) || '') : '',
    });
  }
  const list = [...groups.values()];
  for (const group of list) group.marks.sort((a, b) => b.at - a.at);
  return list.sort((a, b) => {
    if (a.label === 'You') return -1;
    if (b.label === 'You') return 1;
    return a.label.localeCompare(b.label);
  });
}

/**
 * The chip's words: "You · Nov 15, 2026" for one mark, "You" for one author,
 * "3 people" for more. None when no one in the pick is known (marks from the
 * PDF itself, or made with no account): Drawboard shows no author for those,
 * and "Unknown" tells the user nothing.
 */
export function authorChipText(groups) {
  const list = groups || [];
  if (!list.length) return '';
  if (list.every((group) => !group.authorId)) return '';
  if (list.length > 1) return `${list.length} people`;
  const [only] = list;
  if (only.marks.length === 1 && only.marks[0].date) return `${only.label} · ${only.marks[0].date}`;
  return only.label;
}
