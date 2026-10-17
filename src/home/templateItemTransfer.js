// The destination dialog operates on the editor's rich model. Keep a moved
// item's IDs; a copied item's entire child tree gets new IDs.
export function transferTemplateItems(templates, { kind, mode, sourceTemplateId, sourceModuleId, destinationTemplateId, destinationModuleId, ids }, mintId) {
  const source = templates.find((entry) => entry.id === sourceTemplateId);
  const destination = templates.find((entry) => entry.id === destinationTemplateId);
  if (!source || !destination || !['category', 'module', 'entity'].includes(kind) || !['move', 'copy'].includes(mode)) return { ok: false, reason: 'Choose a destination.' };
  const selected = new Set(ids || []);
  const sourceModule = source.modules.find((entry) => entry.id === sourceModuleId);
  const destinationModule = destination.modules.find((entry) => entry.id === destinationModuleId);
  if (kind === 'category' && (!sourceModule || !destinationModule)) return { ok: false, reason: 'Choose a destination module.' };
  if (mode === 'move' && source.id === destination.id && (kind !== 'category' || sourceModuleId === destinationModuleId)) return { ok: false, reason: 'Choose another destination.' };
  const field = kind === 'module' ? 'modules' : kind === 'entity' ? 'roster' : 'categories';
  const sourceItems = kind === 'category' ? sourceModule.categories : source[field];
  const targetItems = kind === 'category' ? destinationModule.categories : destination[field];
  const picked = (sourceItems || []).filter((item) => selected.has(item.id));
  if (!picked.length || picked.length !== selected.size) return { ok: false, reason: 'The selected items are no longer here.' };
  const name = (item) => String(kind === 'entity' ? item.role : item.name || '').trim().toLowerCase();
  if (mode === 'move' && picked.some((item) => (targetItems || []).some((other) => other.id === item.id || name(other) === name(item)))) return { ok: false, reason: 'The destination already has an item with this name.' };
  const copyCategory = (item) => ({ ...item, id: mintId('c'), items: (item.items || []).map((child) => ({ ...child, id: mintId('i') })) });
  const usedNames = new Set((targetItems || []).map(name));
  const added = picked.map((item) => {
    if (mode === 'move') return item;
    const copy = kind === 'category' ? copyCategory(item) : kind === 'module'
      ? { ...item, id: mintId('m'), categories: (item.categories || []).map(copyCategory) }
      : { ...item, id: mintId('e') };
    const labelField = kind === 'entity' ? 'role' : 'name';
    let label = `${item[labelField]} copy`, counter = 2;
    while (usedNames.has(label.toLowerCase())) label = `${item[labelField]} copy ${counter++}`;
    usedNames.add(label.toLowerCase()); return { ...copy, [labelField]: label };
  });
  const next = templates.map((entry) => {
    let updated = entry;
    if (entry.id === source.id && mode === 'move') updated = kind === 'category'
      ? { ...updated, modules: updated.modules.map((module) => module.id === sourceModuleId ? { ...module, categories: module.categories.filter((item) => !selected.has(item.id)) } : module) }
      : { ...updated, [field]: updated[field].filter((item) => !selected.has(item.id)) };
    if (entry.id === destination.id) updated = kind === 'category'
      ? { ...updated, modules: updated.modules.map((module) => module.id === destinationModuleId ? { ...module, categories: [...module.categories, ...added] } : module) }
      : { ...updated, [field]: [...updated[field], ...added] };
    return updated;
  });
  return { ok: true, templates: next };
}
