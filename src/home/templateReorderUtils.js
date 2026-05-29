/**
 * templateReorderUtils.js — pure helpers for reordering template structures.
 *
 * Exports restrictSortableToVerticalAxis (dnd-kit modifier locking drag to Y),
 * reorderItemsByActiveOver (moves an item by active/over id via moveItemById),
 * and reorderCategoriesByActiveOver (reorders categories within one module).
 * Consumed by the template reorder UI (e.g. TemplateReorderRows).
 */
import { moveItemById } from '../reorder/flatReorderUtils.js';

export const restrictSortableToVerticalAxis = ({ transform }) => ({
  ...transform,
  x: 0,
});

export const reorderItemsByActiveOver = (items, activeId, overId) => {
  return moveItemById(items, activeId, overId);
};

export const reorderCategoriesByActiveOver = (modules, moduleId, activeId, overId) => (
  modules.map((module) => {
    if (module.id !== moduleId) {
      return module;
    }

    const categories = module.categories || [];
    const nextCategories = reorderItemsByActiveOver(categories, activeId, overId);

    if (nextCategories === categories) {
      return module;
    }

    return {
      ...module,
      categories: nextCategories
    };
  })
);
