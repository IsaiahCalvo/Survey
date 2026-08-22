// Survey rail Previous/Next module step. Distinct from clicking a
// category (Walls) or picking a module in the dropdown. Extracted so
// Node can prove first/last ignore without mounting the rail.

export function resolveSurveyModuleStep({
  modules = [],
  selectedModuleId,
  direction,
} = {}) {
  const list = Array.isArray(modules)
    ? modules.filter((module) => module && module.id)
    : [];
  const index = list.findIndex((module) => module.id === selectedModuleId);
  if (index < 0) return { kind: 'ignore' };
  if (direction === 'previous') {
    if (index <= 0) return { kind: 'ignore' };
    return { kind: 'select', moduleId: list[index - 1].id };
  }
  if (direction === 'next') {
    if (index >= list.length - 1) return { kind: 'ignore' };
    return { kind: 'select', moduleId: list[index + 1].id };
  }
  return { kind: 'ignore' };
}
