export const restrictSortableToVerticalAxis = ({ transform }) => ({
  ...transform,
  x: 0,
});

const moveArrayItem = (items, fromIndex, toIndex) => {
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
};

export const reorderItemsByActiveOver = (items, activeId, overId) => {
  const oldIndex = items.findIndex((item) => item.id === activeId);
  const newIndex = items.findIndex((item) => item.id === overId);

  if (oldIndex === -1 || newIndex === -1) {
    return items;
  }

  return moveArrayItem(items, oldIndex, newIndex);
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
