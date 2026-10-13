// Auto "Complete" entity for a Survey Marker (owner ruling 2026-10-01).
//
// Owner: "When every checklist answer is Y or N/A, set the entity to Complete
// by itself, but never undo it."
//   - Every ACTIVE (not archived) checklist item has an answer and none is N
//     -> the marker's entity becomes the template's Complete entity.
//   - Answers changing later never clear or change the entity (no "set back to
//     None" when an answer turns N, as the old rule did).
//   - It does not depend on a Space being selected (the old rule only ran when
//     one was, so on most surveys it silently never fired).
// One shared rule for the desktop rail and the phone sheet
// (SurveySpacesRail.applyChecklistResponseSelection).

const COMPLETE_FLAG_KEYS = ['isComplete', 'complete'];

/**
 * The template's Complete entity, or null. A flag wins (an entity marked
 * `isComplete: true`, or with id / key 'complete'); then the entity whose name
 * IS "Complete" (any case, trimmed); then one whose name contains the word
 * "complete" ("100% Complete") but not as "incomplete" / "not complete".
 */
export function findCompleteEntity(entities) {
  const list = Array.isArray(entities) ? entities.filter(Boolean) : [];
  const flagged = list.find((entity) => (
    COMPLETE_FLAG_KEYS.some((key) => entity[key] === true)
    || String(entity.id ?? '').toLowerCase() === 'complete'
    || String(entity.key ?? '').toLowerCase() === 'complete'
  ));
  if (flagged) return flagged;
  const nameOf = (entity) => String(entity.name ?? entity.role ?? '').trim().toLowerCase();
  const exact = list.find((entity) => nameOf(entity) === 'complete');
  if (exact) return exact;
  return list.find((entity) => {
    const name = nameOf(entity);
    return /\bcomplete\b/.test(name) && !/\b(in|not|un)[\s-]?complete\b/.test(name);
  }) || null;
}

/** True when every active checklist item is answered Y or N/A (none N, none blank). */
export function isChecklistAllYesOrNA(checklist, responses) {
  const active = (Array.isArray(checklist) ? checklist : []).filter((item) => item && item.archived !== true);
  if (active.length === 0) return false;
  return active.every((item) => {
    const selection = responses?.[item.id]?.selection;
    return selection === 'Y' || selection === 'N/A';
  });
}

/**
 * The entity to set after an answer changes, or null for "leave the entity
 * alone". Only ever returns the Complete entity, and only when the marker is
 * not already on it - so it never clears or downgrades an entity.
 */
export function resolveAutoCompleteEntity({ checklist, responses, entities, currentEntityId } = {}) {
  if (!isChecklistAllYesOrNA(checklist, responses)) return null;
  const complete = findCompleteEntity(entities);
  if (!complete) return null;
  if (currentEntityId && String(currentEntityId) === String(complete.id)) return null;
  return complete;
}
