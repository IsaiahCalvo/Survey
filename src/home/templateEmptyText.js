/* Empty-state copy for the template editor's category list. With no modules
   there is no module to hold categories, so the hint points at adding one. */
export function templateCategoryEmptyText(moduleCount) {
  return moduleCount > 0
    ? 'This module has no categories yet.'
    : 'No modules yet. Add a module to start.';
}
