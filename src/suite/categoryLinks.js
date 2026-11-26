// Link a walk's unlinked Categories to the Module (KAL-596, Nightly 'suite').
//
// When a Walkthru walk comes in, a Category already linked through the
// library matches on its own and never asks. Every other Category the walk
// uses gets one row: the Walkthru Category on the left, the Module's
// Categories on the right. Only an exact-name match is filled in; the user
// picks or skips the rest. A skipped Category is counted under "Not in this
// Module", never dropped.
//
// A confirmed link is saved to the library, so the next hand-off matches it
// by library id and does not ask again:
//   1. the Survey Category's library entry (made, through the normal template
//      save, if the Category has none yet);
//   2. that entry set on the Walkthru Category (walkthru.node_types).
// If either step can't be done now (offline, or the person may not change
// that Walkthru Category), the link still holds for this walk and is listed
// as "not saved".
//
// Pure apart from the injected calls, so the Node tests run it as it is.

const clean = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

function modulesOf(template) {
  return template?.modules || template?.spaces || template?.config?.modules || [];
}

/** The Module's Categories, named ones only. */
export function moduleCategories(template, moduleId) {
  const mod = modulesOf(template).find((m) => m?.id === moduleId);
  return (mod?.categories || mod?.cats || [])
    .filter((c) => c && c.id != null && clean(c.name))
    .map((c) => ({ id: c.id, name: clean(c.name), libraryEntryId: clean(c.libraryEntryId) }));
}

/**
 * One row per Walkthru Category that needs a link (from matchCategories:
 * the name matches and the missing ones). Linked Categories never show.
 * @returns {Array<{nodeTypeId:string,name:string,count:number,suggested:string|null}>}
 */
export function linkRows(match, nodeCount = new Map()) {
  if (!match) return [];
  const count = (id) => (nodeCount instanceof Map ? nodeCount.get(id) : nodeCount?.[id]) || 0;
  const rows = [
    ...(match.nameMatches || []).map((m) => ({ nodeTypeId: m.nodeTypeId, name: m.name, suggested: m.categoryId })),
    ...(match.missing || []).map((m) => ({ nodeTypeId: m.nodeTypeId, name: m.name, suggested: null })),
  ];
  return rows
    .map((r) => ({ ...r, name: clean(r.name) || 'Unnamed', count: count(r.nodeTypeId) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The picks the screen opens with: the exact-name matches, nothing else. */
export function startingPicks(rows) {
  const picks = {};
  for (const row of rows || []) if (row.suggested != null) picks[row.nodeTypeId] = row.suggested;
  return picks;
}

/**
 * node_type id -> Survey Category id for the send: the library matches plus
 * every row the user linked. A pick that is not a Category of the Module is
 * ignored (skipped).
 */
export function categoryForPicks(match, picks, template, moduleId) {
  const valid = new Set(moduleCategories(template, moduleId).map((c) => c.id));
  const out = { ...(match?.linked || {}) };
  for (const [typeId, categoryId] of Object.entries(picks || {})) {
    if (categoryId != null && valid.has(categoryId)) out[typeId] = categoryId;
  }
  return out;
}

/** The links to save to the library: every row the user linked. */
export function linksToSave(rows, picks, template, moduleId) {
  const categories = new Map(moduleCategories(template, moduleId).map((c) => [c.id, c]));
  const out = [];
  for (const row of rows || []) {
    const category = categories.get(picks?.[row.nodeTypeId]);
    if (!category) continue;
    out.push({ nodeTypeId: row.nodeTypeId, nodeTypeName: row.name, categoryId: category.id, categoryName: category.name });
  }
  return out;
}

/** The Survey Category's library entry in this list of templates, if it has one. */
export function entryIdFor(templates, templateId, moduleId, categoryId) {
  const template = (templates || []).find((t) => t?.id === templateId);
  const category = moduleCategories(template, moduleId).find((c) => c.id === categoryId);
  return category?.libraryEntryId || null;
}

/** Templates are saved only when a linked Category has no library entry yet. */
export function templatesNeedLinking(links, templates, templateId, moduleId) {
  return (links || []).some((l) => !entryIdFor(templates, templateId, moduleId, l.categoryId));
}

/**
 * Save confirmed links so the next hand-off matches them by library id.
 *
 * @param {object} input
 * @param {Array} input.links  from linksToSave
 * @param {Array} input.templates  all of the person's templates
 * @param {string} input.templateId
 * @param {string} input.moduleId
 * @param {(templates:Array) => Promise<Array>} input.linkTemplates  the
 *   templates with every named Category linked to the library
 * @param {(templates:Array) => Promise<void>} input.saveTemplates  the normal
 *   template save
 * @param {() => Promise<void>} input.flushLibrary  send queued library entries
 * @param {(entryId:string) => boolean} input.entryOnServer
 * @param {(nodeTypeId:string, entryId:string) => Promise<{data?:Array,error?:object}>} input.setNodeTypeEntry
 * @returns {Promise<{saved:Array, notSaved:Array<{link:object,reason:string}>}>}
 */
export async function saveCategoryLinks({
  links = [], templates = [], templateId, moduleId,
  linkTemplates, saveTemplates, flushLibrary, entryOnServer, setNodeTypeEntry,
}) {
  const saved = [];
  const notSaved = [];
  if (!links.length) return { saved, notSaved };

  let current = templates;
  let templateSaveFailed = false;
  if (templatesNeedLinking(links, current, templateId, moduleId)) {
    try {
      const linked = await linkTemplates(current);
      if (Array.isArray(linked) && linked !== current) {
        await saveTemplates(linked);
        current = linked;
      }
    } catch (error) {
      // A plan without template editing, or offline: the Survey side can't
      // keep the link, so nothing is half-saved on the Walkthru side either.
      templateSaveFailed = true;
      console.warn('[suite] category links: template save failed', error);
    }
  }
  try { await flushLibrary?.(); } catch { /* offline: checked per link below */ }

  for (const link of links) {
    const entryId = entryIdFor(current, templateId, moduleId, link.categoryId);
    if (!entryId) {
      notSaved.push({
        link,
        reason: templateSaveFailed ? 'the template could not be saved' : 'the Survey Category is not in the library yet',
      });
      continue;
    }
    if (entryOnServer && !entryOnServer(entryId)) {
      notSaved.push({ link, reason: 'offline; add the walk again once online' });
      continue;
    }
    let result;
    try {
      result = await setNodeTypeEntry(link.nodeTypeId, entryId);
    } catch (error) {
      result = { error };
    }
    // The row rules hide a Category this person may not change: the update
    // comes back with no rows rather than an error.
    if (result?.error || !Array.isArray(result?.data) || result.data.length === 0) {
      notSaved.push({ link, reason: 'you can’t change this Walkthru Category' });
      continue;
    }
    saved.push({ ...link, libraryEntryId: entryId });
  }
  return { saved, notSaved };
}

/**
 * The picks after the rows change (a Category was added to the Module, say):
 * a choice the user already made is kept while it still points at one of
 * the Module's Categories; every other row starts from its exact-name match.
 */
export function keepPicks(prev, rows, template, moduleId) {
  const valid = new Set(moduleCategories(template, moduleId).map((c) => c.id));
  const next = {};
  for (const row of rows || []) {
    const id = row.nodeTypeId;
    if (prev && Object.prototype.hasOwnProperty.call(prev, id) && (prev[id] == null || valid.has(prev[id]))) {
      if (prev[id] != null) next[id] = prev[id];
      else next[id] = null;
    } else if (row.suggested != null) {
      next[id] = row.suggested;
    }
  }
  return next;
}

/** True when the Module has no Category with exactly this name yet. */
export function canAddToModule(name, template, moduleId) {
  const wanted = clean(name);
  if (!wanted || !modulesOf(template).some((m) => m?.id === moduleId)) return false;
  return !moduleCategories(template, moduleId).some((c) => c.name === wanted);
}

/**
 * "Add Intercom to this Module": the templates with a new, empty Category of
 * exactly that name at the end of the Module. Survey keeps a template's
 * Modules under `modules` and, in older saves, a copy under `spaces`; both
 * get it, with one id.
 * @returns {{ templates: Array, categoryId: string } | null}
 */
export function withCategoryAdded(templates, templateId, moduleId, name, categoryId) {
  const wanted = clean(name);
  if (!wanted || !categoryId) return null;
  let added = false;
  const out = (templates || []).map((template) => {
    if (template?.id !== templateId) return template;
    const next = { ...template };
    for (const key of ['modules', 'spaces']) {
      if (!Array.isArray(template[key])) continue;
      next[key] = template[key].map((mod) => {
        if (mod?.id !== moduleId) return mod;
        const cKey = Array.isArray(mod.categories) ? 'categories' : (Array.isArray(mod.cats) ? 'cats' : 'categories');
        const list = Array.isArray(mod[cKey]) ? mod[cKey] : [];
        if (list.some((c) => clean(c?.name) === wanted)) return mod;
        added = true;
        return { ...mod, [cKey]: [...list, { id: categoryId, name: wanted, checklist: [] }] };
      });
    }
    return next;
  });
  return added ? { templates: out, categoryId } : null;
}

export const JOB_CATEGORY_LINKS_STORAGE_KEY = 'survey.suite.jobCategoryLinks.v1';

const jobLinkScopeKey = (templateId, moduleId) => {
  const t = clean(String(templateId ?? ''));
  const m = clean(String(moduleId ?? ''));
  return t && m ? `${t}::${m}` : null;
};

const readJobCategoryLinksStore = (storage) => {
  if (!storage || typeof storage.getItem !== 'function') return {};
  try {
    const raw = storage.getItem(JOB_CATEGORY_LINKS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

/**
 * Remembered Plot job-file Category links for one (templateId, moduleId),
 * keyed by lowercased Category name -> Survey Category id (#1603).
 */
export function loadSavedJobCategoryLinks(
  templateId,
  moduleId,
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
) {
  const scope = jobLinkScopeKey(templateId, moduleId);
  if (!scope) return {};
  const all = readJobCategoryLinksStore(storage);
  const entry = all[scope];
  return entry && typeof entry === 'object' && !Array.isArray(entry) ? { ...entry } : {};
}

/**
 * Save confirmed Plot job-file Category links for (templateId, moduleId) so
 * re-adding the same job file matches automatically without re-mapping (#1603).
 */
export function saveJobCategoryLinks(
  templateId,
  moduleId,
  links = [],
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
) {
  const scope = jobLinkScopeKey(templateId, moduleId);
  const valid = (links || []).filter((l) => clean(l?.nodeTypeName) && l?.categoryId != null);
  if (!scope || valid.length === 0) return { saved: [], notSaved: [] };
  const all = readJobCategoryLinksStore(storage);
  const current = all[scope] && typeof all[scope] === 'object' && !Array.isArray(all[scope])
    ? { ...all[scope] }
    : {};
  const saved = [];
  for (const link of valid) {
    const key = clean(link.nodeTypeName).toLowerCase();
    current[key] = link.categoryId;
    saved.push(link);
  }
  all[scope] = current;
  try {
    if (storage && typeof storage.setItem === 'function') {
      storage.setItem(JOB_CATEGORY_LINKS_STORAGE_KEY, JSON.stringify(all));
    }
  } catch {
    return { saved: [], notSaved: valid.map((link) => ({ link, reason: 'could not save in this browser' })) };
  }
  return { saved, notSaved: [] };
}

