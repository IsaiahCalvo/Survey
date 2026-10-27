/**
 * surveyCategoryDelete.js — remove one or more categories from a module of a
 * survey template, in ONE pass.
 *
 * The Survey rail deletes every ticked category with one call. It used to call
 * the delete once per category; each call started from the same old template,
 * so the last call won and put the earlier categories back (tick Cameras and
 * Doors, Delete: only Doors went away).
 *
 * Pure: returns new arrays and never changes its input.
 */

/** One id or a list of ids -> a de-duplicated list of non-empty ids. */
export function toCategoryIdList(categoryIdOrIds) {
  const list = Array.isArray(categoryIdOrIds) ? categoryIdOrIds : [categoryIdOrIds];
  return [...new Set(list.filter((id) => id != null && id !== ''))];
}

/**
 * Remove the given categories from module `moduleId`.
 * @param {Array} modules  template.modules (or template.spaces)
 * @param {string} moduleId
 * @param {string|string[]} categoryIdOrIds
 * @returns {{ modules: Array, changed: boolean, removedIds: string[],
 *   removed: Array<{ category: object, index: number }> }} `removed` is what
 *   restoreCategoriesToModules needs to put them back where they were.
 */
export function removeCategoriesFromModules(modules, moduleId, categoryIdOrIds) {
  const source = Array.isArray(modules) ? modules : [];
  const ids = new Set(toCategoryIdList(categoryIdOrIds));
  const removedIds = [];
  const removed = [];
  if (!moduleId || ids.size === 0) return { modules: source, changed: false, removedIds, removed };
  const nextModules = source.map((module) => {
    if (module?.id !== moduleId) return module;
    const categories = module.categories || [];
    const nextCategories = categories.filter((category, index) => {
      if (!ids.has(category?.id)) return true;
      removedIds.push(category.id);
      removed.push({ category, index });
      return false;
    });
    if (nextCategories.length === categories.length) return module;
    return { ...module, categories: nextCategories };
  });
  const changed = removedIds.length > 0;
  return { modules: changed ? nextModules : source, changed, removedIds, removed };
}

/**
 * Undo of a category delete: put the `removed` categories back into module
 * `moduleId` at the places they had (or the end, if the list is shorter now).
 * A category that is already there again is left alone.
 * @returns {{ modules: Array, changed: boolean }}
 */
export function restoreCategoriesToModules(modules, moduleId, removed) {
  const source = Array.isArray(modules) ? modules : [];
  const entries = (Array.isArray(removed) ? removed : [])
    .filter((entry) => entry?.category?.id != null)
    .sort((a, b) => a.index - b.index);
  if (!moduleId || entries.length === 0) return { modules: source, changed: false };
  let changed = false;
  const nextModules = source.map((module) => {
    if (module?.id !== moduleId) return module;
    const categories = [...(module.categories || [])];
    entries.forEach(({ category, index }) => {
      if (categories.some((existing) => existing?.id === category.id)) return;
      categories.splice(Math.min(Math.max(0, index), categories.length), 0, category);
      changed = true;
    });
    return changed ? { ...module, categories } : module;
  });
  return { modules: changed ? nextModules : source, changed };
}
