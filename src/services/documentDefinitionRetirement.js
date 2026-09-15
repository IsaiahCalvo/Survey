const KINDS = Object.freeze(['module', 'category', 'checklistItem', 'entity']);
const KIND_SET = new Set(KINDS);
const MAX_MODULES = 64;
const MAX_CATEGORIES = 1024;
const MAX_CHECKLIST_ITEMS = 8192;
const MAX_CHECKLIST_ITEMS_PER_CATEGORY = 256;
const MAX_ENTITIES = 256;
const MAX_ARCHIVES = 10304;
const EMPTY = Object.freeze([]);
const NEVER_AVAILABLE = () => false;
const EMPTY_PROJECTION = Object.freeze({
  modules: EMPTY,
  entities: EMPTY,
  isAvailable: NEVER_AVAILABLE,
});

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && value.length >= 1 && value.length <= 128;
const label = value => typeof value === 'string';

function readCanonical(receipt) {
  if (!plain(receipt) || receipt.status !== 'accepted'
    || !plain(receipt.surveyDefinition) || !plain(receipt.entityCatalog)) return null;
  const modules = receipt.surveyDefinition.modules;
  const entities = receipt.entityCatalog.entities;
  const archives = receipt.archivedSemanticIds;
  if (!Array.isArray(modules) || modules.length > MAX_MODULES
    || !Array.isArray(entities) || entities.length > MAX_ENTITIES
    || !Array.isArray(archives) || archives.length > MAX_ARCHIVES) return null;

  const known = new Map(KINDS.map(kind => [kind, new Set()]));
  const claim = (kind, semanticId) => {
    const ids = known.get(kind);
    if (ids.has(semanticId)) return false;
    ids.add(semanticId);
    return true;
  };
  let categoryCount = 0;
  let checklistCount = 0;
  for (const module of modules) {
    if (!plain(module) || !id(module.id) || !label(module.name)
      || !Array.isArray(module.categories) || !claim('module', module.id)) return null;
    categoryCount += module.categories.length;
    if (categoryCount > MAX_CATEGORIES) return null;
    for (const category of module.categories) {
      if (!plain(category) || !id(category.id) || !label(category.name)
        || !Array.isArray(category.checklist)
        || category.checklist.length > MAX_CHECKLIST_ITEMS_PER_CATEGORY
        || !claim('category', category.id)) return null;
      checklistCount += category.checklist.length;
      if (checklistCount > MAX_CHECKLIST_ITEMS) return null;
      for (const item of category.checklist) {
        if (!plain(item) || !id(item.id) || !label(item.text)
          || !claim('checklistItem', item.id)
          || (Object.hasOwn(item, 'archived') && typeof item.archived !== 'boolean')
          || (Object.hasOwn(item, 'archivedAt') && typeof item.archivedAt !== 'string')
          || (Object.hasOwn(item, 'lastKnownLabel') && !label(item.lastKnownLabel))) return null;
      }
    }
  }
  for (const entity of entities) {
    if (!plain(entity) || !id(entity.id) || !label(entity.name)
      || !claim('entity', entity.id)) return null;
  }
  const archived = new Map(KINDS.map(kind => [kind, new Set()]));
  for (const archive of archives) {
    if (!plain(archive) || !KIND_SET.has(archive.kind) || !id(archive.id)
      || !known.get(archive.kind).has(archive.id)
      || archived.get(archive.kind).has(archive.id)) return null;
    archived.get(archive.kind).add(archive.id);
  }
  return { modules, entities, archived };
}

export function projectDocumentDefinitionForNewUse(receipt) {
  const canonical = readCanonical(receipt);
  if (!canonical) return EMPTY_PROJECTION;

  const available = new Map(KINDS.map(kind => [kind, new Set()]));

  const modules = [];
  for (const module of canonical.modules) {
    if (canonical.archived.get('module').has(module.id)) continue;
    const categories = [];
    for (const category of module.categories) {
      if (canonical.archived.get('category').has(category.id)) continue;
      const checklist = [];
      for (const item of category.checklist) {
        if (item.archived === true || canonical.archived.get('checklistItem').has(item.id)) continue;
        const projectedItem = { id: item.id, text: item.text };
        for (const key of ['archived', 'archivedAt', 'lastKnownLabel']) {
          if (Object.hasOwn(item, key)) projectedItem[key] = item[key];
        }
        checklist.push(Object.freeze(projectedItem));
        available.get('checklistItem').add(item.id);
      }
      categories.push(Object.freeze({ id: category.id, name: category.name,
        checklist: Object.freeze(checklist) }));
      available.get('category').add(category.id);
    }
    modules.push(Object.freeze({ id: module.id, name: module.name,
      categories: Object.freeze(categories) }));
    available.get('module').add(module.id);
  }

  const entities = [];
  for (const entity of canonical.entities) {
    if (canonical.archived.get('entity').has(entity.id)) continue;
    entities.push(Object.freeze({ id: entity.id, name: entity.name,
      color: entity.color, opacity: entity.opacity,
      borderColor: entity.borderColor, borderOpacity: entity.borderOpacity,
      matchFill: entity.matchFill }));
    available.get('entity').add(entity.id);
  }

  const isAvailable = (kind, semanticId) => KIND_SET.has(kind) && id(semanticId)
    && available.get(kind).has(semanticId);
  return Object.freeze({
    modules: Object.freeze(modules),
    entities: Object.freeze(entities),
    isAvailable,
  });
}
