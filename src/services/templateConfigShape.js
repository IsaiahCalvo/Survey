/* The one place that knows how a persisted template stores its structure.
 *
 * Extracted from TemplatesEditor.jsx so a second reader — the Archive screen's
 * preview pane — can describe an archived template's contents WITHOUT
 * re-deriving the shape and drifting from the editor. TemplatesEditor imports
 * these same readers, so an archived template reads as the same object the
 * editor shows.
 *
 * Like templatesEditorReload.js this module is deliberately dependency-free
 * (zero imports) so the Node test suite exercises the REAL code — component
 * files resolve only under vite.
 *
 * Persisted shape, with the legacy variants each reader tolerates:
 *   template.modules | template.spaces | template.config.modules
 *     -> module.categories | module.cats
 *          -> category.checklist | category.items   (strings or {id,text})
 *   template.entities | template.config.entities    ({id, name, color, ...})
 */

/* ============================================================
   Defensive readers — templates may carry structure at the top
   level, under a legacy `spaces` key, or inside a `config` blob.
   ============================================================ */
export const modulesOf = (t) => t?.modules || t?.spaces || t?.config?.modules || t?.config?.spaces || [];
export const entitiesOf = (t) => t?.entities || t?.config?.entities || [];
export const categoriesOf = (m) => m?.categories || m?.cats || [];
export const checklistOf = (c) => c?.checklist || c?.items || [];
export const itemText = (it) => (typeof it === 'string' ? it : (it?.text ?? it?.name ?? ''));

/* Normalise a colour value (entities may store an rgba string or a hex). */
export const toHex6 = (color) => {
  if (!color) return '#8c8c8a';
  const c = String(color).trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) {
    return ('#' + c.slice(1).split('').map((ch) => ch + ch).join('')).toLowerCase();
  }
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(c);
  if (m) {
    const hx = (n) => Number(n).toString(16).padStart(2, '0');
    return ('#' + hx(m[1]) + hx(m[2]) + hx(m[3])).toLowerCase();
  }
  return '#8c8c8a';
};

/**
 * A read-only summary of what is inside a template: its modules with their
 * categories nested underneath, and its entities.
 *
 * Deliberately NOT the editor's working shape — no minted ids, no checklist
 * text, no colour-picker refinements. A reader who is about to restore or
 * destroy an archived template needs to recognise it, not edit it, so this
 * carries names, counts and the entity colours and nothing else.
 *
 * Ids are index-derived when a legacy row has none: these are React keys for a
 * list that is never reordered or mutated, so a positional key is honest here
 * (the editor's stable-id minting exists for keyed INPUTS, which this has none
 * of).
 */
export function templateOutline(template) {
  const modules = modulesOf(template).map((mod, mi) => ({
    id: mod?.id ?? `m${mi}`,
    name: mod?.name || `Module ${mi + 1}`,
    categories: categoriesOf(mod).map((cat, ci) => ({
      id: cat?.id ?? `m${mi}c${ci}`,
      name: cat?.name || `Category ${ci + 1}`,
      // Checklist lines are counted, not listed: the preview answers "is this
      // the template I meant?", and a full checklist would bury that.
      itemCount: checklistOf(cat).filter((it) => itemText(it) !== '').length,
    })),
  }));

  const entities = entitiesOf(template).map((entity, ei) => {
    const color = toHex6(entity?.color);
    return {
      id: entity?.id ?? `e${ei}`,
      name: entity?.name || entity?.role || `Entity ${ei + 1}`,
      color,
      // Same rule as the editor's entitySwatch(): "Match fill" collapses the
      // border onto the fill, so the swatch here is the swatch there.
      borderColor: entity?.matchFill ? color : toHex6(entity?.borderColor || entity?.color),
    };
  });

  return { modules, entities };
}
