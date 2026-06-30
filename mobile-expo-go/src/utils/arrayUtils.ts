export function clampValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function moveArrayItem<T>(items: T[], fromIndex: number, toIndex: number) {
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length || fromIndex === toIndex) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function moveItemById<T extends { id: string }>(items: T[], id: string, delta: number) {
  const fromIndex = items.findIndex((item) => item.id === id);
  if (fromIndex < 0) return items;
  return moveArrayItem(items, fromIndex, clamp(fromIndex + delta, 0, items.length - 1));
}

export function moveNumberItem(items: number[], value: number, delta: number) {
  const fromIndex = items.indexOf(value);
  if (fromIndex < 0) return items;
  return moveArrayItem(items, fromIndex, clamp(fromIndex + delta, 0, items.length - 1));
}
