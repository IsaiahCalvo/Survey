// Whether a tool-group button (Draw / Shapes / Text) reads as pressed. Same
// rule as its btn-active class: lit while its row is open or one of its tools
// is armed, but never while Pan or Select is armed.
export function isToolGroupPressed({ activeTool, activeCategoryDropdown, group, toolIds = [] }) {
  if (activeTool === 'pan' || activeTool === 'select') return false;
  return activeCategoryDropdown === group || toolIds.includes(activeTool);
}
