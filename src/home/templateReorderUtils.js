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
