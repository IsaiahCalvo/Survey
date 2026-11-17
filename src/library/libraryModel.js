// Suite library (KAL-585): the plain rules behind "My library" and "Company
// library". No React, no Supabase: the Node tests run this file as it is.
//
// An entry is a Category (Camera) or a Category Type (PTZ) under a Category.
// Each lives in one library: a person's own ("mine") or their company's.
// Survey template categories point at an entry by `libraryEntryId`; the
// checklist stays on the template. Matching is by id first, then by the exact
// name (spaces at the ends and doubled spaces aside). Nothing is matched by
// guessing.
//
// Table: supabase/migrations/20261115180000_suite_library.sql.

export const LIBRARY_KIND = Object.freeze({ CATEGORY: 'category', CATEGORY_TYPE: 'categoryType' });
export const LIBRARY_SCOPE = Object.freeze({ MINE: 'mine', COMPANY: 'company' });

export const LIBRARY_WORDS = Object.freeze({
  mine: 'My library',
  company: 'Company library',
  refusedManage: 'Only company owners and admins can rename or remove a Company library entry.',
  refusedOwn: 'Only the person who made this entry can rename or remove it.',
  refusedAdd: 'Join a company before adding to the Company library.',
  emptyName: 'Give it a name.',
  typeNeedsCategory: 'A Category Type goes under a Category.',
});

const PLACEHOLDER_CATEGORY = /^(Category \d+|Untitled Category)$/;

/** The name as stored and compared: ends trimmed, inner runs of space made one. */
export function normalizeEntryName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * True for the names Survey gives a category before anyone names it
 * ("Category 1", "Untitled Category"). Those are not saved to the library
 * until they are renamed, so the library never fills with "Category 3".
 */
export function isPlaceholderCategoryName(name) {
  return PLACEHOLDER_CATEGORY.test(normalizeEntryName(name));
}

/** The company a person is in, as the library needs it: { id, role } or null. */
export function companyOf(company) {
  if (!company || typeof company !== 'object' || !company.id) return null;
  return { id: String(company.id), role: String(company.my_role || company.role || 'member') };
}

/** May this person add an entry to that library? */
export function canAddEntry(scope, { userId, company } = {}) {
  if (!userId) return false;
  if (scope === LIBRARY_SCOPE.MINE) return true;
  if (scope === LIBRARY_SCOPE.COMPANY) return Boolean(company?.id);
  return false;
}

/**
 * May this person rename or remove the entry? Same rule as the database:
 * your own library is yours; in the Company library, owners and admins only.
 */
export function canManageEntry(entry, { userId, company } = {}) {
  if (!entry || !userId) return false;
  if (entry.scope === LIBRARY_SCOPE.MINE) return entry.createdBy === userId;
  if (entry.scope === LIBRARY_SCOPE.COMPANY) {
    return Boolean(company?.id) && company.id === entry.companyId
      && (company.role === 'owner' || company.role === 'admin');
  }
  return false;
}

/** Why a rename or remove is refused, in words, or '' when it is allowed. */
export function manageRefusal(entry, who) {
  if (canManageEntry(entry, who)) return '';
  return entry?.scope === LIBRARY_SCOPE.COMPANY ? LIBRARY_WORDS.refusedManage : LIBRARY_WORDS.refusedOwn;
}

/** A new entry, made on this device (its id stays the same on the server). */
export function newLibraryEntry({ id, kind = LIBRARY_KIND.CATEGORY, name, parentId = null, scope = LIBRARY_SCOPE.MINE, companyId = null, userId, now = new Date().toISOString() }) {
  return {
    id: String(id),
    kind,
    parentId: kind === LIBRARY_KIND.CATEGORY_TYPE ? (parentId ? String(parentId) : null) : null,
    name: normalizeEntryName(name),
    scope,
    companyId: scope === LIBRARY_SCOPE.COMPANY ? (companyId ? String(companyId) : null) : null,
    createdBy: userId ? String(userId) : null,
    createdAt: now,
    updatedAt: now,
    removedAt: null,
  };
}

/** Check a new entry before it is queued. Returns '' or the reason in words. */
export function newEntryProblem(entry, { userId, company, entries = [] } = {}) {
  if (!entry.name) return LIBRARY_WORDS.emptyName;
  if (!canAddEntry(entry.scope, { userId, company })) return LIBRARY_WORDS.refusedAdd;
  if (entry.scope === LIBRARY_SCOPE.COMPANY && entry.companyId !== company?.id) return LIBRARY_WORDS.refusedAdd;
  if (entry.kind === LIBRARY_KIND.CATEGORY_TYPE) {
    const parent = entries.find((e) => e.id === entry.parentId);
    if (!parent || parent.kind !== LIBRARY_KIND.CATEGORY || parent.removedAt) return LIBRARY_WORDS.typeNeedsCategory;
    if (parent.scope !== entry.scope || parent.companyId !== entry.companyId) return LIBRARY_WORDS.typeNeedsCategory;
  }
  return '';
}

/** A library_entries row as the app holds it. */
export function entryFromRow(row) {
  return {
    id: String(row.id),
    kind: row.kind,
    parentId: row.parent_id ?? null,
    name: row.name,
    scope: row.scope,
    companyId: row.company_id ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    removedAt: row.removed_at ?? null,
  };
}

/** The insert row for an entry (the server sets the times itself). */
export function rowFromEntry(entry) {
  return {
    id: entry.id,
    kind: entry.kind,
    parent_id: entry.parentId,
    name: entry.name,
    scope: entry.scope,
    company_id: entry.companyId,
    created_by: entry.createdBy,
  };
}

/**
 * Apply one queued change to a list of entries (a new list; never mutates).
 *   { op: 'add', entry }   { op: 'rename', id, name }   { op: 'remove', id }
 */
export function applyLibraryOp(entries, op) {
  const list = Array.isArray(entries) ? entries : [];
  if (!op) return list;
  if (op.op === 'add') {
    if (list.some((e) => e.id === op.entry.id)) return list;
    return [...list, op.entry];
  }
  if (op.op === 'rename') {
    return list.map((e) => (e.id === op.id ? { ...e, name: normalizeEntryName(op.name), updatedAt: op.at || e.updatedAt } : e));
  }
  if (op.op === 'remove') {
    return list.map((e) => (e.id === op.id ? { ...e, removedAt: op.at || new Date().toISOString() } : e));
  }
  return list;
}

/**
 * What this device shows: the server's rows with the changes still waiting
 * to sync laid on top, in order. A change waiting to sync wins, so an entry
 * made offline never blinks out when the server list comes back without it.
 */
export function mergeServerEntries(serverRows, outbox = []) {
  let entries = (Array.isArray(serverRows) ? serverRows : []).map(entryFromRow);
  for (const op of outbox || []) entries = applyLibraryOp(entries, op);
  return entries;
}

/** The live entries of one library: { scope: 'mine' } or { scope: 'company', companyId }. */
export function entriesInLibrary(entries, { scope, companyId = null, userId = null } = {}) {
  return (entries || []).filter((e) => {
    if (e.removedAt) return false;
    if (scope === LIBRARY_SCOPE.MINE) return e.scope === LIBRARY_SCOPE.MINE && (!userId || e.createdBy === userId);
    if (scope === LIBRARY_SCOPE.COMPANY) return e.scope === LIBRARY_SCOPE.COMPANY && e.companyId === companyId;
    return false;
  });
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));

/** One library as a list: each Category with its Category Types under it. */
export function libraryOutline(entries, library) {
  const live = entriesInLibrary(entries, library);
  const types = live.filter((e) => e.kind === LIBRARY_KIND.CATEGORY_TYPE);
  return live
    .filter((e) => e.kind === LIBRARY_KIND.CATEGORY)
    .sort(byName)
    .map((category) => ({ ...category, types: types.filter((t) => t.parentId === category.id).sort(byName) }));
}

/** The oldest live entry with exactly this name in that library, or null. */
export function findEntryByName(entries, { kind = LIBRARY_KIND.CATEGORY, name, parentId = null, scope, companyId = null, userId = null }) {
  const want = normalizeEntryName(name);
  if (!want) return null;
  const hits = entriesInLibrary(entries, { scope, companyId, userId })
    .filter((e) => e.kind === kind && (kind !== LIBRARY_KIND.CATEGORY_TYPE || e.parentId === parentId) && e.name === want)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  return hits[0] || null;
}

/** The library new entries made from templates go to: the company's when in one. */
export function defaultLibraryFor({ company } = {}) {
  return company?.id
    ? { scope: LIBRARY_SCOPE.COMPANY, companyId: company.id }
    : { scope: LIBRARY_SCOPE.MINE, companyId: null };
}

const modulesKey = (t) => (Array.isArray(t?.modules) ? 'modules' : Array.isArray(t?.spaces) ? 'spaces' : null);
const categoriesKey = (m) => (Array.isArray(m?.categories) ? 'categories' : Array.isArray(m?.cats) ? 'cats' : null);

/**
 * Every Survey Category saves itself into the library. For each category of
 * my own templates (not ones shared with me):
 *   - it already has a `libraryEntryId`: kept as it is (a link is never
 *     changed or dropped here, even when its entry is not loaded);
 *   - it still has the name Survey gave it ("Category 2"): left for now;
 *   - else it links to the entry with exactly its name in the target
 *     library, and when there is none, a new entry is made.
 * A Category's Types (`types: [{ id, name }]`, KAL-618) link the same way to
 * Category Types under that Category's entry.
 * Only `libraryEntryId` is added: names, checklists and everything else on
 * the template stay exactly as they were.
 *
 * @returns {{ templates: object[], created: object[], linked: number }}
 *   `templates` keeps the same object for every template it did not touch.
 */
export function linkTemplateCategories(templates, { entries = [], userId, company = null, mintId, now } = {}) {
  const list = Array.isArray(templates) ? templates : [];
  if (!userId || typeof mintId !== 'function') return { templates: list, created: [], linked: 0 };
  const target = defaultLibraryFor({ company });
  let pool = Array.isArray(entries) ? entries : [];
  const created = [];
  let linked = 0;
  const out = list.map((template) => {
    if (!template || template.sharedFrom) return template;
    const mKey = modulesKey(template);
    if (!mKey) return template;
    let templateChanged = false;
    const modules = template[mKey].map((mod) => {
      const cKey = categoriesKey(mod);
      if (!cKey) return mod;
      let moduleChanged = false;
      const categories = mod[cKey].map((category) => {
        if (!category || typeof category !== 'object') return category;
        let next = category;
        if (!category.libraryEntryId && !isPlaceholderCategoryName(category.name) && normalizeEntryName(category.name)) {
          let entry = findEntryByName(pool, { name: category.name, ...target, userId });
          if (!entry) {
            entry = newLibraryEntry({ id: mintId(), name: category.name, ...target, userId, now });
            pool = [...pool, entry];
            created.push(entry);
          }
          linked += 1;
          next = { ...category, libraryEntryId: entry.id };
        }
        // Category Types (KAL-618): each named Type links to the Category Type
        // with exactly its name under this Category's library entry, in that
        // entry's own library. A Category whose entry is not loaded on this
        // device waits: its library is not known, and nothing is guessed.
        const parent = next.libraryEntryId ? pool.find((e) => e.id === next.libraryEntryId && !e.removedAt) : null;
        if (parent && Array.isArray(next.types) && next.types.length > 0) {
          let typesChanged = false;
          const types = next.types.map((type) => {
            if (!type || typeof type !== 'object' || type.libraryEntryId || !normalizeEntryName(type.name)) return type;
            const where = { scope: parent.scope, companyId: parent.companyId };
            let entry = findEntryByName(pool, { kind: LIBRARY_KIND.CATEGORY_TYPE, name: type.name, parentId: parent.id, ...where, userId });
            if (!entry) {
              entry = newLibraryEntry({ id: mintId(), kind: LIBRARY_KIND.CATEGORY_TYPE, name: type.name, parentId: parent.id, ...where, userId, now });
              pool = [...pool, entry];
              created.push(entry);
            }
            linked += 1;
            typesChanged = true;
            return { ...type, libraryEntryId: entry.id };
          });
          if (typesChanged) next = { ...next, types };
        }
        if (next !== category) moduleChanged = true;
        return next;
      });
      if (!moduleChanged) return mod;
      templateChanged = true;
      return { ...mod, [cKey]: categories };
    });
    return templateChanged ? { ...template, [mKey]: modules } : template;
  });
  return { templates: out, created, linked };
}

/** How many categories of my own templates are not linked yet (named ones only). */
export function countUnlinkedCategories(templates) {
  return unlinkedCategorySummary(templates).total;
}

/**
 * The unlinked Categories of my own templates, and how many of them already
 * have a library entry with exactly their name (linking those adds nothing new,
 * so the Library screen says "link", not "add"). Same matching rule as
 * linkTemplateCategories.
 */
export function unlinkedCategorySummary(templates, { entries = [], userId = null, company = null } = {}) {
  const target = defaultLibraryFor({ company });
  const pool = Array.isArray(entries) ? entries : [];
  let total = 0;
  let inLibrary = 0;
  for (const template of templates || []) {
    if (!template || template.sharedFrom) continue;
    const mods = template.modules || template.spaces || [];
    for (const mod of mods) {
      for (const category of mod?.categories || mod?.cats || []) {
        if (category?.libraryEntryId || isPlaceholderCategoryName(category?.name) || !normalizeEntryName(category?.name)) continue;
        total += 1;
        if (userId && findEntryByName(pool, { name: category.name, ...target, userId })) inLibrary += 1;
      }
    }
  }
  return { total, inLibrary };
}

/** The banner over the list: "link" when every unlinked Category is already here by name. */
export function unlinkedNoteFor({ total, inLibrary }) {
  const one = total === 1;
  const lead = one ? '1 Category in your templates' : `${total} Categories in your templates`;
  if (inLibrary >= total) return { text: `${lead} ${one ? 'is' : 'are'} in the library but not linked to it yet.`, action: one ? 'Link it' : 'Link them' };
  if (inLibrary === 0) return { text: `${lead} ${one ? 'is' : 'are'} not in the library yet.`, action: one ? 'Add it' : 'Add them' };
  return { text: `${lead} ${one ? 'is' : 'are'} not linked to the library yet. ${total - inLibrary} of them ${total - inLibrary === 1 ? 'is' : 'are'} new.`, action: 'Add and link' };
}

/**
 * A template Category's Types as the app holds them (KAL-618): a list of
 * `{ id, name, libraryEntryId? }`, names normalized, nameless and repeated
 * names dropped (the first one wins). Anything else comes back as [].
 */
export function categoryTypesOf(category) {
  const list = Array.isArray(category?.types) ? category.types : [];
  const seen = new Set();
  const out = [];
  for (const type of list) {
    if (!type || typeof type !== 'object') continue;
    const name = normalizeEntryName(type.name);
    const key = name.toLocaleLowerCase();
    if (!name || !type.id || seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: String(type.id),
      name,
      ...(typeof type.libraryEntryId === 'string' && type.libraryEntryId ? { libraryEntryId: type.libraryEntryId } : {}),
    });
  }
  return out;
}

/** Why a new Type name is refused on a Category, in words, or ''. */
export function newCategoryTypeProblem(category, name) {
  const want = normalizeEntryName(name);
  if (!want) return LIBRARY_WORDS.emptyName;
  const taken = categoryTypesOf(category).some((t) => t.name.toLocaleLowerCase() === want.toLocaleLowerCase());
  return taken ? `"${want}" is already a Type of this Category.` : '';
}
