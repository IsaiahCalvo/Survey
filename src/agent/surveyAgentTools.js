// The Survey agent's tools, run in the app on the open document (KAL-527).
// The model (survey-agent edge function) only asks for a tool; this file
// answers it through the Survey panel's own writes (the "bridge" the panel
// publishes), so sync, Excel rows, auto-entity and role checks behave exactly
// as if the person had tapped. Every write returns a change with an undo.
import { answerSetFor } from '../services/answerSets.js';
import { categoriesOf, checklistOf, entitiesOf, itemText, modulesOf } from '../services/templateConfigShape.js';
import { normalizeItemName, scoreItemName } from '../../supabase/functions/_shared/surveyAgentSpec.js';

export { normalizeItemName, scoreItemName };

// The panel fills this while Survey mode is open (SurveySpacesRail).
export const surveyAgentBridge = { current: null };

function categoryIndex(template) {
  const byKey = new Map();
  const list = [];
  for (const module of modulesOf(template)) {
    for (const category of categoriesOf(module)) {
      const entry = { module, category };
      byKey.set(`${module.id}\0${category.id}`, entry);
      if (!byKey.has(`*\0${category.id}`)) byKey.set(`*\0${category.id}`, entry);
      list.push(entry);
    }
  }
  return { list, find: (moduleId, categoryId) => byKey.get(`${moduleId}\0${categoryId}`) || byKey.get(`*\0${categoryId}`) || null };
}

const activeChecklist = (category) => checklistOf(category)
  .map((item, index) => (typeof item === 'string' ? { id: `item-${index}`, text: item } : item))
  .filter((item) => item && item.archived !== true && item.id);

const noteTextOf = (note) => {
  if (!note) return '';
  if (typeof note === 'string') {
    try {
      const parsed = note.trim().startsWith('{') ? JSON.parse(note) : null;
      if (parsed && typeof parsed === 'object') return String(parsed.text || '');
    } catch { /* plain text */ }
    return note;
  }
  return String(note.text || '');
};
const mediaCountOf = (note) => (note && typeof note === 'object' && Array.isArray(note.media) ? note.media.length : 0);

const snapshotOf = (marker) => ({
  checklistResponses: marker?.checklistResponses ? JSON.parse(JSON.stringify(marker.checklistResponses)) : {},
  note: marker?.note && typeof marker.note === 'object' ? JSON.parse(JSON.stringify(marker.note)) : (marker?.note ?? null),
  entityId: marker?.entityId || null,
});

const out = (value) => (typeof value === 'string' ? value : JSON.stringify(value));

class ToolError extends Error {}

/**
 * attachments: Map of attachment id -> { file, kind, name } the person added
 * in this chat. Returns { run(name, input) -> { content, isError, change } }.
 * A change is { itemId, label, snapshot } and undo(change) restores it.
 */
export function createSurveyAgentToolbox({ getBridge = () => surveyAgentBridge.current, attachments = new Map() } = {}) {
  const bridge = () => {
    const b = getBridge();
    if (!b || !b.template) throw new ToolError('Survey mode is not open with a template. Ask the person to open Survey mode first.');
    return b;
  };
  const markerOf = (b, itemId) => {
    const marker = b.markers?.[itemId];
    if (!marker) throw new ToolError(`No item with id ${itemId}. Use find_items to get an id.`);
    return marker;
  };
  const writable = (b) => {
    if (b.canEdit === false) throw new ToolError('This person can only view this document, so nothing can be changed.');
  };
  const nameOf = (marker) => marker?.name || 'Unnamed item';

  const tools = {
    get_survey_context() {
      const b = bridge();
      const { list } = categoryIndex(b.template);
      const counts = new Map();
      for (const marker of Object.values(b.markers || {})) {
        const key = marker?.categoryId;
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
      }
      const multiModule = modulesOf(b.template).length > 1;
      const selected = b.selectedMarkerId && b.markers?.[b.selectedMarkerId];
      return {
        content: out({
          template: b.template.name || null,
          answers: answerSetFor(b.template).map((a) => a.value),
          categories: list.map(({ module, category }) => ({
            id: category.id,
            name: category.name,
            ...(multiModule ? { module: module.name } : {}),
            item_count: counts.get(category.id) || 0,
            checklist: activeChecklist(category).map((item) => ({ id: item.id, text: itemText(item) })),
          })),
          entities: entitiesOf(b.template).map((e) => ({ id: e.id, name: e.name })),
          selected_item: selected ? { id: b.selectedMarkerId, name: nameOf(selected) } : null,
          can_edit: b.canEdit !== false,
        }),
      };
    },

    find_items({ query, category_id: categoryId } = {}) {
      const b = bridge();
      if (!String(query || '').trim()) throw new ToolError('Say which item to look for.');
      const { find } = categoryIndex(b.template);
      const matches = [];
      for (const [id, marker] of Object.entries(b.markers || {})) {
        if (!marker || (categoryId && marker.categoryId !== categoryId)) continue;
        const entry = find(marker.moduleId, marker.categoryId);
        const score = scoreItemName(query, marker.name, entry?.category?.name);
        if (score >= 0.5) {
          matches.push({
            id,
            name: nameOf(marker),
            category: entry?.category?.name || null,
            on_plan: Boolean(marker.pageNumber && marker.bounds),
            score: Math.round(score * 100) / 100,
          });
        }
      }
      matches.sort((a, b2) => b2.score - a.score || a.name.localeCompare(b2.name));
      return { content: out({ matches: matches.slice(0, 5) }) };
    },

    get_item({ item_id: itemId } = {}) {
      const b = bridge();
      const marker = markerOf(b, itemId);
      const entry = categoryIndex(b.template).find(marker.moduleId, marker.categoryId);
      const entity = entitiesOf(b.template).find((e) => e.id === marker.entityId);
      const responses = marker.checklistResponses || {};
      return {
        content: out({
          id: itemId,
          name: nameOf(marker),
          category: entry ? { id: entry.category.id, name: entry.category.name } : null,
          entity: entity ? { id: entity.id, name: entity.name } : null,
          checklist: entry ? activeChecklist(entry.category).map((item) => ({
            id: item.id,
            text: itemText(item),
            answer: responses[item.id]?.selection || null,
          })) : [],
          note: noteTextOf(marker.note),
          media_count: mediaCountOf(marker.note),
          on_plan: Boolean(marker.pageNumber && marker.bounds),
        }),
      };
    },

    set_answers({ item_id: itemId, answers } = {}) {
      const b = bridge();
      writable(b);
      const marker = markerOf(b, itemId);
      const entry = categoryIndex(b.template).find(marker.moduleId, marker.categoryId);
      if (!entry) throw new ToolError('This item has no category in the template, so it has no checklist.');
      const checklist = new Map(activeChecklist(entry.category).map((item) => [item.id, item]));
      const allowed = answerSetFor(b.template).map((a) => a.value);
      const list = Array.isArray(answers) ? answers : [];
      if (!list.length) throw new ToolError('No answers given.');
      for (const a of list) {
        if (!checklist.has(a?.checklist_item_id)) throw new ToolError(`${a?.checklist_item_id} is not on the ${entry.category.name} checklist. Use get_item for its checklist ids.`);
        if (!allowed.includes(a?.value)) throw new ToolError(`"${a?.value}" is not an allowed answer. Allowed: ${allowed.join(', ')}.`);
      }
      const snapshot = snapshotOf(marker);
      b.setAnswers(itemId, list.map((a) => ({ checklistItemId: a.checklist_item_id, value: a.value })));
      const label = list.map((a) => `${itemText(checklist.get(a.checklist_item_id))} = ${a.value}`).join('; ');
      return {
        content: `Set ${list.length} answer${list.length === 1 ? '' : 's'} on ${nameOf(marker)}.`,
        change: { itemId, label: `${nameOf(marker)}: ${label}`, snapshot },
      };
    },

    add_note({ item_id: itemId, text } = {}) {
      const b = bridge();
      writable(b);
      const marker = markerOf(b, itemId);
      const addition = String(text || '').trim();
      if (!addition) throw new ToolError('The note text is empty.');
      const snapshot = snapshotOf(marker);
      b.updateNote(itemId, (prev) => {
        const before = String(prev?.text || '').trimEnd();
        return { ...prev, text: before ? `${before}\n${addition}` : addition };
      });
      return {
        content: `Added to the note on ${nameOf(marker)}.`,
        change: { itemId, label: `${nameOf(marker)}: note "${addition.length > 80 ? `${addition.slice(0, 77)}...` : addition}"`, snapshot },
      };
    },

    set_entity({ item_id: itemId, entity_id: entityId } = {}) {
      const b = bridge();
      writable(b);
      const marker = markerOf(b, itemId);
      const entity = entityId ? entitiesOf(b.template).find((e) => e.id === entityId) : null;
      if (entityId && !entity) throw new ToolError(`${entityId} is not one of this template's entities.`);
      const snapshot = snapshotOf(marker);
      b.setEntity(itemId, entity?.id || null);
      return {
        content: entity ? `Set ${nameOf(marker)} to ${entity.name}.` : `Cleared the entity on ${nameOf(marker)}.`,
        change: { itemId, label: `${nameOf(marker)}: entity ${entity ? entity.name : 'cleared'}`, snapshot },
      };
    },

    async attach_media({ item_id: itemId, attachment_ids: ids } = {}) {
      const b = bridge();
      writable(b);
      const marker = markerOf(b, itemId);
      const list = (Array.isArray(ids) ? ids : []).map((id) => [id, attachments.get(id)]);
      const missing = list.filter(([, a]) => !a || a.attachedTo).map(([id]) => id);
      if (!list.length || missing.length) throw new ToolError(`No unattached file with id ${missing.join(', ') || '(none)'} in this chat.`);
      const snapshot = snapshotOf(marker);
      const refs = [];
      for (const [, a] of list) {
        refs.push(await b.uploadMedia(itemId, a.file, a.kind));
      }
      b.addMediaRefs(itemId, refs);
      for (const [, a] of list) a.attachedTo = itemId;
      return {
        content: `Attached ${refs.length} file${refs.length === 1 ? '' : 's'} to ${nameOf(marker)}.`,
        change: { itemId, label: `${nameOf(marker)}: ${refs.length} file${refs.length === 1 ? '' : 's'} attached`, snapshot },
      };
    },

    show_item({ item_id: itemId } = {}) {
      const b = bridge();
      const marker = markerOf(b, itemId);
      b.showMarker(itemId);
      return { content: `Showing ${nameOf(marker)}.` };
    },
  };

  return {
    async run(name, input) {
      const fn = tools[name];
      if (!fn) return { content: `Unknown tool ${name}.`, isError: true };
      try {
        return { isError: false, ...(await fn(input || {})) };
      } catch (err) {
        if (err instanceof ToolError) return { content: err.message, isError: true };
        console.warn('[survey-agent] tool failed', name, err);
        return { content: err?.message ? `That failed: ${err.message}` : 'That failed.', isError: true };
      }
    },
    // Puts the item back the way it was before `change`. For several changes
    // of one turn, undo the newest first.
    undo(change) {
      const b = getBridge();
      if (!b || !change) return false;
      if (!b.markers?.[change.itemId]) return false;
      b.restoreMarker(change.itemId, change.snapshot);
      return true;
    },
  };
}
