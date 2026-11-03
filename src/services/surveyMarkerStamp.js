// Changed By / Changed Date on survey markers.
//
// The Excel columns "Changed By" and "Changed Date" read a marker's
// changedBy (initials) and changedDate (ISO time). Nothing in the app set
// them on an edit: only Export data filled blanks with the exporter's
// initials at export time, so a live workbook showed both columns empty
// (owner 2026-11-03). This stamps every marker whose survey data the person
// at this screen just changed.
//
// Only what goes in the sheet counts as a change (name, answers, entity,
// notes, category); moving or resizing a marker on the page does not. A
// write that sets changedBy or changedDate itself (an import, an undo that
// restores them) is left as it is.

const DATA_KEYS = ['name', 'categoryId', 'moduleId', 'checklistResponses', 'entityId', 'entityName', 'note', 'notes'];

function stable(value) {
  if (value === undefined) return 'u';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
}

const dataChanged = (before, after) => DATA_KEYS.some((key) => stable(before?.[key]) !== stable(after?.[key]));

/**
 * The next markers dict with changedBy/changedDate stamped on every marker
 * whose sheet data changed from `prev`. Returns `next` itself when nothing
 * needed a stamp, so React sees no extra change.
 *
 * @param {Object<string, object>} prev
 * @param {Object<string, object>} next
 * @param {{ by: string, at?: string }} stamp  the editor's initials; at = now
 */
export function stampChangedSurveyMarkers(prev, next, { by, at } = {}) {
  if (!next || typeof next !== 'object' || next === prev || !by) return next;
  let out = null;
  const when = at || new Date().toISOString();
  for (const id of Object.keys(next)) {
    const after = next[id];
    if (!after || typeof after !== 'object') continue;
    const before = prev?.[id];
    if (before === after) continue;
    if (before && !dataChanged(before, after)) continue;
    // The write set them itself.
    if (before && (before.changedBy !== after.changedBy || before.changedDate !== after.changedDate)) continue;
    if (!before && after.changedBy) continue;
    if (!out) out = { ...next };
    out[id] = { ...after, changedBy: by, changedDate: when };
  }
  return out || next;
}
