// Move or copy Survey Markers to another category (owner 2026-10-26: "you can't
// move a category item to another category, you can only move it to another
// module ... pick which template, which module within that template, and then
// which category within that module").
//
// Pure: plans the change; the viewer applies it as one Survey Marker step
// (buildSurveyMarkerHistoryAction), so one Undo takes it back.
//
//   move -> the SAME record (id, answers, notes, media, Excel identity, place
//           on the page) with its module and category changed.
//   copy -> a NEW record per marker at the same place, with the same name and
//           look, no answers and no Excel identity (like a pasted copy).

import { SURVEY_MARKER_COPIED_FIELDS } from './surveyMarkerFamily.js';

const modulesOf = (template) => (template?.modules || template?.spaces || []);

/**
 * The places a marker can go: the document's template first, then the user's
 * other templates, each with its modules and their categories. A template with
 * no category anywhere is left out (there is nowhere in it to put a marker).
 */
export function surveyMarkerTransferTargets(currentTemplate, templates = []) {
  const seen = new Set();
  const list = [];
  for (const template of [currentTemplate, ...(templates || [])]) {
    if (!template?.id || seen.has(template.id)) continue;
    seen.add(template.id);
    const modules = modulesOf(template)
      .filter((mod) => mod?.id)
      .map((mod) => ({
        id: mod.id,
        name: mod.name || 'Untitled module',
        categories: (mod.categories || [])
          .filter((cat) => cat?.id)
          .map((cat) => ({ id: cat.id, name: cat.name || 'Untitled category' })),
      }));
    if (!modules.some((mod) => mod.categories.length > 0)) continue;
    list.push({ id: template.id, name: template.name || 'Untitled template', modules });
  }
  return list;
}

/**
 * Where the picker starts: the current template and module, on the first
 * category that is not the one the markers are in (moving a marker to where it
 * already is does nothing). Falls back to the first module with a category.
 */
export function defaultSurveyMarkerTransferTarget(targets, { templateId, moduleId, categoryId } = {}) {
  const template = targets.find((entry) => entry.id === templateId) || targets[0] || null;
  if (!template) return { templateId: null, moduleId: null, categoryId: null };
  return pickInTemplate(template, { moduleId, avoidCategoryId: categoryId });
}

/** The module and category to show after the template changes in the picker. */
export function pickInTemplate(template, { moduleId = null, avoidCategoryId = null } = {}) {
  const withCats = (template?.modules || []).filter((mod) => mod.categories.length > 0);
  const mod = withCats.find((entry) => entry.id === moduleId) || withCats[0] || null;
  if (!mod) return { templateId: template?.id ?? null, moduleId: null, categoryId: null };
  const cat = mod.categories.find((entry) => entry.id !== avoidCategoryId) || mod.categories[0];
  return { templateId: template.id, moduleId: mod.id, categoryId: cat?.id ?? null };
}

/**
 * Plan a move or copy.
 * @param {object} p
 * @param {'move'|'copy'} p.mode
 * @param {object} p.markers      the document's markers ({ [id]: record })
 * @param {string[]} p.ids        the markers to move / copy
 * @param {string} p.moduleId     destination module
 * @param {string} p.categoryId   destination category
 * @param {(record) => boolean} [p.mayEdit]  move permission (copy makes the viewer's own)
 * @param {() => string} [p.mintId]          new id for a copy
 * @param {string|null} [p.userId]           author of a copy
 * @returns {{ ok: true, changes: Array<{id, before, after}>, ids: string[] } | { ok: false, reason: string }}
 */
export function planSurveyMarkerTransfer({ mode, markers, ids, moduleId, categoryId, mayEdit = () => true, mintId, userId = null }) {
  if (mode !== 'move' && mode !== 'copy') return { ok: false, reason: 'Choose Move or Copy.' };
  if (!moduleId || !categoryId) return { ok: false, reason: 'Choose a category.' };
  const all = markers && typeof markers === 'object' ? markers : {};
  const records = [...new Set(ids || [])].map((id) => [String(id), all[id]]).filter(([, record]) => record);
  if (records.length === 0) return { ok: false, reason: 'Those Survey Markers are gone.' };
  const changes = [];
  const resultIds = [];
  if (mode === 'move') {
    const here = records.filter(([, record]) => record.moduleId === moduleId && record.categoryId === categoryId);
    if (here.length === records.length) return { ok: false, reason: 'They are already in that category.' };
    const blocked = records.filter(([, record]) => !mayEdit(record));
    if (blocked.length > 0) {
      return { ok: false, reason: blocked.length === 1 ? 'One of them is locked or not yours to move.' : `${blocked.length} of them are locked or not yours to move.` };
    }
    for (const [id, record] of records) {
      if (record.moduleId === moduleId && record.categoryId === categoryId) continue;
      const after = { ...record, moduleId, categoryId };
      if (record.spaceId !== undefined) after.spaceId = moduleId;
      changes.push({ id, before: record, after });
      resultIds.push(id);
    }
    return { ok: true, changes, ids: resultIds };
  }
  if (typeof mintId !== 'function') return { ok: false, reason: 'Could not copy.' };
  for (const [, record] of records) {
    const id = String(mintId());
    const copy = {
      id,
      pageNumber: record.pageNumber ?? null,
      bounds: record.bounds ? { ...record.bounds } : null,
      moduleId,
      categoryId,
      regionId: record.regionId ?? null,
      name: record.name ?? '',
      checklistResponses: {},
    };
    for (const field of SURVEY_MARKER_COPIED_FIELDS) {
      if (field === 'categoryId') continue;
      if (record[field] !== undefined) copy[field] = JSON.parse(JSON.stringify(record[field]));
    }
    if (userId) copy.userId = userId;
    changes.push({ id, before: null, after: copy });
    resultIds.push(id);
  }
  return { ok: true, changes, ids: resultIds };
}
