/* Id-keyed bulk-selection helpers (BL-17 S1 / KAL-298).

   Multi-select surfaces key their selection by stable item id, never by array
   position — a reorder, rebuild or refetch between selecting and acting must
   never retarget the action. These helpers resolve ids → items at ACTION time
   against the current list; ids that no longer match anything are silently
   skipped (a stale id affects nothing, never a different item).

   Contract: ids are expected unique per list (true for document ids and
   module ids by construction). If duplicates ever appear anyway, EVERY
   matching item is affected — filter semantics, no first-wins ambiguity. */

const toIdSet = (ids) => (ids instanceof Set ? ids : new Set(ids));

/* Order-preserving items whose `id` is in `ids`. Non-matching ids are
   skipped silently. */
export const pickByIds = (list, ids) => {
  const set = toIdSet(ids);
  return list.filter((item) => set.has(item.id));
};

/* The list minus every item whose `id` is in `ids`. */
export const removeByIds = (list, ids) => {
  const set = toIdSet(ids);
  return list.filter((item) => !set.has(item.id));
};

/* New list where `clone(item)` is inserted immediately after each item whose
   `id` is in `ids`. `clone` is called once per matching item, in list order. */
export const duplicateAfterByIds = (list, ids, clone) => {
  const set = toIdSet(ids);
  const out = [];
  list.forEach((item) => {
    out.push(item);
    if (set.has(item.id)) out.push(clone(item));
  });
  return out;
};
