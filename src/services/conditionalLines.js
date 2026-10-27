// Conditional lines (Nightly beta 'conditional-lines', plan 2026-10-27; owner:
// "wire it in, hide it, I may never need it"). A checklist line can say
// "show me only when that other line is answered this way", for example
// Address only when Protocol is OSDP:
//   { id: 'chk-address', text: 'Address', showIf: { itemId: 'chk-protocol', value: 'OSDP' } }
// A hidden line keeps any answer it had, but the card does not show it and
// it does not count toward done or Complete. The flag is off on Nightly too
// until someone turns it on (FEATURE_FLAGS nightlyOn: false).
import { checklistItemKind, manyPicked } from '../../supabase/functions/_shared/kitShape.js';

export const SHOW_IF_VALUE_MAX = 60;

/** A line's condition, cleaned: { itemId, value }, or null when it has none. */
export function showIfOf(item) {
  const c = item?.showIf;
  const itemId = typeof c?.itemId === 'string' ? c.itemId.trim() : '';
  const value = typeof c?.value === 'string' ? c.value.trim().slice(0, SHOW_IF_VALUE_MAX) : '';
  return itemId && value && itemId !== item?.id ? { itemId, value } : null;
}

/** Whether a line's answer is `value` (one of the picks, for a Pick many line). */
export function answerIs(item, selection, value) {
  if (selection == null || selection === '') return false;
  if (checklistItemKind(item) === 'many') return manyPicked(item, selection).has(value);
  return String(selection).trim().toLowerCase() === value.toLowerCase();
}

/**
 * The lines a card shows: the active (not archived) lines, less those whose
 * condition is not met. A line whose condition names a line that is gone or
 * archived shows (nothing can meet it, so hiding it would lose the line); a
 * line under a hidden line is hidden too. `on: false` ignores conditions.
 */
export function shownChecklist(checklist, responses, { on = true } = {}) {
  const active = (Array.isArray(checklist) ? checklist : []).filter((item) => item && item.archived !== true);
  if (!on || !active.some((item) => showIfOf(item))) return active;
  const byId = new Map(active.map((item) => [item.id, item]));
  // A line in a loop (A under B under A) can never be met: it has no condition.
  const inLoop = (item) => {
    let at = item;
    for (let step = 0; step <= active.length; step += 1) {
      at = byId.get(showIfOf(at)?.itemId);
      if (!at) return false;
      if (at === item) return true;
    }
    return false;
  };
  const seen = new Map();
  const shows = (item) => {
    const cond = showIfOf(item);
    if (!cond) return true;
    if (seen.has(item.id)) return seen.get(item.id);
    const source = byId.get(cond.itemId);
    const result = !source || inLoop(item)
      ? true
      : shows(source) && answerIs(source, responses?.[source.id]?.selection, cond.value);
    seen.set(item.id, result);
    return result;
  };
  return active.filter((item) => shows(item));
}

/**
 * What the template editor offers a line as its condition: every answer of
 * each pick-one or Pick many line above it. `answersOf(item)` gives a line's
 * answers ([{ value }]).
 */
export function showIfChoices(checklist, itemId, answersOf) {
  const active = (Array.isArray(checklist) ? checklist : []).filter((item) => item && item.archived !== true);
  const at = active.findIndex((item) => item.id === itemId);
  return active.slice(0, Math.max(at, 0))
    .filter((item) => ['choice', 'many'].includes(checklistItemKind(item)))
    .flatMap((item) => (answersOf(item) || []).map((a) => ({ itemId: item.id, value: a.value, label: `When "${item.text || 'line'}" is ${a.value}` })));
}
